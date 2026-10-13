import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  jsonlTelemetry,
  memoryTelemetry,
  orchestrate,
  planRun,
  startTier,
  type Executor,
  type ExecutorResult,
  type GateOutcome,
  type Gates,
  type PlanItem,
  type Reviewer,
  type Task,
} from '../scripts/orchestrate';

const hash = (id: string) =>
  Bun.CryptoHasher.hash('sha256', id, 'hex') as string;
function packetOf(item: PlanItem): string {
  return [
    '# Identificação',
    '',
    `- ID: \`${item.id}\``,
    `- Camada: ${item.layer}`,
    '- Módulo: shop',
    `- source: \`src/${item.id.replace(/\W+/g, '-')}.ts:3\``,
    `- specHash: \`${hash(item.id)}\``,
    '',
    `bun run agentic verify --item ${item.id} --spec-hash ${hash(item.id)} --config agentic.config.ts --json`,
    '',
  ].join('\n');
}

const domain = (id: string, dependsOn: string[] = []): PlanItem => ({
  id: `entity:${id}`,
  layer: 'domain',
  dependsOn,
});
const app = (id: string, dependsOn: string[] = []): PlanItem => ({
  id: `usecase:${id}`,
  layer: 'application',
  dependsOn,
});

interface Script {
  /** Resultado do executor por (item, tentativa); padrão: done. */
  executor?: (task: Task) => Partial<ExecutorResult>;
  /** Gate por (item, nível, tentativa); padrão: passa. */
  gate?: (task: { id: string; attempt: number }) => GateOutcome;
}
function ports(script: Script = {}) {
  const items = new Map<string, PlanItem>();
  const tasks: Task[] = [];
  const restored: string[] = [];
  let current: Task | null = null;
  const executor: Executor = {
    async run(task) {
      tasks.push(task);
      current = task;
      return {
        status: 'done',
        inputTokens: 100,
        outputTokens: 10,
        durationMs: 5,
        diagnostic: null,
        ...script.executor?.(task),
      };
    },
  };
  const gates: Gates = {
    packet: async (id) => packetOf(items.get(id)!),
    snapshot: async (facts) => facts.id,
    verify: async (facts) =>
      script.gate?.({ id: facts.id, attempt: current!.attempt }) ?? {
        passed: true,
        report: 'ok',
      },
    restore: async (facts) => void restored.push(facts.id),
    diff: async () => 'diff --git a/x b/x',
  };
  return {
    tasks,
    restored,
    executor,
    gates,
    register: (...list: PlanItem[]) =>
      list.forEach((item) => items.set(item.id, item)),
  };
}
const budget = { maxInvocations: 50 };

test('camada define o nível inicial; o plano pode sobrescrevê-lo', () => {
  expect(startTier('domain')).toBe('haiku');
  expect(startTier('application')).toBe('sonnet');
  expect(startTier('operators')).toBe('sonnet');
  expect(startTier('domain', { tiers: { domain: 'sonnet' } })).toBe('sonnet');
  expect(() => startTier('infrastructure')).toThrow('sem nível de modelo');
});

test('sucesso: ondas em ordem, Haiku no domínio e Sonnet na aplicação, um registro por tentativa', async () => {
  const order = domain('Order');
  const create = app('create', [order.id]);
  const p = ports();
  p.register(order, create);
  const telemetry = memoryTelemetry();
  const result = await orchestrate({
    waves: [[order], [create]],
    executor: p.executor,
    gates: p.gates,
    budget,
    telemetry,
  });
  expect(result.status).toBe('completed');
  expect(result.items).toEqual([
    { id: order.id, outcome: 'done', tier: 'haiku', attempts: 1 },
    { id: create.id, outcome: 'done', tier: 'sonnet', attempts: 1 },
  ]);
  expect(p.tasks.map((t) => [t.item.id, t.model])).toEqual([
    [order.id, 'claude-haiku-5-5'],
    [create.id, 'claude-sonnet-5-5'],
  ]);
  expect(p.tasks[0]!.brief).toContain('# Executor de domínio');
  expect(p.tasks[1]!.brief).toContain('# Papel: executor de aplicação');
  expect(telemetry.records.map((r) => r.kind)).toEqual([
    'attempt',
    'attempt',
    'run',
  ]);
  expect(telemetry.records[0]).toMatchObject({
    item: order.id,
    tier: 'haiku',
    gate: 'passed',
    decision: 'accepted',
    inputTokens: 100,
    outputTokens: 10,
  });
  expect(result.invocations).toBe(2);
  expect(result.tokens).toBe(220);
});

