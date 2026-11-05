import ts from 'typescript';
import type { Coded } from '../ir';
import { literal } from './render';
import { compareText as cmp } from './schema';

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
    // shortcut: parseDiagnostics is not public API; replace it if a TypeScript upgrade drops it (the broken-file tests fail then).
    const syntax = (file as unknown as { parseDiagnostics: readonly unknown[] })
      .parseDiagnostics;
    if (syntax.length > 0)
      unexpected(`${fragment.path} does not parse as TypeScript`);
    const eol = dominantEol(source);
    const bound = importBindings(file);
    const edits = [
      ...importEdits(file, fragment.imports, bound),
      ...targetEdits(file, source, fragment),
      ...appendEdits(file, source, fragment, bound),
    ].map((e) => ({ ...e, text: e.text.replace(/\r?\n/g, eol) }));
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

// Inserted text is built with "\n"; it takes the file's dominant EOL so CRLF files stay pure CRLF.
const dominantEol = (source: string): string => {
  const crlf = source.split('\r\n').length - 1;
  const lf = source.split('\n').length - 1 - crlf;
  return crlf > lf ? '\r\n' : '\n';
};

const nonEmpty = (items: readonly unknown[] | undefined): boolean =>
  items !== undefined && items.length > 0;

// --- Top-level statements appended at the end of the file ---

function appendEdits(
  file: ts.SourceFile,
  source: string,
  fragment: Fragment,
  bound: ReadonlyMap<string, Binding>,
): Edit[] {
  const blocks = fragment.appended ?? [];
  if (blocks.length === 0) return [];
  const text = blocks.join('\n\n');
  const mine = ts.createSourceFile(
    'appended.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const taken = takenNames(file, bound);
  for (const name of mine.statements.flatMap(declaredNames))
    if (taken.has(name))
      unexpected(`${name} is already declared in ${fragment.path}`);
  return [
    {
      start: source.length,
      end: source.length,
      text: `${source.endsWith('\n') ? '' : '\n'}\n${text}\n`,
    },
  ];
}

/** Every name the file declares at the top level or imports. */
const takenNames = (
  file: ts.SourceFile,
  bound: ReadonlyMap<string, Binding>,
): Set<string> =>
  new Set([...file.statements.flatMap(declaredNames), ...bound.keys()]);

const declaresName = (node: ts.Statement, name: string): boolean =>
  declaredNames(node).includes(name);

function declaredNames(node: ts.Statement): string[] {
  if (
    ts.isClassDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  )
    return node.name ? [node.name.text] : [];
  if (ts.isVariableStatement(node))
    return node.declarationList.declarations.flatMap((d) =>
      bindingNames(d.name),
    );
  if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name))
    return [node.name.text];
  if (ts.isImportEqualsDeclaration(node)) return [node.name.text];
  return [];
}

/** The names a variable declaration binds, destructuring patterns included. */
const bindingNames = (name: ts.BindingName): string[] =>
  ts.isIdentifier(name)
    ? [name.text]
    : name.elements.flatMap((el) =>
        ts.isOmittedExpression(el) ? [] : bindingNames(el.name),
      );

// --- Imports ---

interface Binding {
  readonly spec: string;
  /** The export the local name binds: a name, `default` or `*` (namespace import). */
  readonly imported: string;
  readonly typeOnly: boolean;
}

/** A module specifier without its runtime extension (`./a.js` and `./a` name one module). */
const specKey = (spec: string): string => spec.replace(/\.[cm]?[jt]s$/, '');

const specOf = (d: ts.ImportDeclaration): string =>
  (d.moduleSpecifier as ts.StringLiteral).text;

/** Every name the imports of the file bind, with the module it comes from. */
const importBindings = (file: ts.SourceFile): Map<string, Binding> =>
  new Map(file.statements.filter(ts.isImportDeclaration).flatMap(clauseBindings));

function clauseBindings(d: ts.ImportDeclaration): [string, Binding][] {
  const clause = d.importClause;
  if (!clause) return [];
  const spec = specOf(d);
  const whole = clause.isTypeOnly;
  const def: [string, Binding][] = clause.name
    ? [[clause.name.text, { spec, imported: 'default', typeOnly: whole }]]
    : [];
  return [...def, ...namedBindings(clause.namedBindings, spec, whole)];
}

