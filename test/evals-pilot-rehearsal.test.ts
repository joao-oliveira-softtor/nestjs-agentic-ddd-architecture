import { afterAll, beforeAll, expect, test as bunTest } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aggregateCampaign } from '../scripts/evals/aggregate';
import {
  createScriptedAdapter,
  type ScriptedAction,
} from '../scripts/evals/adapters/scripted';
import {
  available,
  emptyUsage,
  manifestSchema,
  type EvalAdapter,
  type EvalReport,
  type RunManifest,
  type Usage,
} from '../scripts/evals/contracts';
import {
  REVIEW_MAX_TOKENS,
  prepareTasksBaseline,
} from '../scripts/evals/implementation';
import { PILOT_ARMS, classifyPilotReport } from '../scripts/evals/pilot';
import { runEvaluation } from '../scripts/evals/run';
import { frozenSource } from './helpers/evals';
import { completeItem } from './helpers/tasks-solution';

/**
 * Ensaio offline do piloto cycle-21: os manifestos reais (adapter trocado por `scripted`,
 * sem autenticação, `sourceRef` em HEAD) rodam o harness de verdade em dois roteiros, e o
 * agregador real alimenta a regra I/S/P/M. Nenhuma inferência. A r1 de cada braço é o roteiro
 * (a), em que todo item é aceito na primeira tentativa; a r2 é o roteiro (b), em que todo item
 * é aceito só na última tentativa possível, o que esgota o teto de invocações do braço.
 */
const insideVerify = process.env.AGENTIC_DDD_VERIFY === '1';
const test = (name: string, body: () => Promise<void>, timeoutMs = 120000) =>
  bunTest.skipIf(insideVerify)(name, body, timeoutMs);

const PILOT = join(import.meta.dir, '../evals/campaigns/cycle-21-pilot');
const HAIKU = 'claude-haiku-5-5';
const SONNET = 'claude-sonnet-5-5';
const OPUS = 'claude-opus-5-5';
const done = '{"status":"done","summary":"offline fixture"}';
const blocked = '{"status":"blocked","summary":"offline fixture"}';
const approved = '{"status":"approved","findings":[]}';
const ARMS = Object.values(PILOT_ARMS);
type Arm = (typeof ARMS)[number];
const ITEMS = 5;

/** Uso sintético por modelo; o piloto real mede o uso, aqui ele só dá custo ao ensaio. */
const usageOf = (model: string, readTokens: number): Usage => ({
  ...emptyUsage(),
  cacheWriteInputTokens: available(0, 'fixture'),
  byModel: {
    [model]: {
      uncachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      cacheReadInputTokens: readTokens,
      outputTokens: 0,
    },
  },
});
/** Controles pagam 10 M de leitura por invocação; o A3 paga pouco, e o Haiku abaixo do limiar. */
const readTokens = (arm: Arm, model: string) =>
  arm === PILOT_ARMS.a3 ? (model === HAIKU ? 50_000 : 1_000_000) : 10_000_000;

/** Última tentativa possível do item: 2 por degrau, e o domínio passa pelos 3 degraus. */
const lastAttempt = (arm: Arm, itemId: string) =>
  arm !== PILOT_ARMS.a3
    ? 2
    : itemId.startsWith('entity:') || itemId.startsWith('method:')
      ? 6
      : 4;

function adapterFor(
  arm: Arm,
  configModel: string,
  succeedAt: (itemId: string) => number,
): EvalAdapter {
  const tries = new Map<string, number>();
  const one = (action: ScriptedAction) => createScriptedAdapter([action]);
  return {
    probe: () => createScriptedAdapter([]).probe(),
    run(request, options) {
      const model = request.model ?? configModel;
      const usage = usageOf(model, readTokens(arm, model));
      if (request.mode === 'review')
        return one({ finalText: approved, usage }).run(request, options);
      const attempt = (tries.get(request.id) ?? 0) + 1;
      tries.set(request.id, attempt);
      return one(
        attempt >= succeedAt(request.id)
          ? {
              finalText: done,
              usage,
              before: (r) => completeItem(r.cwd, r.id),
            }
          : { finalText: blocked, usage },
      ).run(request, options);
    },
  };
}

let fixture: Awaited<ReturnType<typeof frozenSource>>;
let out: string;
beforeAll(async () => {
  if (insideVerify) return;
  fixture = await frozenSource();
  out = await mkdtemp(join(tmpdir(), 'eval-pilot-rehearsal-'));
  await mkdir(join(out, 'manifests'), { recursive: true });
  await prepareTasksBaseline(fixture.source, {
    outDir: join(out, 'warmup'),
    real: false,
    signal: new AbortController().signal,
  });
}, 120000);
afterAll(async () => {
  await fixture?.cleanup();
  if (out) await rm(out, { recursive: true, force: true });
}, 60000);

interface Rehearsed {
  id: string;
  report: EvalReport;
  manifestText: string;
  reportText: string;
}
const rehearsals = new Map<string, Promise<Rehearsed>>();
/** Roda (uma vez) o braço e a repetição; os testes não dependem da ordem de execução. */
function rehearse(arm: Arm, repetition: 1 | 2): Promise<Rehearsed> {
  const id = `${arm}-r${repetition}`;
  const cached = rehearsals.get(id);
  if (cached) return cached;
  const run = (async () => {
    const real = manifestSchema.parse(
      JSON.parse(await readFile(join(PILOT, `manifests/${id}.json`), 'utf8')),
    );
    const configuration = real.configurations[0]!;
    const { authentication: _authentication, ...rest } = configuration;
    const manifest: RunManifest = {
      ...real,
      sourceRef: 'HEAD',
      configurations: [{ ...rest, adapter: 'scripted' }],
    };
    const manifestText = JSON.stringify(manifest, null, 2) + '\n';
    await writeFile(join(out, `manifests/${id}.json`), manifestText);
    const report = await runEvaluation(manifest, {
      sourceRoot: fixture.source.originRoot,
      outDir: join(out, 'runs', id),
      real: false,
      signal: new AbortController().signal,
      adapters: new Map([
        [
          arm,
          adapterFor(
            arm,
            configuration.model,
            repetition === 1 ? () => 1 : (item) => lastAttempt(arm, item),
          ),
        ],
      ]),
    });
    return {
      id,
      report,
      manifestText,
      reportText: await readFile(join(out, 'runs', id, 'report.json'), 'utf8'),
    };
  })();
  rehearsals.set(id, run);
  return run;
}