test('falha: uma retentativa no mesmo nível, com a saída da falha no brief', async () => {
  const order = domain('Order');
  const p = ports({
    gate: ({ attempt }) =>
      attempt === 1
        ? { passed: false, report: 'I3 Cobertura: falta covers(method:x)' }
        : { passed: true, report: 'ok' },
  });
  p.register(order);
  const telemetry = memoryTelemetry();
  const result = await orchestrate({
    waves: [[order]],
    executor: p.executor,
    gates: p.gates,
    budget,
    telemetry,
  });
  expect(result.items[0]).toMatchObject({ outcome: 'done', tier: 'haiku' });
  expect(p.tasks.map((t) => t.tier)).toEqual(['haiku', 'haiku']);
  expect(p.tasks[0]!.brief).not.toContain('Falha da tentativa anterior');
  expect(p.tasks[1]!.brief).toContain('Falha da tentativa anterior');
  expect(p.tasks[1]!.brief).toContain('I3 Cobertura: falta covers(method:x)');
  expect(p.restored).toEqual([]);
  expect(
    telemetry.records.flatMap((r) =>
      r.kind === 'attempt' ? [r.decision] : [],
    ),
  ).toEqual(['retry', 'accepted']);
});

test('duas falhas no nível sobem para o nível acima, restauram o item e levam a falha', async () => {
  const order = domain('Order');
  const p = ports({
    gate: ({ attempt }) =>
      attempt < 3
        ? { passed: false, report: `falhou ${attempt}` }
        : { passed: true, report: 'ok' },
  });
  p.register(order);
  const telemetry = memoryTelemetry();
  const result = await orchestrate({
    waves: [[order]],
    executor: p.executor,
    gates: p.gates,
    budget,
    telemetry,
  });
  expect(result.items[0]).toEqual({
    id: order.id,
    outcome: 'done',
    tier: 'sonnet',
    attempts: 3,
  });
  expect(p.tasks.map((t) => t.tier)).toEqual(['haiku', 'haiku', 'sonnet']);
  expect(p.tasks[2]!.brief).toContain('falhou 2');
  expect(p.restored).toEqual([order.id]);
  expect(
    telemetry.records.flatMap((r) =>
      r.kind === 'attempt' ? [r.decision] : [],
    ),
  ).toEqual(['retry', 'escalate', 'accepted']);
});

test('blocked devolve o item: sobe sem retentativa no mesmo nível', async () => {
  const order = domain('Order');
  const p = ports({
    executor: (task) =>
      task.tier === 'haiku'
        ? { status: 'blocked', diagnostic: 'contrato contraditório' }
        : {},
  });
  p.register(order);
  const telemetry = memoryTelemetry();
  const result = await orchestrate({
    waves: [[order]],
    executor: p.executor,
    gates: p.gates,
    budget,
    telemetry,
  });
  expect(p.tasks.map((t) => t.tier)).toEqual(['haiku', 'sonnet']);
  expect(p.tasks[1]!.brief).toContain('contrato contraditório');
  expect(result.items[0]).toMatchObject({ outcome: 'done', tier: 'sonnet' });
  expect(telemetry.records[0]).toMatchObject({
    executor: 'blocked',
    gate: 'skipped',
    decision: 'escalate',
  });
});

test('escada esgotada: needs-human; dependentes são pulados e os independentes seguem', async () => {
  const bad = domain('Bad');
  const other = domain('Other');
  const dependent = app('uses_bad', [bad.id]);
  const independent = app('independent', [other.id]);
  const p = ports({
    gate: ({ id }) =>
      id === bad.id
        ? { passed: false, report: 'sempre falha' }
        : { passed: true, report: 'ok' },
  });
  p.register(bad, other, dependent, independent);
  const telemetry = memoryTelemetry();
  const result = await orchestrate({
    waves: [
      [bad, other],
      [dependent, independent],
    ],
    executor: p.executor,
    gates: p.gates,
    budget,
    telemetry,
  });
  expect(result.status).toBe('needs-human');
  expect(result.items.map((i) => [i.id, i.outcome])).toEqual([
    [bad.id, 'needs-human'],
    [other.id, 'done'],
    [independent.id, 'done'],
    [dependent.id, 'skipped_dependency'],
  ]);
  const badAttempts = p.tasks.filter((t) => t.item.id === bad.id);
  expect(badAttempts.map((t) => t.tier)).toEqual([
    'haiku',
    'haiku',
    'sonnet',
    'sonnet',
    'opus',
    'opus',
  ]);
  expect(result.items[0]).toMatchObject({ tier: 'opus', attempts: 6 });
  expect(
    telemetry.records.flatMap((r) =>
      r.kind === 'attempt' && r.item === bad.id ? [r.decision] : [],
    ),
  ).toEqual(['retry', 'escalate', 'retry', 'escalate', 'retry', 'needs-human']);
});

