import { afterAll, beforeAll, expect, test as bunTest } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { campaignSchema, controlMetrics } from '../scripts/evals/aggregate';
import {
  createScriptedAdapter,
  type ScriptedAction,
} from '../scripts/evals/adapters/scripted';
import {
  manifestSchema,
  type AdapterRequest,
  type EvalAdapter,
  type EvalReport,
  type RunManifest,
} from '../scripts/evals/contracts';
import { BARE_HIDDEN } from '../scripts/evals/implementation';
import { runEvaluation } from '../scripts/evals/run';
import { SOLUTIONS, completeItem } from '../scripts/evals/solutions/matriculas';
import { TUTORIALS } from '../scripts/evals/tutorials';
import { frozenSource } from './helpers/evals';

/**
 * Ensaio offline do controle cycle-22: os manifestos reais (adapter trocado por `scripted`, sem
 * autenticação, `sourceRef` em HEAD) rodam o harness de verdade em C0 e F. Nenhuma inferência.
 */
const insideVerify = process.env.AGENTIC_DDD_VERIFY === '1';
const test = (name: string, body: () => Promise<void>, timeoutMs = 900000) =>
  bunTest.skipIf(insideVerify)(name, body, timeoutMs);

const DIR = join(import.meta.dir, '../evals/campaigns/cycle-22-control');
const IDS = ['c0-r1', 'c0-r2', 'f-r1', 'f-r2'] as const;
const ITEMS = TUTORIALS.matriculas.items.map((i) => i.id);
const done = '{"status":"done","summary":"offline fixture"}';
const readJson = async (path: string) =>
  JSON.parse(await readFile(join(DIR, path), 'utf8')) as unknown;
const manifestOf = async (id: string) =>
  manifestSchema.parse(await readJson(`manifests/${id}.json`));

test('os quatro manifestos e o índice são válidos', async () => {
  const index = campaignSchema.parse(await readJson('index.json'));
  expect(index.runs.map((r) => r.id).sort()).toEqual([...IDS].sort());
  expect(index.runs.every((r) => r.result.status === 'not_run')).toBe(true);
  for (const id of IDS) {
    const manifest = await manifestOf(id);
    expect(manifest.benchmark).toBe('matriculas');
    expect(manifest.configurations[0]).toMatchObject({
      adapter: 'claude-cli',
      model: 'claude-sonnet-5-5',
      authentication: 'oauth-token',
      parameters: { reasoningEffort: 'medium' },
      promptMode: id.startsWith('c0') ? 'bare' : 'brief',
    });
    expect(manifest.budget.maxCorrectionsPerItem).toBe(1);
  }
});

test('o pré-registro cita sourceRef, tetos, configurações e modelo dos manifestos', async () => {
  const text = await readFile(join(DIR, 'PREREGISTRATION.md'), 'utf8');
  let ceiling = 0;
  for (const id of IDS) {
    const manifest = await manifestOf(id);
    expect(text).toContain(manifest.sourceRef);
    expect(text).toContain(manifest.configurations[0]!.id);
    expect(text).toContain(manifest.configurations[0]!.model);
    for (const n of [
      manifest.budget.maxInvocations,
      manifest.budget.skillTimeoutMs,
      manifest.budget.implementationTimeoutMs,
      manifest.budget.totalTimeoutMs,
    ])
      expect(text).toContain(String(n));
    ceiling += manifest.budget.maxInvocations;
  }
  expect(text).toContain(`${ceiling} invocações`);
});

