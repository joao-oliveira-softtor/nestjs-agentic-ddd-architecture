import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import { covers, parseCovers } from '@agentic-ddd/testing';
import type { TestCaseResult } from './verify/test-run';

export interface StaticEvidence {
  readonly cases: TestCaseResult[];
  readonly diagnostics: string[];
}

export function parseStaticTests(text: string, file: string): StaticEvidence {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const cases: TestCaseResult[] = [];
  const diagnostics: string[] = [];
  const helpers = new Set(['covers']);
  const testNames = new Set(['test', 'it']);
  for (const stmt of source.statements) {
    if (
      !ts.isImportDeclaration(stmt) ||
      !ts.isStringLiteral(stmt.moduleSpecifier)
    )
      continue;
    const bindings = stmt.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements) {
      const name = binding.propertyName?.text ?? binding.name.text;
      if (
        stmt.moduleSpecifier.text === '@agentic-ddd/testing' &&
        name === 'covers'
      )
        helpers.add(binding.name.text);
      if (
        stmt.moduleSpecifier.text === 'bun:test' &&
        ['test', 'it'].includes(name)
      )
        testNames.add(binding.name.text);
    }
  }
  const literal = (n: ts.Node | undefined): string | null =>
    n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
      ? n.text
      : null;
  const rootName = (n: ts.Expression): string | null => {
    if (ts.isIdentifier(n)) return n.text;
    if (ts.isPropertyAccessExpression(n)) return rootName(n.expression);
    return null;
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      testNames.has(rootName(node.expression) ?? '') &&
      node.arguments.length >= 2
    ) {
      const title = node.arguments[0];
      let name = literal(title);
      if (
        title &&
        ts.isCallExpression(title) &&
        ts.isIdentifier(title.expression) &&
        helpers.has(title.expression.text)
      ) {
        const ids = title.arguments[0];
        const label = literal(title.arguments[1]);
        if (
          ids &&
          ts.isArrayLiteralExpression(ids) &&
          label !== null &&
          ids.elements.every((n) => literal(n) !== null)
        )
          name = covers(
            ids.elements.map((n) => literal(n)!),
            label,
          );
      }
      const line =
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      if (name !== null)
        cases.push({
          file,
          line,
          name,
          covers: parseCovers(name),
          status: 'skipped',
        });
      else
        diagnostics.push(
          `${file}:${line}: declaração de teste dinâmica não resolvida (covers)`,
        );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { cases, diagnostics };
}

export async function readStaticTests(root: string): Promise<StaticEvidence> {
  const files: string[] = [];
  for await (const file of new Bun.Glob('**/*.{test,spec}.ts').scan({
    cwd: root,
    onlyFiles: true,
  }))
    if (
      !/(^|\/)(node_modules|\.git|\.worktrees|dist|__fixtures__)\//.test(file)
    )
      files.push(file);
  files.sort();
  const evidence = await Promise.all(
    files.map(async (file) =>
      parseStaticTests(await readFile(join(root, file), 'utf8'), file),
    ),
  );
  return {
    cases: evidence.flatMap((e) => e.cases),
    diagnostics: evidence.flatMap((e) => e.diagnostics).sort(),
  };
}