test('orçamento de invocações impede novas execuções; o resto fica not_run', async () => {
  const a = domain('A');
  const b = domain('B');
  const p = ports();
  p.register(a, b);
  const result = await orchestrate({
    waves: [[a, b]],
    executor: p.executor,
    gates: p.gates,
    budget: { maxInvocations: 1 },
    telemetry: memoryTelemetry(),
  });
  expect(result.status).toBe('budget_exhausted');
  expect(p.tasks).toHaveLength(1);
  expect(result.items.map((i) => i.outcome)).toEqual(['done', 'not_run']);
});

test('orçamento de invocações corta uma retentativa em andamento', async () => {
  const a = domain('A');
  const p = ports({ gate: () => ({ passed: false, report: 'falha' }) });
  p.register(a);
  const result = await orchestrate({
    waves: [[a]],
    executor: p.executor,
    gates: p.gates,
    budget: { maxInvocations: 2 },
    telemetry: memoryTelemetry(),
  });
  expect(result.status).toBe('budget_exhausted');
  expect(p.tasks).toHaveLength(2);
  expect(result.items[0]).toMatchObject({ outcome: 'not_run', attempts: 2 });
});

test('orçamento de tokens: limite atingido para; uso indisponível falha fechado', async () => {
  const a = domain('A');
  const b = domain('B');
  const p = ports();
  p.register(a, b);
  const limited = await orchestrate({
    waves: [[a, b]],
    executor: p.executor,
    gates: p.gates,
    budget: { maxInvocations: 10, maxTokens: 110 },
    telemetry: memoryTelemetry(),
  });
  expect(limited.status).toBe('budget_exhausted');
  expect(limited.items.map((i) => i.outcome)).toEqual(['done', 'not_run']);

  const unknown = ports({
    executor: () => ({ inputTokens: null, outputTokens: null }),
  });
  unknown.register(a, b);
  const telemetry = memoryTelemetry();
  const failedClosed = await orchestrate({
    waves: [[a, b]],
    executor: unknown.executor,
    gates: unknown.gates,
    budget: { maxInvocations: 10, maxTokens: 1_000_000 },
    telemetry,
  });
  expect(failedClosed.status).toBe('budget_exhausted');
  expect(unknown.tasks).toHaveLength(1);
  expect(telemetry.records.at(-1)).toMatchObject({
    kind: 'run',
    tokensUnknown: true,
  });

  const noLimit = ports({
    executor: () => ({ inputTokens: null, outputTokens: null }),
  });
  noLimit.register(a, b);
  expect(
    (
      await orchestrate({
        waves: [[a, b]],
        executor: noLimit.executor,
        gates: noLimit.gates,
        budget,
        telemetry: memoryTelemetry(),
      })
    ).status,
  ).toBe('completed');
});

test('cancelamento antes de despachar não executa nada', async () => {
  const a = domain('A');
  const p = ports();
  p.register(a);
  const controller = new AbortController();
  controller.abort();
  const result = await orchestrate({
    waves: [[a]],
    executor: p.executor,
    gates: p.gates,
    budget,
    telemetry: memoryTelemetry(),
    signal: controller.signal,
  });
  expect(result.status).toBe('aborted');
  expect(p.tasks).toHaveLength(0);
});

test('política de controle: tudo em Sonnet, sem Haiku', async () => {
  const a = domain('A');
  const p = ports();
  p.register(a);
  await orchestrate({
    waves: [[a]],
    executor: p.executor,
    gates: p.gates,
    budget,
    telemetry: memoryTelemetry(),
    policy: { tiers: { domain: 'sonnet' }, ladder: ['sonnet', 'opus'] },
  });
  expect(p.tasks.map((t) => t.tier)).toEqual(['sonnet']);
});

function reviewer(text: string | null, diagnostic: string | null = null) {
  const briefs: string[] = [];
  const port: Reviewer = {
    async run(brief, model) {
      briefs.push(`${model}\n${brief}`);
      return {
        text,
        inputTokens: 50,
        outputTokens: 5,
        durationMs: 3,
        diagnostic,
      };
    },
  };
  return { briefs, port };
}

