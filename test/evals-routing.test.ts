import { afterAll, beforeAll, expect, test as bunTest } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeArgv } from '../scripts/evals/adapters/claude';
import { codexArgv } from '../scripts/evals/adapters/codex';
import { cursorArgv } from '../scripts/evals/adapters/cursor';
import {
  createScriptedAdapter,
  type ScriptedAction,
} from '../scripts/evals/adapters/scripted';
import {
  manifestSchema,
  type AdapterRequest,
  type EvalConfiguration,
  type RunManifest,
} from '../scripts/evals/contracts';
import {
  evaluateImplementation,
  prepareTasksBaseline,
} from '../scripts/evals/implementation';
import { createRunControl } from '../scripts/evals/run';
import { decideAttempt } from '../scripts/orchestrate';
import { evalManifest, frozenSource } from './helpers/evals';
import { completeItem } from './helpers/tasks-solution';

const insideVerify = process.env.AGENTIC_DDD_VERIFY === '1';
const test = bunTest.skipIf(insideVerify);

const HAIKU = 'claude-haiku-5-5';
const SONNET = 'claude-sonnet-5-5';
const OPUS = 'claude-opus-5-5';
const routed: EvalConfiguration = {
  id: 'routed',
  adapter: 'scripted',
  model: HAIKU,
  parameters: {},
  routing: {
    byLayer: { domain: HAIKU, application: SONNET, operators: SONNET },
    ladder: [
      { model: HAIKU },
      { model: SONNET, reasoningEffort: 'medium' },
      { model: OPUS, reasoningEffort: 'low' },
    ],
    reviewer: { model: OPUS, reasoningEffort: 'low' },
  },
};
const manifest = (
  configuration: EvalConfiguration,
  budget: Partial<RunManifest['budget']> = {},
): RunManifest => ({
  ...evalManifest,
  skillDatasets: [],
  configurations: [configuration],
  budget: { ...evalManifest.budget, maxCorrectionsPerItem: 0, ...budget },
});
const done = '{"status":"done","summary":"offline fixture"}';
const blocked = '{"status":"blocked","summary":"offline fixture"}';
const approved = '{"status":"approved","findings":[]}';
/** Implementa o item pedido; a lista registra o que cada invocação pediu. */
const implement = (seen: AdapterRequest[]): ScriptedAction => ({
  finalText: done,
  before: async (request) => {
    seen.push(request);
    await completeItem(request.cwd, request.id);
  },
});
const record = (seen: AdapterRequest[], finalText: string): ScriptedAction => ({
  finalText,
  before: async (request) => void seen.push(request),
});

test('decideAttempt: aceite, retentativa no nível, escalação e topo', () => {
  const base = {
    accepted: false,
    executorBlocked: false,
    tierAttempts: 1,
    retries: 1,
    lastTier: false,
  };
  expect(decideAttempt({ ...base, accepted: true })).toBe('accepted');
  expect(decideAttempt(base)).toBe('retry');
  expect(decideAttempt({ ...base, tierAttempts: 2 })).toBe('escalate');
  expect(decideAttempt({ ...base, tierAttempts: 2, lastTier: true })).toBe(
    'needs-human',
  );
  // O driver não retenta um executor blocked; o harness passa executorBlocked: false.
  expect(decideAttempt({ ...base, executorBlocked: true })).toBe('escalate');
  expect(decideAttempt({ ...base, retries: 0 })).toBe('escalate');
});

test('manifesto: routing exige claude-cli ou scripted, escada coerente e esforço só por degrau', () => {
  const parse = (configuration: Record<string, unknown>) =>
    manifestSchema.safeParse({
      ...manifest(routed),
      configurations: [configuration],
    });
  expect(parse(routed).success).toBe(true);
  expect(parse({ ...routed, adapter: 'claude-cli' }).success).toBe(true);
  for (const broken of [
    { ...routed, adapter: 'codex-cli' },
    { ...routed, model: SONNET },
    { ...routed, parameters: { reasoningEffort: 'low' } },
    {
      ...routed,
      routing: {
        ...routed.routing,
        ladder: [{ model: HAIKU }, { model: HAIKU }],
      },
    },
    {
      ...routed,
      routing: { ...routed.routing, ladder: [{ model: HAIKU }] },
    },
  ])
    expect(parse(broken).success).toBe(false);
  // Campanha só de implementação: nenhum dataset de skill.
  expect(manifestSchema.safeParse(manifest(routed)).success).toBe(true);
});

