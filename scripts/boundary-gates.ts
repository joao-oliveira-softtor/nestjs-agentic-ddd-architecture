import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { isMatching, match, P } from 'ts-pattern';
import ts from 'typescript';
import {
  DEFAULT_CONVENTIONS,
  type ResolvedConventions,
} from '../src/compiler/conventions';

export interface BodyRange {
  readonly start: number;
  readonly end: number;
}
export type GateLayer =
  'domain' | 'application' | 'operators' | 'infrastructure';

function parseSubmission(text: string): ts.SourceFile {
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
  return parsed;
}

/** Intervalo do interior (entre as chaves) do corpo de `className.methodName`. */
export function bodyRange(
  text: string,
  className: string,
  methodName: string,
): BodyRange {
  const parsed = parseSubmission(text);
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

interface ClassShape {
  readonly start: number;
  readonly end: number;
  readonly header: string;
  readonly members: string[];
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

function classShape(text: string, className: string): ClassShape {
  const parsed = parseSubmission(text);
  for (const statement of parsed.statements)
    if (
      ts.isClassDeclaration(statement) &&
      statement.name?.text === className
    ) {
      const start = statement.getStart(parsed);
      return {
        start,
        end: statement.end,
        header: squash(text.slice(start, statement.members.pos - 1)),
        members: statement.members
          .filter((m) => !(m.name && ts.isPrivateIdentifier(m.name)))
          .map((m) =>
            squash(
              text.slice(
                m.getStart(parsed),
                (ts.isMethodDeclaration(m) ||
                  ts.isConstructorDeclaration(m) ||
                  ts.isGetAccessor(m) ||
                  ts.isSetAccessor(m)) &&
                  m.body
                  ? m.body.getStart(parsed)
                  : m.end,
              ),
            ),
          ),
      };
    }
  throw Error('Assigned class missing');
}

/**
 * Escopo de classe (ADR-0006 D8): só corpos e membros `#privados` mudam. Barra bytes fora
 * da classe, a contagem de linhas dela, decorators, `extends`/`implements` e a assinatura
 * (inclusive inicializador de campo) dos membros não `#privados`, e acrescentar/remover
 * membro não `#privado`.
 */
export function classScopeFindings(
  before: string,
  after: string,
  className: string,
  path: string,
): string[] {
  const findings: string[] = [];
  try {
    const old = classShape(before, className);
    const next = classShape(after, className);
    if (
      before.slice(0, old.start) !== after.slice(0, next.start) ||
      before.slice(old.end) !== after.slice(next.end)
    )
      findings.push(`Bytes outside assigned class changed: ${path}`);
    if (
      lines(before.slice(old.start, old.end)) !==
      lines(after.slice(next.start, next.end))
    )
      findings.push(`Class line count changed: ${path}`);
    if (old.header !== next.header)
      findings.push(`Class decorators or heritage changed: ${path}`);
    if (old.members.length !== next.members.length)
      findings.push(`Public member set changed: ${path}`);
    else if (old.members.some((m, i) => m !== next.members[i]))
      findings.push(`Public member signature changed: ${path}`);
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
  '@agentic-ddd/elysia',
  'elysia',
]);
/** Pastas que a camada não pode importar, a partir das convenções. */
export function outerFolders(
  conventions: ResolvedConventions,
  layer: 'domain' | 'application',
): string[] {
  return conventions.forbiddenImports[layer].flatMap((target) =>
    match(target)
      .with('application', 'operators', (name) => [conventions.layers[name]])
      .with('infrastructure', () => [...conventions.infrastructure])
      .exhaustive(),
  );
}

/** Diretório da camada: o último ancestral com o nome da camada; senão, o do próprio arquivo. */
function layerRoot(
  path: string,
  layer: 'domain' | 'application',
  conventions: ResolvedConventions,
): string {
  const parts = posix.dirname(path).split('/');
  const index = parts.lastIndexOf(conventions.layers[layer]);
  return index === -1 ? parts.join('/') : parts.slice(0, index + 1).join('/');
}

/**
 * Direção de import por camada: domínio e aplicação não importam Nest, Elysia nem o runtime do
 * framework, e nenhuma camada importa as camadas externas a ela. A comparação usa o
 * primeiro segmento do import relativo à raiz da camada do arquivo, então diretórios
 * acima do módulo (por exemplo `src/infra/`) não geram falso positivo.
 *
 * Limitações conhecidas: especificadores não relativos (aliases de `paths` do tsconfig,
 * auto-referência de pacote) não são resolvidos, só `@nestjs/*`, `elysia` e o runtime do framework
 * são barrados; `import()`/`require()` com argumento não literal são acusados porque não
 * podem ser verificados. Os gates de corpo e de escopo de classe (`bodyOnlyFindings`, `classScopeFindings`) só localizam a classe (ou `Classe.método`) por nome.
 */
export function importDirectionFindings(
  path: string,
  text: string,
  layer: GateLayer,
  conventions: ResolvedConventions = DEFAULT_CONVENTIONS,
): string[] {
  return match(layer)
    .with('operators', 'infrastructure', () => [])
    .with('domain', 'application', (layer) => {
      const findings: string[] = [];
      const { specifiers, unresolved } = scanImports(text);
      if (unresolved)
        findings.push(
          `Forbidden import in ${path}: import()/require() com argumento não literal não é verificável (${unresolved})`,
        );
      const root = layerRoot(path, layer, conventions);
      const outers = outerFolders(conventions, layer);
      for (const specifier of specifiers) {
        if (
          specifier.startsWith('@nestjs/') ||
          specifier.startsWith('elysia/') ||
          FRAMEWORK_RUNTIME.has(specifier)
        ) {
          findings.push(
            `Forbidden import in ${path}: ${specifier} (${layer} não importa Nest, Elysia nem o runtime)`,
          );
          continue;
        }
        if (!specifier.startsWith('.')) continue;
        const relative = posix.relative(
          root,
          posix.join(posix.dirname(path), specifier),
        );
        const outer = relative.split('/').find((segment) => segment !== '..');
        if (outer && outers.includes(outer))
          findings.push(
            `Forbidden import in ${path}: ${specifier} (${layer} não importa ${outer})`,
          );
      }
      return findings;
    })
    .exhaustive();
}

const USAGE = [
  'uso:',
  '  bun scripts/boundary-gates.ts imports --layer <domain|application|operators|infrastructure> <arquivo...>',
  '  bun scripts/boundary-gates.ts body-only --before <arquivo> --after <arquivo> --class <C> --method <m>',
  '  bun scripts/boundary-gates.ts class-scope --before <arquivo> --after <arquivo> --class <C>',
].join('\n');

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

export function main(argv: readonly string[]): number {
  const [command, ...args] = argv;
  const usage = (): number => {
    console.error(USAGE);
    return 2;
  };
  const result = match(command)
    .with('imports', () => {
      const layer = option(args, '--layer');
      if (
        !layer ||
        !isMatching(
          P.union('domain', 'application', 'operators', 'infrastructure'),
          layer,
        )
      )
        return undefined;
      const files: string[] = [];
      for (let i = 0; i < args.length; i++)
        if (args[i] === '--layer') i++;
        else files.push(args[i]!);
      if (!files.length) return undefined;
      return files.flatMap((file) =>
        importDirectionFindings(file, readFileSync(file, 'utf8'), layer),
      );
    })
    .with('body-only', () => {
      const [before, after, className, method] = [
        '--before',
        '--after',
        '--class',
        '--method',
      ].map((name) => option(args, name));
      if (!before || !after || !className || !method) return undefined;
      return bodyOnlyFindings(
        readFileSync(before, 'utf8'),
        readFileSync(after, 'utf8'),
        className,
        method,
        after,
      );
    })
    .with('class-scope', () => {
      const [before, after, className] = ['--before', '--after', '--class'].map(
        (name) => option(args, name),
      );
      if (!before || !after || !className) return undefined;
      return classScopeFindings(
        readFileSync(before, 'utf8'),
        readFileSync(after, 'utf8'),
        className,
        after,
      );
    })
    .otherwise(() => undefined);
  if (!result) return usage();
  const findings = result;
  for (const finding of findings) console.error(finding);
  return findings.length ? 1 : 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