function namedBindings(
  nb: ts.NamedImportBindings | undefined,
  spec: string,
  whole: boolean,
): [string, Binding][] {
  if (!nb) return [];
  if (ts.isNamespaceImport(nb)) return [[nb.name.text, { spec, imported: '*', typeOnly: whole }]];
  return nb.elements.map((el): [string, Binding] => [
    el.name.text,
    {
      spec,
      imported: (el.propertyName ?? el.name).text,
      typeOnly: whole || el.isTypeOnly,
    },
  ]);
}

function importEdits(
  file: ts.SourceFile,
  wanted: readonly FragmentImport[],
  bound: ReadonlyMap<string, Binding>,
): Edit[] {
  const decls = file.statements.filter(ts.isImportDeclaration);
  const pending = pendingImports(file, wanted, bound);
  const edits: Edit[] = [];
  const fresh: string[] = [];
  for (const spec of [...pending.keys()].sort(cmp)) {
    const adds = pending.get(spec)!;
    const host = namedHost(decls, spec);
    if (host) edits.push(...mergeEdits(host, adds));
    else
      fresh.push(
        `import { ${adds.map(importText).join(', ')} } from ${literal(spec)};`,
      );
  }
  if (fresh.length > 0) edits.push(newImportsEdit(file, decls, fresh));
  return edits;
}

const importText = (i: FragmentImport): string =>
  i.typeOnly ? `type ${i.name}` : i.name;

/** The wanted imports the file lacks, by module; refuses a name the file already uses otherwise. */
function pendingImports(
  file: ts.SourceFile,
  wanted: readonly FragmentImport[],
  bound: ReadonlyMap<string, Binding>,
): Map<string, FragmentImport[]> {
  const pending = new Map<string, FragmentImport[]>();
  const sortedWanted = [...wanted].sort(
    (a, b) => cmp(a.spec, b.spec) || cmp(a.name, b.name),
  );
  for (const imp of sortedWanted) {
    if (alreadyImported(imp, bound.get(imp.name))) continue;
    if (file.statements.some((top) => declaresName(top, imp.name)))
      unexpected(`${imp.name} is already declared in the file`);
    pending.set(imp.spec, [...(pending.get(imp.spec) ?? []), imp]);
  }
  return pending;
}

/** True when the file already imports the name the way the fragment needs it; refuses a clash. */
function alreadyImported(
  imp: FragmentImport,
  have: Binding | undefined,
): boolean {
  if (!have) return false;
  if (specKey(have.spec) !== specKey(imp.spec) || have.imported !== imp.name)
    unexpected(
      `${imp.name} is already imported from another module or as another export (${have.spec})`,
    );
  if (have.typeOnly && !imp.typeOnly)
    unexpected(
      `${imp.name} is imported type-only but the fragment needs its value`,
    );
  return true;
}

/** A value import of `spec` with named bindings, which can take more names. */
const namedHost = (
  decls: readonly ts.ImportDeclaration[],
  spec: string,
): ts.ImportDeclaration | undefined =>
  decls.find(
    (d) =>
      specKey(specOf(d)) === specKey(spec) &&
      d.importClause &&
      !d.importClause.isTypeOnly &&
      d.importClause.namedBindings &&
      ts.isNamedImports(d.importClause.namedBindings),
  );

/** Adds names to an existing named import; its own elements are never rewritten. */
function mergeEdits(
  host: ts.ImportDeclaration,
  adds: readonly FragmentImport[],
): Edit[] {
  const named = host.importClause!.namedBindings as ts.NamedImports;
  const els = named.elements;
  if (els.length === 0)
    return [
      {
        start: named.getStart(),
        end: named.end,
        text: `{ ${adds.map(importText).join(', ')} }`,
      },
    ];
  // Comments and layout stay. If the list is already sorted, each new specifier goes at its
  // sorted position; otherwise it is appended last.
  const sorted = els.every(
    (el, i) => i === 0 || cmp(els[i - 1]!.name.text, el.name.text) <= 0,
  );
  return adds.map((a) => specifierEdit(els, sorted, a));
}

function specifierEdit(
  els: ts.NodeArray<ts.ImportSpecifier>,
  sorted: boolean,
  add: FragmentImport,
): Edit {
  const next = sorted
    ? els.find((el) => cmp(add.name, el.name.text) < 0)
    : undefined;
  if (next)
    return {
      start: next.getStart(),
      end: next.getStart(),
      text: `${importText(add)}, `,
    };
  const lastEnd = els.at(-1)!.end;
  return { start: lastEnd, end: lastEnd, text: `, ${importText(add)}` };
}