const attemptsOf = (r: Rehearsed) =>
  r.report.benchmarks[0]!.items.reduce((n, i) => n + i.attempts.length, 0);
const invocationsOf = (r: Rehearsed) =>
  attemptsOf(r) + (r.report.benchmarks[0]!.review?.dispatched ? 1 : 0);
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

for (const arm of ARMS) {
  const routed = arm === PILOT_ARMS.a3;
  const ceiling = routed ? 25 : 10;

  test(`${arm}: roteiro (a), todo item aceito na primeira tentativa`, async () => {
    const r = await rehearse(arm, 1);
    const benchmark = r.report.benchmarks[0]!;
    expect(r.report.status).toBe('completed');
    expect(benchmark.items.map((i) => i.state)).toEqual(
      Array(ITEMS).fill('accepted'),
    );
    expect(benchmark.items.every((i) => i.attempts.length === 1)).toBe(true);
    expect(invocationsOf(r)).toBe(routed ? ITEMS + 1 : ITEMS);
    expect(benchmark.review?.outcome).toBe(routed ? 'approved' : undefined);
  });

  test(
    `${arm}: roteiro (b), todo item aceito só na última tentativa e o teto de ${ceiling} é atingido sem estourar`,
    async () => {
      const r = await rehearse(arm, 2);
      const benchmark = r.report.benchmarks[0]!;
      expect(r.report.status).toBe('completed');
      expect(benchmark.items.map((i) => i.state)).toEqual(
        Array(ITEMS).fill('accepted'),
      );
      expect(invocationsOf(r)).toBe(ceiling);
      expect(r.report.manifest.budget.maxInvocations).toBe(ceiling);
      if (routed) {
        // Revisão despachada com a vaga reservada; o domínio percorre os 3 degraus.
        expect(benchmark.review).toMatchObject({
          outcome: 'approved',
          dispatched: true,
        });
        const domain = benchmark.items.find((i) => i.item === 'entity:Task')!;
        expect(domain.attempts.map((a) => a.model)).toEqual([
          HAIKU,
          HAIKU,
          SONNET,
          SONNET,
          OPUS,
          OPUS,
        ]);
      }
    },
    routed ? 600000 : 120000,
  );
}

test('o maxTokens do revisor cobre 3x o maior brief do ensaio e da estimativa do cycle-20', async () => {
  const r = await rehearse(PILOT_ARMS.a3, 1);
  const briefTokens = r.report.benchmarks[0]!.review!.briefTokens ?? 0;
  expect(briefTokens).toBeGreaterThan(0);
  // ~13k tokens: patches aceitos do cycle-20 por approxTokens; piso de 50000 (janela do Opus).
  expect(REVIEW_MAX_TOKENS).toBeGreaterThanOrEqual(
    Math.max(50_000, 3 * Math.max(briefTokens, 13_000)),
  );
});

/** Índice temporário a partir dos relatórios do ensaio; `skip` troca uma execução por `not_run`. */
async function pilotIndex(skip: string[] = []) {
  const runs = [];
  for (const repetition of [1, 2] as const) {
    for (const arm of ARMS) {
      const r = await rehearse(arm, repetition);
      const skipped = skip.includes(r.id);
      runs.push({
        id: r.id,
        configuration: arm,
        repetition,
        plannedCases: 0,
        manifest: {
          path: `manifests/${r.id}.json`,
          sha256: sha(r.manifestText),
        },
        result: skipped
          ? { status: 'not_run', reason: 'not_executed_yet' }
          : {
              status: 'executed',
              report: {
                path: `runs/${r.id}/report.json`,
                sha256: sha(r.reportText),
              },
            },
      });
    }
  }
  const path = join(out, `index-${skip.length}.json`);
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      id: 'cycle-21-pilot-rehearsal',
      repetitionsPerConfiguration: 2,
      runs,
    }),
  );
  return path;
}

test('agregado dos 4 braços: aceite igual e custo menor no A3 classificam como P', async () => {
  const aggregate = await aggregateCampaign(await pilotIndex());
  for (const c of aggregate.configurations)
    expect(c.final.numerator).toBe(2 * ITEMS);
  const a3 = aggregate.configurations.find(
    (c) => c.configuration === PILOT_ARMS.a3,
  )!;
  expect(a3.cost.available).toBe(true);
  expect(a3.cost.lowerBound).toBe(false);
  expect(classifyPilotReport(aggregate)).toMatchObject({
    classification: 'P',
    reason: 'rule',
    bands: { expensive: 'P', cheap: 'P' },
  });
}, 600000);

test('a r2 do A3 como not_run torna o piloto inconclusivo (I)', async () => {
  const aggregate = await aggregateCampaign(
    await pilotIndex([`${PILOT_ARMS.a3}-r2`]),
  );
  expect(classifyPilotReport(aggregate)).toMatchObject({
    classification: 'I',
    reason: 'inconclusive_run',
  });
}, 600000);
