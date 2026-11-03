import ts from 'typescript';
import type { Coded } from '../ir';

export interface FragmentImport {
  readonly spec: string;
  readonly name: string;
  readonly typeOnly: boolean;
}

/**
 * What a Delta adds to a file that already exists. The renderer never re-renders such a file (that
 * would destroy hand-written bodies); it emits this fragment and `splice` inserts it.
 * All code text is already rendered, with client strings through `literal()`.
 */
export interface Fragment {
  /** Module-relative path of the target file. */
  readonly path: string;
  readonly imports: readonly FragmentImport[];
  /** The class (by name) or the use-case (by its `@AgentUseCase({ name })`) that receives the edits. */
  readonly target:
    | { readonly kind: 'class'; readonly name: string }
    | { readonly kind: 'use-case'; readonly name: string }
    | null;
  /** Decorators added after the target class's last decorator. */
  readonly classDecorators?: readonly string[];
  /** Members added before the target class's closing brace. */
  readonly members?: readonly { readonly name: string; readonly text: string }[];
  /** Elements appended to array properties of the `@AgentUseCase` options. */
  readonly arrays?: readonly {
    readonly property: string;
    readonly elements: readonly string[];
  }[];
  /** Top-level statements appended at the end of the file. */
  readonly appended?: readonly string[];
}

export type SpliceResult =
  | { readonly ok: true; readonly source: string }
  | { readonly ok: false; readonly error: Coded };

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

class Refusal extends Error {
  constructor(
    readonly code:
      | 'delta.splice-anchor-missing'
      | 'delta.splice-unexpected-shape',
    message: string,
  ) {
    super(message);
  }
}
const missing = (m: string): never => {
  throw new Refusal('delta.splice-anchor-missing', m);
};
const unexpected = (m: string): never => {
  throw new Refusal('delta.splice-unexpected-shape', m);
};

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Pure: inserts the fragment into the source through the TypeScript AST and returns the new text.
 * It refuses, with a stable code, whenever the anchor is not found or the file is not shaped as
 * expected; it never guesses. It does no I/O and no hash check (`agentic apply` does those).
 */
