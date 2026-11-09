import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { closureObligations, scopedTestCommand, testFilesFor } from './item';

const ROOT = '/proj';

test('scopedTestCommand swaps the configured paths for the selected files and keeps the flags', () => {
  expect(
    scopedTestCommand(
      ['bun', 'test', '--timeout', '5000', './src', './test/a.test.ts'],
      ROOT,
      ['src/x.test.ts', 'test/a.test.ts', 'test/b.test.ts'],
    ),
  ).toEqual([
    'bun',
    'test',
    '--timeout',
    '5000',
    './src/x.test.ts',
    './test/a.test.ts',
  ]);
});

test('scopedTestCommand matches a folder on its boundary, not on a shared prefix', () => {
  expect(
    scopedTestCommand(['bun', 'test', './src'], ROOT, [
      'srcfoo/x.test.ts',
      'src/y.test.ts',
    ]),
  ).toEqual(['bun', 'test', './src/y.test.ts']);
});

test('scopedTestCommand without configured paths accepts every selected file', () => {
  expect(scopedTestCommand(['bun', 'test'], ROOT, ['a.test.ts'])).toEqual([
    'bun',
    'test',
    './a.test.ts',
  ]);
});

test('scopedTestCommand returns null when no selected file is in scope', () => {
  expect(
    scopedTestCommand(['bun', 'test', './src'], ROOT, ['test/x.test.ts']),
  ).toBeNull();
  expect(scopedTestCommand(['bun', 'test'], ROOT, [])).toBeNull();
});

test('scopedTestCommand returns the whole command when a path may be the value of a flag', () => {
  const command = ['bun', 'test', '--preload', './setup.ts', './src'];
  const scoped = scopedTestCommand(command, ROOT, ['src/x.test.ts']);
  expect(scoped).toEqual(command);
  expect(scoped).not.toBe(command);
});

test('scopedTestCommand only narrows bun test, whatever the program path is', () => {
  expect(
    scopedTestCommand(['npm', 'run', 'test'], ROOT, ['src/x.test.ts']),
  ).toEqual(['npm', 'run', 'test']);
  expect(
    scopedTestCommand(['/usr/bin/bun', 'test', './src'], ROOT, [
      'src/x.test.ts',
    ]),
  ).toEqual(['/usr/bin/bun', 'test', './src/x.test.ts']);
});

test('scopedTestCommand resolves absolute and parent paths against the root and normalizes separators', () => {
  expect(
    scopedTestCommand(['bun', 'test', '/proj/src/'], ROOT, ['src\\x.test.ts']),
  ).toEqual(['bun', 'test', './src/x.test.ts']);
  expect(
    scopedTestCommand(['bun', 'test', '../proj/src'], ROOT, ['src/x.test.ts']),
  ).toEqual(['bun', 'test', './src/x.test.ts']);
});

test('scopedTestCommand keeps a bare name filter in the command', () => {
  expect(
    scopedTestCommand(['bun', 'test', 'app.test.ts'], ROOT, ['app.test.ts']),
  ).toEqual(['bun', 'test', 'app.test.ts', './app.test.ts']);
});

test('testFilesFor picks the test files that quote an obligation id, in any extension', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentic-testfiles-'));
  try {
    const files: Record<string, string> = {
      'a.test.ts': `covers(['invariant:X/a'], 'one')`,
      'b.test.ts': `covers(['invariant:X/other'], 'two')`,
      'c.test.tsx': `covers(["invariant:X/a"], 'three')`,
      'sub/f.spec.js': 'covers([`invariant:X/a`], "four")',
      'g.test.ts': '// invariant:X/a mentioned but never quoted',
      'node_modules/pkg/d.test.ts': `covers(['invariant:X/a'], 'dep')`,
      '.worktrees/w/e.test.ts': `covers(['invariant:X/a'], 'other tree')`,
      'helper.ts': `covers(['invariant:X/a'], 'not a test file')`,
    };
    for (const [file, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), text);
    }
    await mkdir(join(root, 'folder.test.ts'));
    expect(await testFilesFor(root, ['invariant:X/a'])).toEqual([
      'a.test.ts',
      'c.test.tsx',
      'sub/f.spec.js',
    ]);
    expect(await testFilesFor(root, [])).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const node = (id: string, dependsOn: string[], obligations: string[]) => ({
  id,
  dependsOn,
  obligations,
});

test('closureObligations gathers the obligations of the item and of its dependencies, once each', () => {
  const items = [
    node('a', ['b', 'c'], ['a1']),
    node('b', ['d'], ['b1']),
    node('c', ['d'], ['c1']),
    node('d', [], ['d1']),
    node('unrelated', [], ['u1']),
  ];
  expect(closureObligations(items, 'a')).toEqual(['a1', 'b1', 'd1', 'c1']);
  expect(closureObligations(items, 'd')).toEqual(['d1']);
});

test('closureObligations stops on a dependency cycle and on an unknown id', () => {
  const items = [node('a', ['b'], ['a1']), node('b', ['a'], ['b1'])];
  expect(closureObligations(items, 'a')).toEqual(['a1', 'b1']);
  expect(closureObligations(items, 'missing')).toEqual([]);
});
