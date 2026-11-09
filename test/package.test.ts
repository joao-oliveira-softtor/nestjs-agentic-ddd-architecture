import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
test('package exposes only the eight public boundaries with declarations', () => {
  for (const boundary of [
    'core',
    'decorators',
    'compiler',
    'runtime',
    'nestjs',
    'elysia',
    'testing',
    'mcp',
  ]) {
    expect(pkg.exports?.[`./${boundary}`]?.types).toBe(
      `./dist/${boundary}/index.d.ts`,
    );
    expect(pkg.exports?.[`./${boundary}`]?.import).toBe(
      `./dist/${boundary}/index.js`,
    );
  }
  expect(Object.keys(pkg.exports).sort()).toEqual([
    '.',
    './compiler',
    './core',
    './decorators',
    './elysia',
    './mcp',
    './nestjs',
    './runtime',
    './testing',
  ]);
  expect(pkg.bin).toEqual({ 'agentic-ddd': './bin/agentic-ddd.js' });
});
test('package excludes demo dependencies and is publishable as agentic-ddd', () => {
  expect(pkg.dependencies.typescript).toBeDefined();
  expect(pkg.dependencies['@nestbun/platform']).toBeUndefined();
  expect(pkg.dependencies.typeorm).toBeUndefined();
  expect(pkg.peerDependencies['@nestjs/common']).toBeDefined();
  expect(pkg.name).toBe('agentic-ddd');
  expect(pkg.private).toBeUndefined();
  expect(pkg.scripts.prepublishOnly).toBeUndefined();
});