test('adapters: o Claude usa o degrau do pedido e só lê na revisão; Codex e Cursor recusam trocar', () => {
  const claude: EvalConfiguration = {
    id: 'c',
    adapter: 'claude-cli',
    model: HAIKU,
    parameters: {},
  };
  const request: AdapterRequest = {
    id: 'entity:Task',
    mode: 'implementation',
    cwd: '/w',
    prompt: 'p',
    timeoutMs: 1,
    evidenceDir: '/e',
  };
  const argv = claudeArgv('/bin/claude', claude, {
    ...request,
    model: SONNET,
    reasoningEffort: 'medium',
  });
  expect(argv[argv.indexOf('--model') + 1]).toBe(SONNET);
  expect(argv[argv.indexOf('--effort') + 1]).toBe('medium');
  expect(argv).toContain('--tools=Read,Grep,Glob,Edit,Write,Bash');
  const review = claudeArgv('/bin/claude', claude, {
    ...request,
    mode: 'review',
    model: OPUS,
  });
  expect(review[review.indexOf('--model') + 1]).toBe(OPUS);
  expect(review).toContain('--tools=Read,Grep,Glob');
  expect(claudeArgv('/bin/claude', claude, request)).toContain(HAIKU);
  const fixed = (adapter: 'codex-cli' | 'cursor-cli'): EvalConfiguration => ({
    id: adapter,
    adapter,
    model: 'm',
    parameters: {},
  });
  for (const [argvOf, adapter] of [
    [codexArgv, 'codex-cli'],
    [cursorArgv, 'cursor-cli'],
  ] as const) {
    expect(
      argvOf('/bin/x', fixed(adapter), { ...request, model: 'm' }),
    ).toContain('m');
    expect(() =>
      argvOf('/bin/x', fixed(adapter), { ...request, model: 'outro' }),
    ).toThrow('cannot switch model');
    expect(() =>
      argvOf('/bin/x', fixed(adapter), { ...request, reasoningEffort: 'high' }),
    ).toThrow('cannot switch reasoningEffort');
    expect(() =>
      argvOf('/bin/x', fixed(adapter), { ...request, mode: 'review' }),
    ).toThrow('review');
  }
});

let fixture: Awaited<ReturnType<typeof frozenSource>>;
let out: string;
beforeAll(async () => {
  if (insideVerify) return;
  fixture = await frozenSource();
  out = await mkdtemp(join(tmpdir(), 'eval-routing-out-'));
  // Aquece o baseline do tutorial, como os demais testes de implementação.
  await prepareTasksBaseline(fixture.source, {
    outDir: join(out, 'warmup'),
    real: false,
    signal: new AbortController().signal,
  });
}, 60000);
afterAll(async () => {
  await fixture?.cleanup();
  if (out) await rm(out, { recursive: true, force: true });
}, 60000);