export function splice(source: string, fragment: Fragment): SpliceResult {
  try {
    const file = ts.createSourceFile(
      'target.ts',
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const parseDiagnostics = (
      file as unknown as { parseDiagnostics: readonly unknown[] }
    ).parseDiagnostics;
    if (parseDiagnostics.length > 0)
      unexpected(`${fragment.path} does not parse as TypeScript`);
    const edits = [
      ...importEdits(file, fragment.imports),
      ...targetEdits(file, source, fragment),
    ];
    if ((fragment.appended ?? []).length > 0)
      edits.push({
        start: source.length,
        end: source.length,
        text: `${source.endsWith('\n') ? '' : '\n'}\n${fragment.appended!.join('\n\n')}\n`,
      });
    // Applied from the end so earlier offsets stay valid; ties keep their creation order.
    const ordered = edits
      .map((e, i) => ({ e, i }))
      .sort((a, b) => b.e.start - a.e.start || b.i - a.i);
    let out = source;
    for (const { e } of ordered)
      out = out.slice(0, e.start) + e.text + out.slice(e.end);
    return { ok: true, source: out };
  } catch (e) {
    if (e instanceof Refusal)
      return { ok: false, error: { code: e.code, message: e.message } };
    throw e;
  }
}

function importEdits(
  file: ts.SourceFile,
  wanted: readonly FragmentImport[],
): Edit[] {
  const decls = file.statements.filter(ts.isImportDeclaration);
  const specOf = (d: ts.ImportDeclaration): string =>
    (d.moduleSpecifier as ts.StringLiteral).text;
  const bound = new Map<string, { spec: string; typeOnly: boolean }>();
  for (const d of decls) {
    const clause = d.importClause;
    if (!clause) continue;
    const spec = specOf(d);
    if (clause.name)
      bound.set(clause.name.text, { spec, typeOnly: clause.isTypeOnly });
    const nb = clause.namedBindings;
    if (nb && ts.isNamespaceImport(nb))
      bound.set(nb.name.text, { spec, typeOnly: clause.isTypeOnly });
    if (nb && ts.isNamedImports(nb))
      for (const el of nb.elements)
        bound.set(el.name.text, {
          spec,
          typeOnly: clause.isTypeOnly || el.isTypeOnly,
        });
  }
  const pending = new Map<string, FragmentImport[]>();
  const sortedWanted = [...wanted].sort(
    (a, b) => cmp(a.spec, b.spec) || cmp(a.name, b.name),
  );
  for (const imp of sortedWanted) {
    const have = bound.get(imp.name);
    if (have) {
      if (have.spec !== imp.spec)
        unexpected(
          `${imp.name} is already imported from another module (${have.spec})`,
        );
      if (have.typeOnly && !imp.typeOnly)
        unexpected(
          `${imp.name} is imported type-only but the fragment needs its value`,
        );
      continue;
    }
    for (const top of file.statements)
      if (declaresName(top, imp.name))
        unexpected(`${imp.name} is already declared in the file`);
    pending.set(imp.spec, [...(pending.get(imp.spec) ?? []), imp]);
  }
  const edits: Edit[] = [];
  const fresh: string[] = [];
  const render = (i: FragmentImport): string =>
    i.typeOnly ? `type ${i.name}` : i.name;
  const bare = (n: string): string => n.replace(/^type /, '');
  for (const spec of [...pending.keys()].sort(cmp)) {
    const adds = pending.get(spec)!;
    const host = decls.find(
      (d) =>
        specOf(d) === spec &&
        d.importClause &&
        !d.importClause.isTypeOnly &&
        d.importClause.namedBindings &&
        ts.isNamedImports(d.importClause.namedBindings),
    );
    if (host) {
      const named = host.importClause!.namedBindings as ts.NamedImports;
      const names = [
        ...named.elements.map((el) => el.getText()),
        ...adds.map(render),
      ].sort((a, b) => cmp(bare(a), bare(b)));
      edits.push({
        start: named.getStart(),
        end: named.end,
        text: `{ ${names.join(', ')} }`,
      });
    } else
      fresh.push(
        `import { ${adds.map(render).join(', ')} } from ${quote(spec)};`,
      );
  }
  if (fresh.length > 0) {
    const last = decls.at(-1);
    edits.push(
      last
        ? { start: last.end, end: last.end, text: `\n${fresh.join('\n')}` }
        : { start: 0, end: 0, text: `${fresh.join('\n')}\n\n` },
    );
  }
  return edits;
}

// Specifiers are renderer-built paths or allowlisted package names; escaping is belt and braces.
const quote = (s: string): string =>
  `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function declaresName(node: ts.Statement, name: string): boolean {
  if (
    (ts.isClassDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)) &&
    node.name?.text === name
  )
    return true;
  return (
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(
      (d) => ts.isIdentifier(d.name) && d.name.text === name,
    )
  );
}

function targetEdits(
  file: ts.SourceFile,
  source: string,
  fragment: Fragment,
): Edit[] {
  const wantsTarget =
    (fragment.classDecorators ?? []).length > 0 ||
    (fragment.members ?? []).length > 0 ||
    (fragment.arrays ?? []).length > 0;
  if (!wantsTarget) return [];
  const t = fragment.target;
  if (t === null) return unexpected('the fragment has edits but no target');
  const classes = file.statements
    .filter(ts.isClassDeclaration)
    .filter((c) =>
      t.kind === 'class'
        ? c.name?.text === t.name
        : useCaseOptions(c, t.name) !== null,
    );
  const label = `${t.kind} ${JSON.stringify(t.name)}`;
  if (classes.length === 0)
    return missing(`${fragment.path} has no ${label}`);
  if (classes.length > 1)
    return unexpected(`${fragment.path} has more than one ${label}`);
  const cls = classes[0]!;
  return [
    ...decoratorEdits(cls, fragment),
    ...memberEdits(cls, source, fragment),
    ...arrayEdits(cls, fragment, t),
  ];
}

const propName = (p: ts.PropertyAssignment): string | null =>
  ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)
    ? p.name.text
    : null;

/** The options object of `@AgentUseCase({ name: '<name>' ... })` on the class, or null. */
function useCaseOptions(
  cls: ts.ClassDeclaration,
  name: string,
): ts.ObjectLiteralExpression | null {
  for (const d of ts.getDecorators(cls) ?? []) {
    const call = d.expression;
    if (
      !ts.isCallExpression(call) ||
      !ts.isIdentifier(call.expression) ||
      call.expression.text !== 'AgentUseCase'
    )
      continue;
    const arg = call.arguments[0];
    if (!arg || !ts.isObjectLiteralExpression(arg)) continue;
    const prop = arg.properties.find(
      (p): p is ts.PropertyAssignment =>
        ts.isPropertyAssignment(p) && propName(p) === 'name',
    );
    if (
      prop &&
      ts.isStringLiteralLike(prop.initializer) &&
      prop.initializer.text === name
    )
      return arg;
  }
  return null;
}

function decoratorEdits(cls: ts.ClassDeclaration, fragment: Fragment): Edit[] {
  const add = fragment.classDecorators ?? [];
  if (add.length === 0) return [];
  const last = ts.getDecorators(cls)?.at(-1);
  if (!last)
    return missing(`class ${cls.name?.text} has no decorator to anchor on`);
  return [{ start: last.end, end: last.end, text: `\n${add.join('\n')}` }];
}

function memberEdits(
  cls: ts.ClassDeclaration,
  source: string,
  fragment: Fragment,
): Edit[] {
  const add = fragment.members ?? [];
  if (add.length === 0) return [];
  const have = new Set<string>();
  for (const m of cls.members) {
    const n = m.name;
    if (
      n &&
      (ts.isIdentifier(n) ||
        ts.isStringLiteralLike(n) ||
        ts.isPrivateIdentifier(n))
    )
      have.add(n.text);
  }
  for (const m of add)
    if (have.has(m.name))
      unexpected(
        `class ${cls.name?.text} already has a member named ${m.name}`,
      );
  const close = cls.end - 1;
  if (source[close] !== '}')
    return unexpected('cannot locate the class closing brace');
  // Only the whitespace before the brace is replaced; comments and code stay untouched.
  let ws = close;
  while (ws > cls.members.pos && /\s/.test(source[ws - 1]!)) ws--;
  const body = add.map((m) => m.text).join('\n\n');
  return [
    {
      start: ws,
      end: close,
      text: `${cls.members.length === 0 ? '\n' : '\n\n'}${body}\n`,
    },
  ];
}

function arrayEdits(
  cls: ts.ClassDeclaration,
  fragment: Fragment,
  t: NonNullable<Fragment['target']>,
): Edit[] {
  const arrays = fragment.arrays ?? [];
  if (arrays.length === 0) return [];
  if (t.kind !== 'use-case')
    return unexpected('array additions need a use-case target');
  const opts = useCaseOptions(cls, t.name)!;
  return arrays.flatMap((a): Edit[] => {
    const prop = opts.properties.find(
      (p): p is ts.PropertyAssignment =>
        ts.isPropertyAssignment(p) && propName(p) === a.property,
    );
    if (!prop || !ts.isArrayLiteralExpression(prop.initializer))
      return missing(
        `use-case ${JSON.stringify(t.name)} has no ${a.property} array`,
      );
    const arr = prop.initializer;
    const present = new Set(arr.elements.map((e) => e.getText()));
    const fresh = a.elements.filter((e) => !present.has(e));
    if (fresh.length === 0) return [];
    const last = arr.elements.at(-1);
    return last
      ? [{ start: last.end, end: last.end, text: `, ${fresh.join(', ')}` }]
      : [
          {
            start: arr.getStart() + 1,
            end: arr.end - 1,
            text: fresh.join(', '),
          },
        ];
  });
}
