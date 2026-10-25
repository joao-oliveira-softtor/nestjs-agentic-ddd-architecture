import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { parseJUnit } from '@agentic-ddd/compiler';
import { TASK_ITEMS } from '../scripts/evals/audit';
import type { ProcessResult } from '../scripts/evals/contracts';
import {
  ORACLE_CASES,
  gateCountValid,
  testRunOf,
} from '../scripts/evals/reference';

const ROOT = resolve(import.meta.dir, '..');

function result(stderr: string, exitCode = 0): ProcessResult {
  return {
    transport: 'finished',
    exitCode,
    signal: null,
    stdout: '',
    stderr,
    durationMs: 1,
    evidence: [],
    diagnostic: null,
  };
}
function junit(...names: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n<testsuite name="t" file="t.test.ts">\n${names
    .map((n) => `<testcase name="${n}" classname="" file="t.test.ts" />`)
    .join('\n')}\n</testsuite>\n</testsuites>\n`;
}
const summary = (n: number, files = 1) =>
  ` ${n} pass\n 0 fail\nRan ${n} ${n === 1 ? 'test' : 'tests'} across ${files} ${files === 1 ? 'file' : 'files'}. [5.00ms]\n`;

describe('testRunOf', () => {
  test('aceita JUnit válido com o resumo final do Bun na mesma contagem', () => {
    expect(
      testRunOf(result(summary(2)), junit('a', 'b')).collectionError,
    ).toBeUndefined();
    expect(
      testRunOf(result(summary(1)), junit('a')).collectionError,
    ).toBeUndefined();
  });

  test('rejeita stderr sem o resumo final do Bun', () => {
    expect(
      testRunOf(result(' 2 pass\n 0 fail\n'), junit('a', 'b')).collectionError,
    ).toBeDefined();
  });

  test('rejeita resumo com contagem diferente da do JUnit', () => {
    expect(
      testRunOf(result(summary(3)), junit('a', 'b')).collectionError,
    ).toBeDefined();
  });

  test('vale o último resumo: um resumo forjado antes do real não aprova', () => {
    expect(
      testRunOf(result(summary(2) + 'log\n' + summary(3)), junit('a', 'b'))
        .collectionError,
    ).toBeDefined();
    expect(
      testRunOf(result(summary(3) + 'log\n' + summary(2)), junit('a', 'b'))
        .collectionError,
    ).toBeUndefined();
  });

  test('rejeita erro não tratado entre testes', () => {
    expect(
      testRunOf(
        result('# Unhandled error between tests\n' + summary(2)),
        junit('a', 'b'),
      ).collectionError,
    ).toBeDefined();
  });

  test('com nomes esperados, exige o mesmo multiconjunto de nomes', () => {
    const expected = ['a', 'a', 'b'];
    const run = (...names: string[]) =>
      testRunOf(result(summary(names.length)), junit(...names), expected)
        .collectionError;
    expect(run('a', 'b', 'a')).toBeUndefined();
    expect(run('a', 'b')).toBeDefined();
    expect(run('a', 'a', 'b', 'b')).toBeDefined();
    expect(run('a', 'a', 'c')).toBeDefined();
  });
});

test('ORACLE_CASES bate com os JUnits do oráculo publicados na campanha 20', async () => {
  const published = await Array.fromAsync(
    new Bun.Glob(
      'docs/superpowers/validation/2026-10-10-evals-20/**/reference-junit.xml',
    ).scan({ cwd: ROOT }),
  );
  expect(published.length).toBeGreaterThan(0);
  const seen = new Set<string>();
  for (const path of published) {
    // .../<item>/attempt-N/verification/reference-junit.xml
    const dir = basename(dirname(dirname(dirname(path))));
    const assignment = TASK_ITEMS.find(
      (i) => basename(i.test, '.test.ts') === dir,
    );
    expect(assignment).toBeDefined();
    const names = parseJUnit(await readFile(join(ROOT, path), 'utf8')).map(
      (c) => c.name,
    );
    expect(names.sort()).toEqual([...ORACLE_CASES[assignment!.id]!].sort());
    seen.add(assignment!.id);
  }
  expect([...seen].sort()).toEqual(TASK_ITEMS.map((i) => i.id).sort());
  expect(Object.keys(ORACLE_CASES).sort()).toEqual([...seen].sort());
});

describe('gateCountValid', () => {
  const gates = (...ids: string[]) => ids.map((id) => ({ id }));
  test('5 gates, ou 6 com T', () => {
    expect(gateCountValid(gates('I1', 'I2', 'I3', 'I4', 'I5'))).toBe(true);
    expect(gateCountValid(gates('I1', 'I2', 'I3', 'I4', 'I5', 'T'))).toBe(true);
    expect(gateCountValid(gates('I1', 'I2', 'I3', 'I4', 'I5', 'G1'))).toBe(
      false,
    );
  });
});
