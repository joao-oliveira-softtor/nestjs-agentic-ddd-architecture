import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parseJUnit } from '@agentic-ddd/compiler';
import { TASK_ITEMS } from '../scripts/evals/audit';
import type { ProcessResult } from '../scripts/evals/contracts';
import { TUTORIALS, collaborators } from '../scripts/evals/tutorials';
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

describe('matriculas', () => {
  const { items, oracleCases, referenceDir } = TUTORIALS.matriculas;
  test('oracleCases lista os casos de cada oráculo privado', async () => {
    const files = await readdir(join(ROOT, referenceDir));
    expect(files.length).toBe(items.length);
    for (const item of items) {
      const source = await readFile(
        join(ROOT, referenceDir, basename(item.test) + '.txt'),
        'utf8',
      );
      const names = [...source.matchAll(/^test\('(.+?)',/gm)].map((m) => m[1]!);
      expect(names.sort()).toEqual([...oracleCases[item.id]!].sort());
    }
  });
  test('colaboradores: dependsOn, references e raízes dos ports, em fecho', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'collab-'));
    try {
      const root = join(dir, 'm');
      expect(
        Bun.spawnSync(
          [
            process.execPath,
            'scripts/create-skills-example.ts',
            '--root',
            root,
            '--tutorial',
            'matriculas',
          ],
          { cwd: ROOT },
        ).exitCode,
      ).toBe(0);
      const json = (arg: string) =>
        JSON.parse(
          Bun.spawnSync([process.execPath, 'run', 'agentic', arg, '--json'], {
            cwd: root,
          }).stdout.toString(),
        );
      const status = json('status') as {
        items: { id: string; dependsOn: string[] }[];
      };
      expect(status.items.map((i) => i.id).sort()).toEqual(
        items.map((i) => i.id).sort(),
      );
      const ir = JSON.parse(
        Bun.spawnSync([process.execPath, 'run', 'agentic', 'ir'], {
          cwd: root,
        }).stdout.toString(),
      );
      const dependsOn = Object.fromEntries(
        status.items.map((i) => [i.id, i.dependsOn]),
      );
      const closure = (id: string) => collaborators(id, dependsOn, ir);
      const domain = [
        'entity:Aluno',
        'entity:Turma',
        'valueobject:AlunoId',
        'valueobject:TurmaId',
      ];
      expect(closure('valueobject:AlunoId')).toEqual([]);
      expect(closure('valueobject:TurmaId')).toEqual([]);
      expect(closure('entity:Aluno')).toEqual(['valueobject:AlunoId']);
      expect(closure('entity:Turma')).toEqual(['valueobject:TurmaId']);
      expect(closure('entity:Matricula')).toEqual(domain);
      const all = [...domain, 'entity:Matricula'].sort();
      expect(closure('usecase:matricular_aluno')).toEqual(all);
      expect(closure('adapter:InMemoryMatriculaRepository')).toEqual(all);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60000);
});