test('roteamento: cada item começa no degrau da camada, a falha escala com correção e o revisor recebe o diff', async () => {
  const seen: AdapterRequest[] = [];
  const adapter = createScriptedAdapter([
    record(seen, blocked),
    ...Array.from({ length: 5 }, () => implement(seen)),
    record(seen, approved),
  ]);
  const [benchmark] = await evaluateImplementation(
    manifest(routed),
    fixture.source,
    new Map([['routed', adapter]]),
    {
      outDir: join(out, 'escalation'),
      real: false,
      signal: new AbortController().signal,
    },
  );
  expect(benchmark!.items.map((i) => i.state)).toEqual(
    Array(5).fill('accepted'),
  );
  const task = benchmark!.items[0]!;
  expect(task.attempts.map((a) => [a.number, a.tier, a.model])).toEqual([
    [1, 0, HAIKU],
    [2, 1, SONNET],
  ]);
  expect(task.attempts[1]!.reasoningEffort).toBe('medium');
  expect(seen[1]!.model).toBe(SONNET);
  expect(seen[1]!.reasoningEffort).toBe('medium');
  expect(seen[1]!.prompt).toContain('Correction:');
  // Domínio começa no Haiku; aplicação e operator, no Sonnet.
  const startOf = (id: string) =>
    benchmark!.items.find((i) => i.item === id)!.attempts[0]!.model;
  expect(startOf('method:Task.complete')).toBe(HAIKU);
  expect(startOf('usecase:create_task')).toBe(SONNET);
  expect(startOf('operator:task-operator')).toBe(SONNET);
  const review = benchmark!.review!;
  expect(review).toMatchObject({
    outcome: 'approved',
    dispatched: true,
    findings: 0,
    reason: null,
  });
  expect(review.briefTokens).toBeGreaterThan(0);
  const reviewRequest = seen.at(-1)!;
  expect(reviewRequest.mode).toBe('review');
  expect(reviewRequest.model).toBe(OPUS);
  expect(reviewRequest.reasoningEffort).toBe('low');
  expect(reviewRequest.prompt).toContain('## Diff');
  expect(reviewRequest.prompt).toContain('app/domain/task.ts');
}, 240000);

test('roteamento: a última invocação do teto fica para a revisão, e resposta inválida vira error', async () => {
  const seen: AdapterRequest[] = [];
  const budget = { maxInvocations: 3 };
  const control = createRunControl(
    { ...manifest(routed).budget, ...budget },
    new AbortController().signal,
  );
  try {
    const [benchmark] = await evaluateImplementation(
      manifest(routed, budget),
      fixture.source,
      new Map([
        [
          'routed',
          createScriptedAdapter([
            implement(seen),
            implement(seen),
            record(seen, 'aprovado, sem achados'),
          ]),
        ],
      ]),
      {
        outDir: join(out, 'reserved'),
        real: false,
        signal: new AbortController().signal,
        control,
      },
    );
    expect(control.invocations).toBe(3);
    expect(control.stopReason()).toBeNull();
    expect(benchmark!.items.slice(0, 2).map((i) => i.state)).toEqual([
      'accepted',
      'accepted',
    ]);
    for (const item of benchmark!.items.slice(2)) {
      expect(item.state).toBe('not_run');
      expect(item.reason).toBe('items_budget_reserved_for_review');
    }
    expect(benchmark!.review).toMatchObject({
      outcome: 'error',
      dispatched: true,
      reason: 'invalid_reviewer_report',
    });
    expect(seen.at(-1)!.mode).toBe('review');
  } finally {
    control.dispose();
  }
}, 240000);

test('roteamento: sem item aceito a revisão não roda, e o topo da escada encerra o item', async () => {
  const seen: AdapterRequest[] = [];
  const [benchmark] = await evaluateImplementation(
    manifest(routed),
    fixture.source,
    new Map([
      [
        'routed',
        createScriptedAdapter(
          Array.from({ length: 3 }, () => record(seen, blocked)),
        ),
      ],
    ]),
    {
      outDir: join(out, 'no-accepted'),
      real: false,
      signal: new AbortController().signal,
    },
  );
  const task = benchmark!.items[0]!;
  expect(task.state).toBe('failed');
  expect(task.attempts.map((a) => a.model)).toEqual([HAIKU, SONNET, OPUS]);
  expect(seen).toHaveLength(3);
  expect(benchmark!.review).toEqual({
    outcome: 'not_run',
    dispatched: false,
    execution: null,
    briefTokens: null,
    findings: 0,
    reason: 'no_accepted_items',
  });
}, 240000);
