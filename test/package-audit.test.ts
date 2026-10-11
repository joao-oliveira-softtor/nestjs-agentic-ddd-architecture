import { expect, test } from 'bun:test';
import { auditFile } from '../scripts/package-audit';

test('tarball audit accepts relative maps and rejects unrelated or sensitive files', () => {
  expect(auditFile('dist/core/entity.js', 'export class Entity {}')).toEqual(
    [],
  );
  expect(
    auditFile('dist/nestjs/agentic.module.js', 'export class AgenticModule {}'),
  ).toEqual([]);
  expect(
    auditFile(
      'dist/core/entity.js.map',
      JSON.stringify({
        sources: ['../../src/core/entity.ts'],
        sourcesContent: ['export class Entity {}'],
      }),
    ),
  ).toEqual([]);
  for (const file of [
    '.env',
    'node_modules/x.js',
    'dist/main.js',
    'dist/core/entity.test.js',
    'dist/compiler/__fixtures__/shop.js',
    'docs/superpowers/evidence.json',
    'src/core/entity.ts',
  ])
    expect(auditFile(file, '')).not.toEqual([]);
  expect(
    auditFile('dist/core/entity.js', '/workspace/private/checkout'),
  ).not.toEqual([]);
  expect(
    auditFile(
      'dist/core/entity.js.map',
      '{"sources":["C:\\Users\\person\\file.ts"]}',
    ),
  ).not.toEqual([]);
  expect(auditFile('dist/core/entity.js', 'ghp_' + 'a'.repeat(36))).not.toEqual(
    [],
  );
  expect(
    auditFile('dist/core/entity.js', '-----BEGIN PRIVATE KEY-----'),
  ).not.toEqual([]);
});