test('revisor Opus roda uma vez depois dos gates, com diff e packets; aprovado conclui', async () => {
  const a = domain('A');
  const p = ports();
  p.register(a);
  const r = reviewer('{"status":"approved","findings":[]}');
  const telemetry = memoryTelemetry();
  const result = await orchestrate({
    waves: [[a]],
    executor: p.executor,
    gates: p.gates,
    reviewer: r.port,
    budget,
    telemetry,
  });
  expect(result.status).toBe('completed');
  expect(r.briefs).toHaveLength(1);
  expect(r.briefs[0]).toContain('claude-opus-5-5');
  expect(r.briefs[0]).toContain('diff --git a/x b/x');
  expect(r.briefs[0]).toContain(a.id);
  expect(telemetry.records.find((x) => x.kind === 'review')).toMatchObject({
    outcome: 'approved',
    findings: 0,
  });
  expect(result.invocations).toBe(2);
});

test('revisor: changes_requested, resposta inválida ou sem texto nunca conclui em silêncio', async () => {
  const a = domain('A');
  const run = async (text: string | null, diagnostic: string | null = null) => {
    const p = ports();
    p.register(a);
    const telemetry = memoryTelemetry();
    const result = await orchestrate({
      waves: [[a]],
      executor: p.executor,
      gates: p.gates,
      reviewer: reviewer(text, diagnostic).port,
      budget,
      telemetry,
    });
    return {
      result,
      review: telemetry.records.find((r) => r.kind === 'review'),
    };
  };
  const changes = await run(
    '{"status":"changes_requested","findings":[{"ref":"I4","message":"teste vazio"}]}',
  );
  expect(changes.result.status).toBe('review_changes_requested');
  expect(changes.result.review?.findings).toHaveLength(1);
  expect(changes.review).toMatchObject({ outcome: 'changes_requested' });
  const prose = await run('Parece bom!');
  expect(prose.result.status).toBe('needs-human');
  expect(prose.review).toMatchObject({ outcome: 'error' });
  const silent = await run(null, 'timeout');
  expect(silent.result.status).toBe('needs-human');
  expect(silent.review).toMatchObject({
    outcome: 'error',
    diagnostic: 'timeout',
  });
});

test('sem revisão quando algum item não concluiu ou o orçamento acabou', async () => {
  const a = domain('A');
  const failing = ports({ gate: () => ({ passed: false, report: 'falha' }) });
  failing.register(a);
  const r = reviewer('{"status":"approved","findings":[]}');
  await orchestrate({
    waves: [[a]],
    executor: failing.executor,
    gates: failing.gates,
    reviewer: r.port,
    budget,
    telemetry: memoryTelemetry(),
  });
  expect(r.briefs).toHaveLength(0);
  const ok = ports();
  ok.register(a);
  const exhausted = await orchestrate({
    waves: [[a]],
    executor: ok.executor,
    gates: ok.gates,
    reviewer: r.port,
    budget: { maxInvocations: 1 },
    telemetry: memoryTelemetry(),
  });
  expect(exhausted.status).toBe('budget_exhausted');
  expect(r.briefs).toHaveLength(0);
});

