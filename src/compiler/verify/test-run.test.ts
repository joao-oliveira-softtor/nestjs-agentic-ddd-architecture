import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isEmptySuite, parseJUnit, runTests, unescapeXml } from './test-run';

// Empty-suite phrases observed on Bun 1.4.2+744846f84 (`bun --revision`).
// These are synthetic; src/cli/coordination.test.ts and
// test/skills-example.test.ts run the real Bun against a project with no tests.
const NO_FILES_LINE =
  'error: 0 test files matching **{.test,.spec,_test_,_spec_}.{js,ts,jsx,tsx} in --cwd="/abs/path"';
const CASE = {
  name: '[covers: method:A.x] passa',
  file: 'a.test.ts',
  line: 1,
  status: 'passed' as const,
  covers: ['method:A.x'],
};

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

describe('isEmptySuite', () => {
  test('`No tests found!` é suíte vazia', () => {
    expect(isEmptySuite({ stderr: 'No tests found!\n', cases: [] })).toBe(true);
  });

  test('`Ran 0 tests across 1 file.` (singular) é suíte vazia', () => {
    expect(
      isEmptySuite({
        stderr: 'Ran 0 tests across 1 file.\n',
        cases: [],
      }),
    ).toBe(true);
  });

  test('`Ran 0 tests across 3 files.` (plural) é suíte vazia', () => {
    expect(
      isEmptySuite({
        stderr: 'Ran 0 tests across 3 files.\n',
        cases: [],
      }),
    ).toBe(true);
  });

  test('`error: 0 test files matching …` (exit 1, sem arquivos de teste) é suíte vazia', () => {
    expect(
      isEmptySuite({
        stderr: `${NO_FILES_LINE}\n`,
        cases: [],
      }),
    ).toBe(true);
  });

  test('filtro de caminho sem match (`Test filter … had no matches`) não é suíte vazia', () => {
    expect(
      isEmptySuite({
        stderr: 'Test filter "./x" had no matches in --cwd="/abs/path"\n',
        cases: [],
      }),
    ).toBe(false);
  });

  test('frase vazia acompanhada de `# Unhandled error between tests` não é suíte vazia', () => {
    for (const phrase of [
      'No tests found!',
      'Ran 0 tests across 1 file.',
      NO_FILES_LINE,
    ]) {
      expect(
        isEmptySuite({
          stderr: `# Unhandled error between tests\n${phrase}\n`,
          cases: [],
        }),
      ).toBe(false);
    }
  });

  test('erro de import (`Cannot find module` + `Ran 1 test`) não é suíte vazia', () => {
    expect(
      isEmptySuite({
        stderr: [
          '# Unhandled error between tests',
          'error: Cannot find module "./nao-existe" from "/abs/path/a.test.ts"',
          '',
          'Ran 1 test across 1 file.',
        ].join('\n'),
        cases: [],
      }),
    ).toBe(false);
  });

  test('`cases.length > 0` nunca é suíte vazia, mesmo com frase vazia no stderr', () => {
    expect(
      isEmptySuite({
        stderr: 'Ran 0 tests across 1 file.\n',
        cases: [CASE],
      }),
    ).toBe(false);
  });

  test('frase vazia precisa começar a linha (não casa no meio de texto)', () => {
    expect(
      isEmptySuite({
        stderr: 'algo qualquer: No tests found!\n',
        cases: [],
      }),
    ).toBe(false);
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