/** New import declarations go after the last import, or at the top of the file. */
function newImportsEdit(
  file: ts.SourceFile,
  decls: readonly ts.ImportDeclaration[],
  fresh: readonly string[],
): Edit {
  const last = decls.at(-1);
  if (last)
    return { start: last.end, end: last.end, text: `\n${fresh.join('\n')}` };
  // Leading comments, a shebang and the BOM stay above the new imports.
  const first = file.statements[0];
  const at = first ? afterHeader(file, first) : file.end;
  return { start: at, end: at, text: `${fresh.join('\n')}\n\n` };
}

/** Where the first statement starts, or where its attached JSDoc does (no blank line between). */
function afterHeader(file: ts.SourceFile, first: ts.Statement): number {
  const start = first.getStart(file);
  const text = file.text;
  const doc = ts.getLeadingCommentRanges(text, first.pos)?.at(-1);
  const attached =
    doc &&
    text.startsWith('/**', doc.pos) &&
    !/\n\s*\n/.test(text.slice(doc.end, start));
  return attached ? doc.pos : start;
}

// --- Edits inside the target class ---

const wantsTarget = (fragment: Fragment): boolean =>
  nonEmpty(fragment.classDecorators) ||
  nonEmpty(fragment.members) ||
  nonEmpty(fragment.arrays);

function targetEdits(
  file: ts.SourceFile,
  source: string,
  fragment: Fragment,
): Edit[] {
  if (!wantsTarget(fragment)) return [];
  const t = fragment.target;
  if (t === null) return unexpected('the fragment has edits but no target');
  const cls = targetClass(file, fragment, t);
  return [
    ...decoratorEdits(cls, fragment),
    ...memberEdits(cls, source, fragment),
    ...arrayEdits(cls, fragment, t),
  ];
}

/** The one class the fragment targets; refuses when there is none or more than one. */
function targetClass(
  file: ts.SourceFile,
  fragment: Fragment,
  t: NonNullable<Fragment['target']>,
): ts.ClassDeclaration {
  const classes = file.statements
    .filter(ts.isClassDeclaration)
    .filter((c) => isTarget(c, t));
  const label = `${t.kind} ${JSON.stringify(t.name)}`;
  if (classes.length === 0)
    return missing(`${fragment.path} has no ${label}`);
  if (classes.length > 1)
    return unexpected(`${fragment.path} has more than one ${label}`);
  return classes[0]!;
}

const isTarget = (
  c: ts.ClassDeclaration,
  t: NonNullable<Fragment['target']>,
): boolean =>
  t.kind === 'class'
    ? c.name?.text === t.name
    : useCaseOptions(c, t.name) !== null;

const propName = (p: ts.PropertyAssignment): string | null =>
  ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)
    ? p.name.text
    : null;

