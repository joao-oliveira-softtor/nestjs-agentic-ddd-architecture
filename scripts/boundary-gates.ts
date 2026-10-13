import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import ts from 'typescript';

export interface BodyRange {
  readonly start: number;
  readonly end: number;
}
export type GateLayer = 'domain' | 'application' | 'operators';

/** Intervalo do interior (entre as chaves) do corpo de `className.methodName`. */
export function bodyRange(
  text: string,
  className: string,
  methodName: string,
): BodyRange {
  const parsed = ts.createSourceFile(
    'submission.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const diagnostics =
    ts.transpileModule(text, {
      reportDiagnostics: true,
      compilerOptions: {
        experimentalDecorators: true,
        target: ts.ScriptTarget.ESNext,
      },
    }).diagnostics ?? [];
  if (diagnostics.some((d) => d.category === ts.DiagnosticCategory.Error))
    throw Error('Submission syntax invalid');
  for (const statement of parsed.statements)
    if (
      ts.isClassDeclaration(statement) &&
      statement.name?.text === className
    ) {
      const method = statement.members.find(
        (m) =>
          ts.isMethodDeclaration(m) && m.name.getText(parsed) === methodName,
      );
      if (method && ts.isMethodDeclaration(method) && method.body)
        return {
          start: method.body.getStart(parsed) + 1,
          end: method.body.end - 1,
        };
    }
  throw Error('Assigned method body missing');
}

const lines = (text: string): number => (text.match(/\n/g) ?? []).length;

/**
 * Compara dois conteúdos do mesmo arquivo e acusa mudança fora do corpo atribuído
 * ou na contagem de linhas do corpo (as coordenadas `source` entram nos gerados).
 */
export function bodyOnlyFindings(
  before: string,
  after: string,
  className: string,
  methodName: string,
  path: string,
): string[] {
  const findings: string[] = [];
  try {
    const oldBody = bodyRange(before, className, methodName);
    const newBody = bodyRange(after, className, methodName);
    if (
      before.slice(0, oldBody.start) !== after.slice(0, newBody.start) ||
      before.slice(oldBody.end) !== after.slice(newBody.end)
    )
      findings.push(`Bytes outside assigned body changed: ${path}`);
    if (
      lines(before.slice(oldBody.start, oldBody.end)) !==
      lines(after.slice(newBody.start, newBody.end))
    )
      findings.push(`Body line count changed: ${path}`);
  } catch (error) {
    findings.push(String(error));
  }
  return findings;
}

export interface ImportScan {
  /** Especificadores literais: import, export-from, import(), require() e import = require(). */
  readonly specifiers: string[];
  /** import()/require() com argumento não literal: não dá para resolver estaticamente. */
  readonly unresolved: number;
}

export function scanImports(text: string): ImportScan {
  const source = ts.createSourceFile(
    'file.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];
  let unresolved = 0;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    )
      specifiers.push(node.moduleSpecifier.text);
    else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const expression = node.moduleReference.expression;
      if (ts.isStringLiteralLike(expression)) specifiers.push(expression.text);
      else unresolved++;
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument))
        specifiers.push(argument.text);
      else unresolved++;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { specifiers, unresolved };
}

/** Só os especificadores literais de {@link scanImports}. */
export function importSpecifiers(text: string): string[] {
  return scanImports(text).specifiers;
}

const FRAMEWORK_RUNTIME = new Set([
  '@agentic-ddd/runtime',
  '@agentic-ddd/nestjs',
]);
const OUTER_LAYERS: Readonly<Record<GateLayer, readonly string[]>> = {
  domain: ['application', 'operators', 'infrastructure', 'infra'],
  application: ['operators', 'infrastructure', 'infra'],
  operators: [],
};

/** Diretório da camada: o último ancestral com o nome da camada; senão, o do próprio arquivo. */
function layerRoot(path: string, layer: GateLayer): string {
  const parts = posix.dirname(path).split('/');
  const index = parts.lastIndexOf(layer);
  return index === -1 ? parts.join('/') : parts.slice(0, index + 1).join('/');
}

/**
 * Direção de import por camada: domínio e aplicação não importam Nest nem o runtime do
 * framework, e nenhuma camada importa as camadas externas a ela. A comparação usa o
 * primeiro segmento do import relativo à raiz da camada do arquivo, então diretórios
 * acima do módulo (por exemplo `src/infra/`) não geram falso positivo.
 *
 * Limitações conhecidas: especificadores não relativos (aliases de `paths` do tsconfig,
 * auto-referência de pacote) não são resolvidos, só `@nestjs/*` e o runtime do framework
 * são barrados; `import()`/`require()` com argumento não literal são acusados porque não
 * podem ser verificados. O gate de corpo (`bodyOnlyFindings`) só localiza `Classe.método`.
 */
export function importDirectionFindings(
  path: string,
  text: string,
  layer: GateLayer,
): string[] {
  if (layer === 'operators') return [];
  const findings: string[] = [];
  const { specifiers, unresolved } = scanImports(text);
  if (unresolved)
    findings.push(
      `Forbidden import in ${path}: import()/require() com argumento não literal não é verificável (${unresolved})`,
    );
  const root = layerRoot(path, layer);
  for (const specifier of specifiers) {
    if (specifier.startsWith('@nestjs/') || FRAMEWORK_RUNTIME.has(specifier)) {
      findings.push(
        `Forbidden import in ${path}: ${specifier} (${layer} não importa Nest nem o runtime)`,
      );
      continue;
    }
    if (!specifier.startsWith('.')) continue;
    const relative = posix.relative(
      root,
      posix.join(posix.dirname(path), specifier),
    );
    const outer = relative.split('/').find((segment) => segment !== '..');
    if (outer && OUTER_LAYERS[layer].includes(outer))
      findings.push(
        `Forbidden import in ${path}: ${specifier} (${layer} não importa ${outer})`,
      );
  }
  return findings;
}

const USAGE = [
  'uso:',
  '  bun scripts/boundary-gates.ts imports --layer <domain|application|operators> <arquivo...>',
  '  bun scripts/boundary-gates.ts body-only --before <arquivo> --after <arquivo> --class <C> --method <m>',
].join('\n');

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

export function main(argv: readonly string[]): number {
  const [command, ...args] = argv;
  const findings: string[] = [];
  if (command === 'imports') {
    const layer = option(args, '--layer') as GateLayer | undefined;
    if (!layer || !(layer in OUTER_LAYERS)) {
      console.error(USAGE);
      return 2;
    }
    const files: string[] = [];
    for (let i = 0; i < args.length; i++)
      if (args[i] === '--layer') i++;
      else files.push(args[i]!);
    if (!files.length) {
      console.error(USAGE);
      return 2;
    }
    for (const file of files)
      findings.push(
        ...importDirectionFindings(file, readFileSync(file, 'utf8'), layer),
      );
  } else if (command === 'body-only') {
    const [before, after, className, method] = [
      '--before',
      '--after',
      '--class',
      '--method',
    ].map((name) => option(args, name));
    if (!before || !after || !className || !method) {
      console.error(USAGE);
      return 2;
    }
    findings.push(
      ...bodyOnlyFindings(
        readFileSync(before, 'utf8'),
        readFileSync(after, 'utf8'),
        className,
        method,
        after,
      ),
    );
  } else {
    console.error(USAGE);
    return 2;
  }
  for (const finding of findings) console.error(finding);
  return findings.length ? 1 : 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