test('o plano sem execução mostra nível, modelo e tamanho do brief; telemetria JSONL é anexada', async () => {
  const a = domain('A');
  const b = app('b', [a.id]);
  const p = ports();
  p.register(a, b);
  const planned = await planRun([[a], [b]], p.gates);
  expect(planned.map((x) => [x.id, x.tier, x.model])).toEqual([
    [a.id, 'haiku', 'claude-haiku-5-5'],
    [b.id, 'sonnet', 'claude-sonnet-5-5'],
  ]);
  expect(planned.every((x) => x.briefTokens > 0)).toBe(true);
  expect(p.tasks).toHaveLength(0);

  const dir = await mkdtemp(join(tmpdir(), 'orchestrate-'));
  try {
    const path = join(dir, 'runs/1/telemetry.jsonl');
    await orchestrate({
      waves: [[a]],
      executor: p.executor,
      gates: p.gates,
      budget,
      telemetry: jsonlTelemetry(path),
    });
    const lines = (await readFile(path, 'utf8')).trim().split('\n');
    expect(lines.map((l) => JSON.parse(l).kind)).toEqual(['attempt', 'run']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('claude: argv com --bare, sem herdar o modelo forçado e com profundidade 1', async () => {
  const { claudeRunArgv, claudeRunEnv } =
    await import('../scripts/orchestrate-ports');
  const options = {
    executable: '/bin/claude',
    root: '/repo',
    maxTurns: 12,
    maxUsdPerInvocation: 1.5,
    timeoutMs: 1000,
  };
  const executor = claudeRunArgv(options, 'claude-haiku-5-5', 'brief', [
    'Read',
    'Edit',
  ]);
  const value = (flag: string) => executor[executor.indexOf(flag) + 1];
  expect(executor[0]).toBe('/bin/claude');
  expect(executor.at(-1)).toBe('brief');
  expect(executor).toContain('--bare');
  expect(executor).not.toContain('--dangerously-skip-permissions');
  expect(value('--model')).toBe('claude-haiku-5-5');
  expect(value('--max-turns')).toBe('12');
  expect(value('--max-budget-usd')).toBe('1.5');
  expect(value('--permission-mode')).toBe('dontAsk');
  expect(value('--tools')).toBe('Read,Edit');
  const env = claudeRunEnv({
    PATH: '/bin',
    CLAUDE_CODE_SUBAGENT_MODEL_FORCE: 'opus',
    CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '3',
  });
  expect(env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE).toBeUndefined();
  expect(env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH).toBe('1');
  expect(env.PATH).toBe('/bin');
});

test('claude: a resposta final do executor só classifica; fora do formato é falha', async () => {
  const { parseExecutorResponse } =
    await import('../scripts/orchestrate-ports');
  expect(parseExecutorResponse('{"status":"done","findings":[]}')).toEqual({
    status: 'done',
    diagnostic: null,
  });
  expect(
    parseExecutorResponse('{"status":"blocked","findings":["falta contrato"]}'),
  ).toEqual({ status: 'blocked', diagnostic: 'falta contrato' });
  expect(parseExecutorResponse('pronto!').status).toBe('failed');
  expect(parseExecutorResponse('{"status":"ok"}').status).toBe('failed');
  expect(parseExecutorResponse(null).status).toBe('failed');
});

test('gates reais: fronteira acusa import proibido e restore devolve o arquivo', async () => {
  const { createCliGates } = await import('../scripts/orchestrate-ports');
  const { mkdir, writeFile } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'orchestrate-gates-'));
  try {
    await mkdir(join(root, 'orders/domain'), { recursive: true });
    const file = join(root, 'orders/domain/order.ts');
    const original =
      'export class Order {\n  total() {\n    return 1;\n  }\n}\n';
    await writeFile(file, original);
    const gates = createCliGates({ root, config: 'agentic.config.ts' });
    const facts = {
      id: 'entity:Order',
      layer: 'domain',
      module: 'orders',
      sourcePath: 'orders/domain/order.ts',
      specHash: hash('entity:Order'),
    };
    const snapshot = await gates.snapshot(facts);
    await writeFile(
      file,
      `import { x } from '../application/use-case';\n${original}`,
    );
    const outcome = await gates.verify(facts, snapshot);
    expect(outcome.passed).toBe(false);
    expect(outcome.report).toContain('Gate de fronteira');
    expect(outcome.report).toContain('domain não importa application');
    await gates.restore(facts, snapshot);
    expect(await readFile(file, 'utf8')).toBe(original);

    const method = { ...facts, id: 'method:Order.total' };
    await writeFile(file, original.replace('return 1;', 'return 2;\n    // x'));
    const drift = await gates.verify(method, snapshot);
    expect(drift.passed).toBe(false);
    expect(drift.report).toContain('Body line count changed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI: --real exige orçamento; o plano roda sobre o grafo real sem executar nada', async () => {
  const { main } = await import('../scripts/orchestrate');
  const logs: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...args: unknown[]) => void logs.push(args.join(' '));
  console.error = () => {};
  const cwd = process.cwd();
  process.chdir(join(import.meta.dir, '..'));
  try {
    expect(await main(['--real'])).toBe(2);
    expect(await main(['--tier', 'domain=gpt'])).toBe(2);
    expect(await main(['--max-turns', '0'])).toBe(2);
    expect(await main(['--out', '.agentic/runs', '--static'])).toBe(1);
    expect(logs).toEqual([]);
    expect(await main(['--static', '--tier', 'domain=sonnet'])).toBe(0);
    const plan = JSON.parse(logs.join('\n')) as {
      mode: string;
      items: { id: string; tier: string; briefTokens: number }[];
    };
    expect(plan.mode).toBe('plan');
    expect(plan.items.map((i) => i.id)).toContain('usecase:create_order');
    expect(plan.items.find((i) => i.id === 'entity:Order')?.tier).toBe(
      'sonnet',
    );
    expect(plan.items.find((i) => i.id === 'usecase:create_order')?.tier).toBe(
      'sonnet',
    );
  } finally {
    process.chdir(cwd);
    console.log = log;
    console.error = error;
  }
}, 120000);