const stripCovers = (text: string) =>
  text.replace(/covers\(\[[^\]]*\],\s*('[^']*')\)/g, '$1');
/** Armadilha A: a matrícula guarda o `Aluno` inteiro (T1 no C0). */
const WHOLE_ALUNO = {
  ...SOLUTIONS['entity:Matricula']!,
  bodies: [
    'const matricula = new Matricula(`${aluno.id}:${turma.id}`);\nmatricula.alunoId = aluno.alunoId;\nmatricula.turmaId = turma.turmaId;\nmatricula.aluno = aluno;\nreturn matricula;',
  ],
};
/** Armadilha C no VO e teste sem `covers`: o oráculo e o gate de cobertura reprovam. */
const BAD_VO = {
  ...SOLUTIONS['valueobject:AlunoId']!,
  bodies: ['return new AlunoId({ valor });'],
  test: stripCovers(SOLUTIONS['valueobject:AlunoId']!.test),
};

interface Seen {
  id: string;
  prompt: string;
  hidden: string[];
  present: string[];
}
let fixture: Awaited<ReturnType<typeof frozenSource>>;
let out: string;
beforeAll(async () => {
  if (insideVerify) return;
  fixture = await frozenSource();
  out = await mkdtemp(join(tmpdir(), 'eval-control-rehearsal-'));
}, 120000);
afterAll(async () => {
  await fixture?.cleanup();
  if (out) await rm(out, { recursive: true, force: true });
}, 60000);

async function rehearse(arm: 'c0' | 'f') {
  const real = await manifestOf(`${arm}-r1`);
  const configuration = real.configurations[0]!;
  const { authentication: _authentication, ...rest } = configuration;
  const manifest: RunManifest = {
    ...real,
    sourceRef: 'HEAD',
    // Só para o C0 ter uma execução que não termina (timeout) e repetir.
    budget: { ...real.budget, implementationTimeoutMs: 8000 },
    configurations: [{ ...rest, adapter: 'scripted' }],
  };
  const seen: Seen[] = [];
  const tries = new Map<string, number>();
  const adapter: EvalAdapter = {
    probe: () => createScriptedAdapter([]).probe(),
    run(request: AdapterRequest, options) {
      const attempt = (tries.get(request.id) ?? 0) + 1;
      tries.set(request.id, attempt);
      const timeout = arm === 'c0' && request.id === 'valueobject:TurmaId';
      const solution =
        arm === 'c0'
          ? request.id === 'entity:Matricula'
            ? WHOLE_ALUNO
            : request.id === 'entity:Turma'
              ? {
                  ...SOLUTIONS[request.id]!,
                  test: stripCovers(SOLUTIONS[request.id]!.test),
                }
              : undefined
          : request.id === 'valueobject:AlunoId' && attempt === 1
            ? BAD_VO
            : undefined;
      const action: ScriptedAction = {
        finalText: done,
        ...(timeout && attempt === 1 ? { delayMs: 20000 } : {}),
        before: async (r) => {
          seen.push({
            id: r.id,
            prompt: r.prompt,
            hidden: BARE_HIDDEN.filter((n) => !existsSync(join(r.cwd, n))),
            present: BARE_HIDDEN.filter((n) => existsSync(join(r.cwd, n))),
          });
          if (!(timeout && attempt === 1))
            await completeItem(r.cwd, r.id, solution);
          if (solution === WHOLE_ALUNO) {
            // O campo `aluno: Aluno` cabe na linha de `alunoId`, sem mudar a contagem de linhas.
            const file = join(r.cwd, 'app/domain/matricula.ts');
            await Bun.write(
              file,
              (await Bun.file(file).text()).replace(
                'alunoId!: AlunoId;',
                'alunoId!: AlunoId; aluno!: Aluno;',
              ),
            );
          }
        },
      };
      return createScriptedAdapter([action]).run(request, options);
    },
  };
  const report: EvalReport = await runEvaluation(manifest, {
    sourceRoot: fixture.source.originRoot,
    outDir: join(out, arm),
    real: false,
    signal: new AbortController().signal,
    adapters: new Map([[configuration.id, adapter]]),
  });
  const metrics = controlMetrics([
    { slot: { configuration: configuration.id }, report } as never,
  ]);
  return { report, seen, metrics };
}

const items = (r: EvalReport) => r.benchmarks[0]!.items;

test('F: as soluções de referência aceitam os 7 itens; a correção não leva o oráculo', async () => {
  const { report, seen, metrics } = await rehearse('f');
  expect(items(report).map((i) => i.item)).toEqual(ITEMS);
  expect(items(report).every((i) => i.state === 'accepted')).toBe(true);
  const bad = items(report).find((i) => i.item === 'valueobject:AlunoId')!;
  expect(bad.attempts).toHaveLength(2);
  // A 1ª tentativa reprovou o oráculo (nomes trap:*) e os gates do framework.
  expect(
    bad.attempts[0]!.verification!.findings.some((f) =>
      f.startsWith('Private behavior oracle failed'),
    ),
  ).toBe(true);
  const correction = seen.filter((s) => s.id === bad.item)[1]!.prompt;
  expect(correction).toContain('Findings:');
  expect(correction).not.toContain('Private behavior oracle');
  expect(correction).not.toContain('trap:');
  // O F mantém skill e regras no workspace.
  expect(seen.every((s) => s.hidden.length === 0)).toBe(true);
  expect(metrics.items.map((i) => i.item)).toEqual(ITEMS);
  for (const m of metrics.items) {
    expect(m.measured).toBe(1);
    expect(m.tacticalViolations).toBe(0);
  }
  expect(metrics.items.map((i) => i.oracleAccepted.last)).toEqual(
    Array(7).fill(1),
  );
});

test('C0: roda os 7 itens, mede o oráculo e T1, repete sem findings e esconde os arquivos no turno', async () => {
  const { report, seen, metrics } = await rehearse('c0');
  expect(items(report).map((i) => i.item)).toEqual(ITEMS);
  expect(items(report).every((i) => i.attempts.length >= 1)).toBe(true);
  expect(metrics.items.map((i) => i.item)).toEqual(ITEMS);
  for (const m of metrics.items) expect(m.measured).toBe(1);
  const byItem = (id: string) => metrics.items.find((i) => i.item === id)!;
  expect(byItem('entity:Matricula').tacticalViolations).toBeGreaterThan(0);
  expect(byItem('entity:Matricula').oracleAccepted.first).toBe(0);
  expect(byItem('entity:Matricula').trapDefects.A).toBeGreaterThan(0);
  expect(byItem('entity:Aluno').oracleAccepted.first).toBe(1);
  // Sem `covers` o C0 continua aceito pelo oráculo (só ele conta no C0).
  expect(byItem('entity:Turma').oracleAccepted.first).toBe(1);
  // Execução que não terminou: uma retentativa, sem findings nem patch.
  const retried = items(report).find((i) => i.item === 'valueobject:TurmaId')!;
  expect(retried.attempts).toHaveLength(2);
  expect(retried.attempts[0]!.execution.transport).toBe('timeout');
  const correction = seen.filter((s) => s.id === retried.item)[1]!.prompt;
  expect(correction).toContain(
    'a submissão anterior não terminou; refaça a partir do baseline',
  );
  expect(correction).not.toContain('Findings');
  expect(correction).not.toContain('Patch anterior');
  // Arquivos ocultos durante o turno; depois a auditoria e o verify rodam (precisam deles).
  expect(seen.every((s) => s.present.length === 0)).toBe(true);
  for (const item of items(report))
    for (const a of item.attempts.filter(
      (a) => a.execution.transport === 'finished',
    )) {
      expect(a.audit).not.toBeNull();
      expect(a.verification?.itemReport).toBeTruthy();
    }
});
