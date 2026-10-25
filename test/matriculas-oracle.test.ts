import { afterAll, beforeAll, expect, test } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  completeItem,
  SOLUTIONS,
  type Solution,
} from '../scripts/evals/solutions/matriculas';

const ROOT = resolve(import.meta.dir, '..');
const ORACLES = join(ROOT, 'evals/implementation/matriculas/reference');
const ITEMS = Object.keys(SOLUTIONS);
const TIMEOUT = 300_000;
const temps: string[] = [];

async function run(cwd: string, argv: string[]) {
  const proc = Bun.spawn(argv, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode: await proc.exited, stdout, stderr };
}

async function workspace(planted: Record<string, Solution> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'matriculas-oracle-'));
  temps.push(dir);
  const root = join(dir, 'ws');
  const made = await run(ROOT, [
    process.execPath,
    'scripts/create-skills-example.ts',
    '--root',
    root,
    '--tutorial',
    'matriculas',
  ]);
  expect(made.exitCode).toBe(0);
  for (const id of ITEMS)
    await completeItem(root, id, planted[id] ?? SOLUTIONS[id]);
  return root;
}

async function oracle(root: string, id: string) {
  const name = id.replaceAll(/[:.]/g, '-') + '.test.ts.txt';
  const template = await readFile(join(ORACLES, name), 'utf8');
  await mkdir(join(root, '.eval-reference'), { recursive: true });
  await writeFile(
    join(root, '.eval-reference/behavior.test.ts'),
    template.replaceAll('__WORKSPACE__', root),
  );
  const result = await run(root, [
    process.execPath,
    'test',
    join(root, '.eval-reference/behavior.test.ts'),
  ]);
  const failed = [
    ...(result.stderr + result.stdout).matchAll(
      /^\(fail\) (.+?)(?: \[[\d.]+ms\])?$/gm,
    ),
  ].map((m) => m[1]!);
  return { ...result, failed };
}

const planted = (id: string, bodies: string[]): Record<string, Solution> => ({
  [id]: { ...SOLUTIONS[id]!, bodies },
});

let reference: string;
beforeAll(async () => {
  reference = await workspace();
}, TIMEOUT);
afterAll(async () => {
  await Promise.all(temps.map((d) => rm(d, { recursive: true, force: true })));
});

test('every item has a private oracle with only trap:/base: cases', async () => {
  const files = await readdir(ORACLES);
  expect(files.sort()).toEqual(
    ITEMS.map((id) => id.replaceAll(/[:.]/g, '-') + '.test.ts.txt').sort(),
  );
  for (const file of files) {
    const names = [
      ...(await readFile(join(ORACLES, file), 'utf8')).matchAll(
        /^test\('(.+?)',/gm,
      ),
    ].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toMatch(/^(trap:[ABCD]|base:)/);
  }
});

for (const id of ITEMS) {
  test(
    `reference solutions pass the oracle of ${id}`,
    async () => {
      const result = await oracle(reference, id);
      expect(result.failed).toEqual([]);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT,
  );

  test(
    `verify --item ${id} is done with the reference solutions`,
    async () => {
      const status = await run(reference, [
        process.execPath,
        'run',
        'agentic',
        'status',
        '--json',
      ]);
      const { items } = JSON.parse(
        status.stdout.slice(status.stdout.indexOf('{')),
      ) as { items: { id: string; specHash: string }[] };
      const result = await run(reference, [
        process.execPath,
        'run',
        'agentic',
        'verify',
        '--item',
        id,
        '--spec-hash',
        items.find((i) => i.id === id)!.specHash,
        '--json',
      ]);
      const report = JSON.parse(
        result.stdout.slice(result.stdout.indexOf('{')),
      ) as {
        status: string;
        gates: { id: string; status: string }[];
      };
      expect(report.status).toBe('done');
      expect(report.gates.length).toBeGreaterThanOrEqual(5);
      expect(report.gates.every((g) => g.status === 'passed')).toBe(true);
    },
    TIMEOUT,
  );
}

const TRAPS: [string, string, string[]][] = [
  [
    'A',
    'entity:Matricula',
    [
      'const matricula = new Matricula(`${aluno.id}:${turma.id}`);\nmatricula.alunoId = aluno.alunoId;\nmatricula.turmaId = turma.turmaId;\n(matricula as unknown as { aluno: Aluno }).aluno = aluno;\nreturn matricula;',
    ],
  ],
  [
    'B',
    'usecase:matricular_aluno',
    [
      `const { AlunoId } = await import('../domain/aluno-id');
const { TurmaId } = await import('../domain/turma-id');
const aluno = await this.alunos.findById(AlunoId.criar(input.aluno_id));
if (!aluno) throw new DomainError('ALUNO_NAO_ENCONTRADO', 'Aluno não encontrado.');
const turma = await this.turmas.findById(TurmaId.criar(input.turma_id));
if (!turma) throw new DomainError('TURMA_NAO_ENCONTRADA', 'Turma não encontrada.');
if (aluno.status !== 'ativo') throw new DomainError('ALUNO_INATIVO', 'Aluno inativo.');
const matricula = Matricula.criar(aluno, turma);
await this.matriculas.save(matricula);
return { matricula_id: matricula.id };`,
    ],
  ],
  ['C', 'valueobject:AlunoId', ['return new AlunoId({ valor });']],
  [
    'D',
    'adapter:InMemoryMatriculaRepository',
    ['this.#matriculas.push(matricula);', 'return this.#matriculas.length;'],
  ],
];

for (const [trap, id, bodies] of TRAPS)
  test(
    `planted wrong solution for trap ${trap} fails a trap:${trap} case`,
    async () => {
      const root = await workspace(planted(id, bodies));
      const result = await oracle(root, id);
      expect(result.failed.some((n) => n.startsWith(`trap:${trap} `))).toBe(
        true,
      );
    },
    TIMEOUT,
  );
