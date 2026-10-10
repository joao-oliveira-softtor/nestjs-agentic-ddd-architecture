import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
test('package exposes only the six public boundaries with declarations', () => {
  for (const boundary of [
    'core',
    'decorators',
    'compiler',
    'runtime',
    'nestjs',
    'testing',
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
    './nestjs',
    './runtime',
    './testing',
  ]);
  expect(pkg.bin).toEqual({ 'agentic-ddd': './bin/agentic-ddd.js' });
});
test('package excludes demo dependencies and guards actual publication', () => {
  expect(pkg.dependencies.typescript).toBeDefined();
  expect(pkg.dependencies['@nestbun/platform']).toBeUndefined();
  expect(pkg.dependencies.typeorm).toBeUndefined();
  expect(pkg.peerDependencies['@nestjs/common']).toBeDefined();
  expect(pkg.scripts.prepublishOnly).toContain('block-publish');
  expect(pkg.private).toBe(true);
});

test('publication gate exits unsuccessfully without invoking npm', () => {
  const gate = Bun.spawnSync(['node', 'scripts/block-publish.cjs'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(gate.exitCode).toBe(1);
  expect(gate.stderr.toString()).toContain('validate the final package name');
});