const property = (
  opts: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined =>
  opts.properties.find(
    (p): p is ts.PropertyAssignment =>
      ts.isPropertyAssignment(p) && propName(p) === name,
  );

/** The options object of `@AgentUseCase({ name: '<name>' ... })` on the class, or null. */
function useCaseOptions(
  cls: ts.ClassDeclaration,
  name: string,
): ts.ObjectLiteralExpression | null {
  for (const d of ts.getDecorators(cls) ?? []) {
    const opts = agentUseCaseOptions(d);
    if (opts && optionName(opts) === name) return opts;
  }
  return null;
}

/** The options object `@AgentUseCase({ ... })` is called with, or null for any other decorator. */
function agentUseCaseOptions(d: ts.Decorator): ts.ObjectLiteralExpression | null {
  const call = d.expression;
  if (
    !ts.isCallExpression(call) ||
    !ts.isIdentifier(call.expression) ||
    call.expression.text !== 'AgentUseCase'
  )
    return null;
  const arg = call.arguments[0];
  return arg && ts.isObjectLiteralExpression(arg) ? arg : null;
}

/** The text of the `name` option when it is a string literal. */
function optionName(opts: ts.ObjectLiteralExpression): string | null {
  const prop = property(opts, 'name');
  return prop && ts.isStringLiteralLike(prop.initializer)
    ? prop.initializer.text
    : null;
}

function decoratorEdits(cls: ts.ClassDeclaration, fragment: Fragment): Edit[] {
  const add = fragment.classDecorators ?? [];
  if (add.length === 0) return [];
  const last = ts.getDecorators(cls)?.at(-1);
  if (!last)
    return missing(`class ${cls.name?.text} has no decorator to anchor on`);
  const norm = (t: string): string => t.replace(/\s+/g, ' ').trim();
  const have = new Set(ts.getDecorators(cls)!.map((d) => norm(d.getText())));
  for (const d of add)
    if (have.has(norm(d)))
      unexpected(`class ${cls.name?.text} already has the decorator ${d}`);
  return [{ start: last.end, end: last.end, text: `\n${add.join('\n')}` }];
}

function memberEdits(
  cls: ts.ClassDeclaration,
  source: string,
  fragment: Fragment,
): Edit[] {
  const add = fragment.members ?? [];
  if (add.length === 0) return [];
  const have = memberNames(cls);
  for (const m of add)
    if (have.has(m.name))
      unexpected(
        `class ${cls.name?.text} already has a member named ${m.name}`,
      );
  return [membersEdit(cls, source, add.map((m) => m.text).join('\n\n'))];
}

/** The names of the members a class declares (private names included). */
const memberNames = (cls: ts.ClassDeclaration): Set<string> =>
  new Set(cls.members.flatMap(memberName));

function memberName(m: ts.ClassElement): string[] {
  const n = m.name;
  return n &&
    (ts.isIdentifier(n) || ts.isStringLiteralLike(n) || ts.isPrivateIdentifier(n))
    ? [n.text]
    : [];
}

/** Inserts `body` before the closing brace; only the whitespace before the brace is replaced. */
function membersEdit(
  cls: ts.ClassDeclaration,
  source: string,
  body: string,
): Edit {
  const close = cls.end - 1;
  if (source[close] !== '}')
    return unexpected('cannot locate the class closing brace');
  // Comments and code stay untouched.
  let ws = close;
  while (ws > cls.members.pos && /\s/.test(source[ws - 1]!)) ws--;
  return {
    start: ws,
    end: close,
    text: `${cls.members.length === 0 ? '\n' : '\n\n'}${body}\n`,
  };
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
    const prop = property(opts, a.property);
    if (!prop) return addProperty(opts, a.property, a.elements);
    if (!ts.isArrayLiteralExpression(prop.initializer))
      return missing(
        `use-case ${JSON.stringify(t.name)} has no ${a.property} array`,
      );
    const arr = prop.initializer;
    const present = new Set(arr.elements.map(elementKey));
    const fresh = a.elements.filter(
      (e) => !present.has(elementKey(parseElement(e))),
    );
    if (fresh.length === 0) return [];
    const last = arr.elements.at(-1);
    if (last)
      return [
        { start: last.end, end: last.end, text: `, ${fresh.join(', ')}` },
      ];
    // Only a bare `[]` is rewritten: a comment inside stays.
    const bare = arr.getText().slice(1, -1).trim() === '';
    const start = bare ? arr.getStart() + 1 : arr.end - 1;
    return [{ start, end: arr.end - 1, text: fresh.join(', ') }];
  });
}

/** The option is optional in `@AgentUseCase`: it is added after the last property. */
function addProperty(
  opts: ts.ObjectLiteralExpression,
  name: string,
  elements: readonly string[],
): Edit[] {
  const last = opts.properties.at(-1);
  if (!last) return unexpected('the use-case options are empty');
  return [
    {
      start: last.end,
      end: last.end,
      text: `, ${name}: [${elements.join(', ')}]`,
    },
  ];
}

/** Strings compare by value, so `'a'` and `"a"` are one element; other code by its text. */
const elementKey = (e: ts.Expression): string =>
  ts.isStringLiteralLike(e) ? `s:${e.text}` : `n:${e.getText()}`;

function parseElement(text: string): ts.Expression {
  const file = ts.createSourceFile(
    'element.ts',
    `[${text}]`,
    ts.ScriptTarget.Latest,
    true,
  );
  const stmt = file.statements[0] as ts.ExpressionStatement;
  return (stmt.expression as ts.ArrayLiteralExpression).elements[0]!;
}
