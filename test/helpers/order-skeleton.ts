import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const ROOT = resolve(import.meta.dir, '../..');
const FILES = [
  'domain/order.ts',
  'application/create-order.ts',
  'application/cancel-order.ts',
  'application/confirm-order.ts',
];

/** Replace only registered bodies and preserve decorator line locations. */
function skeleton(
  text: string,
  file: string,
  completed: ReadonlySet<string>,
): string {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const edits: { start: number; end: number; text: string }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isMethodDeclaration(node) && node.body) {
      const name = node.name.getText(ast);
      const id =
        name === 'create'
          ? 'entity:Order'
          : name === 'execute'
            ? `usecase:${file.includes('create-') ? 'create_order' : file.includes('cancel-') ? 'cancel_order' : 'confirm_order'}`
            : `method:Order.${name}`;
      if (
        ['create', 'confirm', 'cancel', 'execute'].includes(name) &&
        !completed.has(id)
      ) {
        const body = node.body.getText(ast);
        const newlines = (body.match(/\n/g) ?? []).length;
        edits.push({
          start: node.body.getStart(ast),
          end: node.body.end,
          text: `{ return notImplemented();${'\n'.repeat(newlines)} }`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  for (const edit of edits.sort((a, b) => b.start - a.start))
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  // Add helper without adding a line or changing original decorator locations.
  return `import { notImplemented } from '@agentic-ddd/core'; ` + text;
}

function stageTests(
  text: string,
  file: string,
  completed: ReadonlySet<string>,
): string {
  text = text.replace(/,\s*'criterion:0002\/[^']*'/g, '');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const edits: { start: number; end: number }[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'test'
    ) {
      const title = node.arguments[0]?.getText(ast) ?? '';
      const ids = [
        ...title.matchAll(/'(method|invariant|usecase|operator):([^']+)'/g),
      ].map((m) => `${m[1]}:${m[2]}`);
      const ready = ids.every((id) => {
        const owner =
          id === 'method:Order.create' ||
          [
            'invariant:Order/ao-menos-um-item',
            'invariant:Order/total-nao-negativo',
          ].includes(id)
            ? 'entity:Order'
            : id === 'invariant:Order/cancelamento-exige-motivo'
              ? 'method:Order.cancel'
              : id;
        return completed.has(owner);
      });
      if (!ready) edits.push({ start: node.getStart(ast), end: node.end });
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  for (const edit of edits.sort((a, b) => b.start - a.start))
    text = text.slice(0, edit.start) + 'void 0' + text.slice(edit.end);
  return text;
}

export async function orderSkeleton() {
  const dir = await mkdtemp(join(tmpdir(), 'agentic-order-skeleton-'));
  await cp(join(ROOT, 'examples/orders'), join(dir, 'app'), {
    recursive: true,
  });
  await writeFile(
    join(dir, 'app/test/declarations.test.ts'),
    `import { test, expect } from 'bun:test'; import { Order } from '../domain/order'; test('declaração carregada', () => expect(Order.name).toBe('Order'));`,
  );
  await mkdir(join(dir, 'node_modules'));
  // Absolute paths let each new Bun process load the framework and schemas.
  await writeFile(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      extends: join(ROOT, 'tsconfig.json'),
      compilerOptions: {
        rootDir: '/',
        typeRoots: [join(ROOT, 'node_modules/@types')],
        experimentalDecorators: true,
        paths: {
          '@agentic-ddd/*': [join(ROOT, 'src/*/index.ts')],
          zod: [join(ROOT, 'node_modules/zod')],
        },
      },
    }),
  );
  await writeFile(
    join(dir, 'agentic.config.ts'),
    `export default { modules: [{ name: 'orders', path: 'app' }], verify: { test: ['bun', 'test', './app/test'], commands: { typecheck: ['bun', ${JSON.stringify(join(ROOT, 'node_modules/typescript/bin/tsc'))}, '--noEmit', '--project', 'tsconfig.json'] } } };`,
  );
  const original = new Map(
    await Promise.all(
      FILES.map(
        async (file) =>
          [file, await readFile(join(dir, 'app', file), 'utf8')] as const,
      ),
    ),
  );
  const tests = new Map(
    await Promise.all(
      ['order.test.ts', 'use-cases.test.ts', 'operator.test.ts'].map(
        async (file) =>
          [file, await readFile(join(dir, 'app/test', file), 'utf8')] as const,
      ),
    ),
  );
  const completed = new Set<string>();
  const stage = async (ids: string[]) => {
    ids.forEach((id) => completed.add(id));
    for (const [file, text] of original)
      await writeFile(join(dir, 'app', file), skeleton(text, file, completed));
    for (const [file, text] of tests)
      await writeFile(
        join(dir, 'app/test', file),
        stageTests(text, file, completed),
      );
  };
  await stage([]);
  const run = (...args: string[]) => {
    const result = Bun.spawnSync(
      [
        'bun',
        join(ROOT, 'src/cli/main.ts'),
        ...args,
        '--config',
        join(dir, 'agentic.config.ts'),
      ],
      { cwd: dir, stdout: 'pipe', stderr: 'pipe' },
    );
    return {
      code: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  };
  return { dir, run, stage };
}
