import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseJUnit, runTests, unescapeXml } from './test-run';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="3" failures="1" skipped="1">
  <testsuite name="a/x.test.ts" file="a/x.test.ts" tests="3">
    <testsuite name="Order" file="a/x.test.ts" line="1">
      <testcase name="[covers: method:A.b] passa &amp; &quot;ok&quot; &lt;x&gt;" classname="Order" time="0.1" file="a/x.test.ts" line="2" assertions="1" />
    </testsuite>
    <testcase name="[covers: method:A.c, criterion:0002/x] falha" classname="" time="0.2" file="a/x.test.ts" line="5" assertions="1">
      <failure type="AssertionError" message="expect(received).toBe(expected)&#10;">AssertionError&#10;</failure>
    </testcase>
    <testcase name="sem covers pulado" classname="" time="0" file="a/x.test.ts" line="8" assertions="0">
      <skipped />
    </testcase>
  </testsuite>
</testsuites>`;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agentic-testrun-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parseJUnit', () => {
  test('extrai nome, arquivo, linha, status e covers, inclusive em describe aninhado', () => {
    expect(parseJUnit(XML)).toEqual([
      {
        name: '[covers: method:A.b] passa & "ok" <x>',
        file: 'a/x.test.ts',
        line: 2,
        status: 'passed',
        covers: ['method:A.b'],
      },
      {
        name: '[covers: method:A.c, criterion:0002/x] falha',
        file: 'a/x.test.ts',
        line: 5,
        status: 'failed',
        covers: ['method:A.c', 'criterion:0002/x'],
      },
      {
        name: 'sem covers pulado',
        file: 'a/x.test.ts',
        line: 8,
        status: 'skipped',
        covers: [],
      },
    ]);
  });

  test('unescapeXml trata entidades nomeadas e numéricas', () => {
    expect(unescapeXml('a &amp; b &#10;c &#x41; &apos;d&apos;')).toBe(
      "a & b \nc A 'd'",
    );
  });

  test('XML vazio dá lista vazia', () => {
    expect(parseJUnit('')).toEqual([]);
  });
});

describe('runTests', () => {
  test('roda a suíte num diretório, devolve o exit code e marca o ambiente do verify', async () => {
    await writeFile(
      join(dir, 'a.test.ts'),
      [
        "import { expect, test } from 'bun:test';",
        "test('[covers: method:A.ok] passa', () => { expect(1).toBe(1); });",
        "test('[covers: method:A.no] falha', () => { expect(1).toBe(2); });",
        "test('[covers: method:A.env] vê o ambiente do verify', () => { expect(process.env.AGENTIC_DDD_VERIFY).toBe('1'); });",
        '',
      ].join('\n'),
    );
    const run = await runTests(['bun', 'test'], dir);
    expect(run.exitCode).toBe(1);
    expect(run.cases.map((c) => [c.covers[0], c.status])).toEqual([
      ['method:A.ok', 'passed'],
      ['method:A.no', 'failed'],
      ['method:A.env', 'passed'],
    ]);
  });
});

test('coleta ausente não pode certificar conclusão', async () => {
  const run = await runTests(['bun', '-e', 'process.exit(0)'], dir);
  expect(run.collectionError).toContain('JUnit');
});

test('JUnit parcial por falha de import não certifica conclusão, mesmo com outra assertion falhando', async () => {
  await writeFile(
    join(dir, 'a.test.ts'),
    `import { test, expect } from 'bun:test'; test('[covers: method:A.x] passa', () => expect(1).toBe(1));`,
  );
  await writeFile(
    join(dir, 'b.test.ts'),
    `throw new Error('collection failed');`,
  );
  for (const withFailure of [false, true]) {
    if (withFailure)
      await writeFile(
        join(dir, 'c.test.ts'),
        `import { test, expect } from 'bun:test'; test('falha não relacionada', () => expect(1).toBe(2));`,
      );
    const result = await runTests(['bun', 'test'], dir);
    expect(result.exitCode).toBe(1);
    expect(result.collectionError).toContain('JUnit');
    expect(
      result.cases.find((c) => c.covers.includes('method:A.x'))?.status,
    ).toBe('passed');
  }
});
