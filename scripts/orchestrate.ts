import { appendFile, mkdir, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import {
  assertOutsideGenerated,
  parsePacket,
  renderBrief,
  renderReviewerBrief,
  type PacketFacts,
} from './agent-briefs';
import { parseReviewerReport, type ReviewerReport } from './reviewer-report';

/**
 * Núcleo determinístico do driver de orquestração (B08): execução sequencial por onda,
 * camada → nível de modelo, 1 retentativa no mesmo nível com a saída da falha, depois o
 * nível acima, depois `needs-human`. Tudo que toca modelo, processo ou disco entra por
 * portas (`Executor`, `Gates`, `Reviewer`), então a simulação offline usa executores
 * `scripted`. O driver nunca confia no relatório do executor: quem aceita um item é o gate.
 */

export type Tier = 'haiku' | 'sonnet' | 'opus';
export const LADDER: readonly Tier[] = ['haiku', 'sonnet', 'opus'];
export const DEFAULT_MODELS: Readonly<Record<Tier, string>> = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
};
/** Roteamento estático por camada (ADR-0003 D6). */
export const TIER_BY_LAYER: Readonly<Record<string, Tier>> = {
  domain: 'haiku',
  application: 'sonnet',
  operators: 'sonnet',
};

export interface PlanItem {
  readonly id: string;
  readonly layer: string;
  readonly dependsOn: readonly string[];
}
export interface Policy {
  /** Substitui o nível inicial de uma camada (por exemplo, todas em `sonnet` nos controles). */
  readonly tiers?: Readonly<Record<string, Tier>>;
  readonly ladder?: readonly Tier[];
  /** Retentativas no mesmo nível antes de subir. */
  readonly retriesPerTier?: number;
  readonly models?: Readonly<Record<Tier, string>>;
}
export interface Budget {
  readonly maxInvocations: number;
  /** Entrada + saída medidas. Uso indisponível com este limite ativo bloqueia novas execuções. */
  readonly maxTokens?: number;
}

export interface Task {
  readonly item: PlanItem;
  readonly facts: PacketFacts;
  readonly tier: Tier;
  readonly model: string;
  /** Tentativa total do item, a partir de 1. */
  readonly attempt: number;
  readonly brief: string;
}
export interface ExecutorResult {
  /** Relato do executor; o gate decide. `blocked` devolve o item sem retentativa. */
  readonly status: 'done' | 'blocked' | 'failed';
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly durationMs: number;
  readonly diagnostic: string | null;
}
export interface Executor {
  run(task: Task, signal: AbortSignal): Promise<ExecutorResult>;
}
export interface GateOutcome {
  readonly passed: boolean;
  /** Texto que volta ao executor na retentativa. */
  readonly report: string;
}
export interface Gates {
  packet(id: string): Promise<string>;
  /** Baseline do item: tirado uma vez, antes da primeira tentativa, e reusado nas retentativas. */
  snapshot(facts: PacketFacts): Promise<unknown>;
  /** Gates de fronteira e `verify --item`, com o `specHash` do packet. */
  verify(facts: PacketFacts, snapshot: unknown): Promise<GateOutcome>;
  /** Devolve o worktree ao baseline do item, antes de subir de nível. */
  restore(facts: PacketFacts, snapshot: unknown): Promise<void>;
  diff(): Promise<string>;
}
export interface ReviewerResult {
  readonly text: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly durationMs: number;
  readonly diagnostic: string | null;
}
export interface Reviewer {
  run(
    brief: string,
    model: string,
    signal: AbortSignal,
  ): Promise<ReviewerResult>;
}

export type TelemetryRecord =
  | {
      readonly kind: 'attempt';
      readonly seq: number;
      readonly item: string;
      readonly layer: string;
      readonly tier: Tier;
      readonly model: string;
      readonly attempt: number;
      readonly executor: ExecutorResult['status'];
      readonly gate: 'passed' | 'failed' | 'skipped';
      readonly decision: 'accepted' | 'retry' | 'escalate' | 'needs-human';
      readonly failure: string | null;
      readonly inputTokens: number | null;
      readonly outputTokens: number | null;
      readonly durationMs: number;
    }
  | {
      readonly kind: 'review';
      readonly seq: number;
      readonly model: string;
      readonly outcome: 'approved' | 'changes_requested' | 'error';
      readonly findings: number;
      readonly diagnostic: string | null;
      readonly inputTokens: number | null;
      readonly outputTokens: number | null;
      readonly durationMs: number;
    }
  | {
      readonly kind: 'run';
      readonly status: RunStatus;
      readonly invocations: number;
      readonly tokens: number;
      readonly tokensUnknown: boolean;
    };
export interface Telemetry {
  write(record: TelemetryRecord): void | Promise<void>;
}

export type ItemOutcome =
  'done' | 'needs-human' | 'not_run' | 'skipped_dependency';
export interface ItemResult {
  readonly id: string;
  readonly outcome: ItemOutcome;
  readonly tier: Tier | null;
  readonly attempts: number;
}
export type RunStatus =
  | 'completed'
  | 'needs-human'
  | 'budget_exhausted'
  | 'aborted'
  | 'review_changes_requested';
export interface RunResult {
  readonly status: RunStatus;
  readonly items: ItemResult[];
  readonly review: ReviewerReport | null;
  readonly invocations: number;
  readonly tokens: number;
}

export interface OrchestrateInput {
  readonly waves: readonly (readonly PlanItem[])[];
  readonly executor: Executor;
  readonly gates: Gates;
  readonly reviewer?: Reviewer;
  readonly policy?: Policy;
  readonly budget: Budget;
  readonly telemetry: Telemetry;
  readonly signal?: AbortSignal;
  readonly maxBriefTokens?: number;
}

/** Nível inicial de uma camada; camada desconhecida não tem papel de executor. */
export function startTier(layer: string, policy: Policy = {}): Tier {
  const tier = policy.tiers?.[layer] ?? TIER_BY_LAYER[layer];
  if (!tier) throw new Error(`camada sem nível de modelo: ${layer}`);
  return tier;
}

const FAILURE_LIMIT = 4000;
const clip = (text: string): string =>
  text.length > FAILURE_LIMIT ? `${text.slice(0, FAILURE_LIMIT)}…` : text;

function failureSection(failure: string | null) {
  return failure
    ? [{ title: 'Falha da tentativa anterior', content: clip(failure) }]
    : [];
}

export async function orchestrate(input: OrchestrateInput): Promise<RunResult> {
  const policy = input.policy ?? {};
  const ladder = policy.ladder ?? LADDER;
  const retries = policy.retriesPerTier ?? 1;
  const models = policy.models ?? DEFAULT_MODELS;
  const signal = input.signal ?? new AbortController().signal;
  let seq = 0;
  let invocations = 0;
  let tokens = 0;
  let tokensUnknown = false;
  const state: { stop: 'budget_exhausted' | 'aborted' | null } = { stop: null };
  const results = new Map<string, ItemResult>();

  const blocked = (): 'budget_exhausted' | 'aborted' | null => {
    if (signal.aborted) return 'aborted';
    if (invocations >= input.budget.maxInvocations) return 'budget_exhausted';
    if (
      input.budget.maxTokens !== undefined &&
      (tokensUnknown || tokens >= input.budget.maxTokens)
    )
      return 'budget_exhausted';
    return null;
  };
  const spend = (inputTokens: number | null, outputTokens: number | null) => {
    invocations++;
    if (inputTokens === null || outputTokens === null) tokensUnknown = true;
    else tokens += inputTokens + outputTokens;
  };

  async function runItem(item: PlanItem): Promise<ItemResult> {
    const packet = await input.gates.packet(item.id);
    const facts = parsePacket(packet);
    if (facts.id !== item.id)
      throw new Error(`o packet não é do item ${item.id}`);
    let tierIndex = ladder.indexOf(startTier(item.layer, policy));
    if (tierIndex === -1)
      throw new Error(`nível inicial fora da escada: ${item.id}`);
    let tierAttempts = 0;
    let attempt = 0;
    let failure: string | null = null;
    // Uma única vez por item: uma retentativa não pode normalizar a deriva da anterior.
    const snapshot = await input.gates.snapshot(facts);
    for (;;) {
      state.stop = blocked();
      if (state.stop)
        return {
          id: item.id,
          outcome: 'not_run',
          tier: null,
          attempts: attempt,
        };
      const tier = ladder[tierIndex]!;
      const model = models[tier];
      attempt++;
      tierAttempts++;
      const brief = renderBrief({
        packet,
        extras: failureSection(failure),
        maxTokens: input.maxBriefTokens,
      });
      const result = await input.executor.run(
        { item, facts, tier, model, attempt, brief },
        signal,
      );
      spend(result.inputTokens, result.outputTokens);
      const gate =
        result.status === 'done'
          ? await input.gates.verify(facts, snapshot)
          : null;
      const accepted = gate?.passed === true;
      failure = accepted
        ? null
        : (gate?.report ?? result.diagnostic ?? `executor ${result.status}`);
      const lastTier = tierIndex === ladder.length - 1;
      const retry =
        !accepted && result.status !== 'blocked' && tierAttempts <= retries;
      const decision = accepted
        ? 'accepted'
        : retry
          ? 'retry'
          : lastTier
            ? 'needs-human'
            : 'escalate';
      await input.telemetry.write({
        kind: 'attempt',
        seq: ++seq,
        item: item.id,
        layer: item.layer,
        tier,
        model,
        attempt,
        executor: result.status,
        gate: gate ? (gate.passed ? 'passed' : 'failed') : 'skipped',
        decision,
        failure: failure ? clip(failure) : null,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        durationMs: result.durationMs,
      });
      if (accepted)
        return { id: item.id, outcome: 'done', tier, attempts: attempt };
      if (decision === 'needs-human')
        return { id: item.id, outcome: 'needs-human', tier, attempts: attempt };
      if (decision === 'escalate') {
        await input.gates.restore(facts, snapshot);
        tierIndex++;
        tierAttempts = 0;
      }
    }
  }

  for (const wave of input.waves)
    for (const item of [...wave].sort((a, b) => a.id.localeCompare(b.id))) {
      const unmet = item.dependsOn.some(
        (id) => results.has(id) && results.get(id)!.outcome !== 'done',
      );
      if (unmet) {
        results.set(item.id, {
          id: item.id,
          outcome: 'skipped_dependency',
          tier: null,
          attempts: 0,
        });
        continue;
      }
      if (state.stop) {
        results.set(item.id, {
          id: item.id,
          outcome: 'not_run',
          tier: null,
          attempts: 0,
        });
        continue;
      }
      results.set(item.id, await runItem(item));
    }

  const items = [...results.values()];
  let review: ReviewerReport | null = null;
  let reviewFailed = false;
  if (
    input.reviewer &&
    !state.stop &&
    items.length &&
    items.every((i) => i.outcome === 'done')
  ) {
    state.stop = blocked();
    if (!state.stop) {
      const model = models.opus;
      let outcome: 'approved' | 'changes_requested' | 'error' = 'error';
      let diagnostic: string | null = null;
      let reviewed: ReviewerResult | null = null;
      try {
        const brief = renderReviewerBrief({
          packets: await Promise.all(
            items.map((i) => input.gates.packet(i.id)),
          ),
          diff: await input.gates.diff(),
          gates: items
            .map(
              (i) =>
                `${i.id}: gates passaram (nível ${i.tier}, ${i.attempts} tentativa(s))`,
            )
            .join('\n'),
          maxTokens: input.maxBriefTokens,
        });
        reviewed = await input.reviewer.run(brief, model, signal);
        spend(reviewed.inputTokens, reviewed.outputTokens);
        if (reviewed.text === null)
          throw new Error(reviewed.diagnostic ?? 'revisor sem resposta');
        review = parseReviewerReport(reviewed.text);
        outcome = review.status;
      } catch (error) {
        diagnostic = String((error as Error).message ?? error);
        reviewFailed = true;
      }
      await input.telemetry.write({
        kind: 'review',
        seq: ++seq,
        model,
        outcome,
        findings: review?.findings.length ?? 0,
        diagnostic,
        inputTokens: reviewed?.inputTokens ?? null,
        outputTokens: reviewed?.outputTokens ?? null,
        durationMs: reviewed?.durationMs ?? 0,
      });
    }
  }

  const status: RunStatus =
    state.stop === 'aborted'
      ? 'aborted'
      : state.stop === 'budget_exhausted'
        ? 'budget_exhausted'
        : items.some((i) => i.outcome === 'needs-human') || reviewFailed
          ? 'needs-human'
          : review?.status === 'changes_requested'
            ? 'review_changes_requested'
            : 'completed';
  await input.telemetry.write({
    kind: 'run',
    status,
    invocations,
    tokens,
    tokensUnknown,
  });
  return { status, items, review, invocations, tokens };
}

export interface PlannedItem {
  readonly id: string;
  readonly layer: string;
  readonly tier: Tier;
  readonly model: string;
  readonly briefTokens: number;
}

/** Plano sem execução: nível, modelo e tamanho do brief por item, na ordem das ondas. */
export async function planRun(
  waves: readonly (readonly PlanItem[])[],
  gates: Pick<Gates, 'packet'>,
  policy: Policy = {},
  maxBriefTokens?: number,
): Promise<PlannedItem[]> {
  const { approxTokens } = await import('@agentic-ddd/compiler');
  const models = policy.models ?? DEFAULT_MODELS;
  const planned: PlannedItem[] = [];
  for (const wave of waves)
    for (const item of [...wave].sort((a, b) => a.id.localeCompare(b.id))) {
      const tier = startTier(item.layer, policy);
      planned.push({
        id: item.id,
        layer: item.layer,
        tier,
        model: models[tier],
        briefTokens: approxTokens(
          renderBrief({
            packet: await gates.packet(item.id),
            maxTokens: maxBriefTokens,
          }),
        ),
      });
    }
  return planned;
}

export function jsonlTelemetry(path: string): Telemetry {
  let ready: Promise<unknown> | null = null;
  return {
    async write(record) {
      ready ??= mkdir(dirname(path), { recursive: true });
      await ready;
      await appendFile(path, `${JSON.stringify(record)}\n`);
    },
  };
}

export function memoryTelemetry(): Telemetry & {
  readonly records: TelemetryRecord[];
} {
  const records: TelemetryRecord[] = [];
  return { records, write: (record) => void records.push(record) };
}

const USAGE = [
  'uso: bun scripts/orchestrate.ts [opções]',
  '  plano (padrão, sem executar nada): mostra nível, modelo e tamanho do brief por item.',
  '  --real --max-invocations <n>   executa de verdade (exige ANTHROPIC_API_KEY e o CLI claude)',
  '  --max-tokens <n>               teto de entrada+saída medidas (padrão: sem teto)',
  '  --max-turns <n>                turnos por invocação (padrão 30)',
  '  --max-usd <x>                  teto nativo do CLI por invocação, em dólar (padrão 2)',
  '  --timeout-min <n>              prazo por invocação, em minutos (padrão 15)',
  '  --review                       depois dos gates, uma revisão Opus em contexto limpo',
  '  --tier <camada>=<haiku|sonnet|opus>   nível inicial da camada (controles do experimento)',
  '  --ladder <a,b,c>               escada de escalação (padrão haiku,sonnet,opus)',
  '  --change <NNNN> --config <arquivo> --out <dir> --static',
].join('\n');

interface Cli {
  readonly config: string;
  readonly out: string;
  readonly change: string | null;
  readonly staticPlan: boolean;
  readonly real: boolean;
  readonly review: boolean;
  readonly maxInvocations: number | null;
  readonly maxTokens: number | undefined;
  readonly maxTurns: number;
  readonly maxUsd: number;
  readonly timeoutMin: number;
  readonly policy: Policy;
}

function parseCli(argv: readonly string[]): Cli | string {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const tiers: Record<string, Tier> = {};
  const valued = new Set([
    '--config',
    '--out',
    '--change',
    '--max-invocations',
    '--max-tokens',
    '--max-turns',
    '--max-usd',
    '--timeout-min',
    '--tier',
    '--ladder',
  ]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (['--real', '--review', '--static'].includes(arg)) flags.add(arg);
    else if (valued.has(arg)) {
      const value = argv[++i];
      if (value === undefined) return `valor ausente para ${arg}`;
      if (arg === '--tier') {
        const [layer, tier] = value.split('=');
        if (!layer || !LADDER.includes(tier as Tier))
          return `--tier exige <camada>=<haiku|sonnet|opus>: ${value}`;
        tiers[layer] = tier as Tier;
      } else values.set(arg, value);
    } else return `opção desconhecida: ${arg}`;
  }
  const number = (name: string, fallback: number | null) => {
    const raw = values.get(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : Number.NaN;
  };
  const maxInvocations = number('--max-invocations', null);
  const maxTokens = number('--max-tokens', null);
  const maxTurns = number('--max-turns', 30)!;
  const maxUsd = number('--max-usd', 2)!;
  const timeoutMin = number('--timeout-min', 15)!;
  if (
    [maxInvocations, maxTokens, maxTurns, maxUsd, timeoutMin].some(Number.isNaN)
  )
    return 'os limites numéricos exigem um número positivo';
  if (maxInvocations !== null && !Number.isInteger(maxInvocations))
    return '--max-invocations exige um inteiro: é o teto de chamadas pagas';
  if (!Number.isInteger(maxTurns)) return '--max-turns exige um inteiro';
  if (flags.has('--real') && maxInvocations === null)
    return '--real exige --max-invocations: nenhuma execução real sem orçamento';
  const ladderRaw = values.get('--ladder');
  const ladder = ladderRaw?.split(',') as Tier[] | undefined;
  if (ladder && !ladder.every((t) => LADDER.includes(t)))
    return `--ladder inválida: ${ladderRaw}`;
  const change = values.get('--change') ?? null;
  if (change !== null && !/^\d{4}$/.test(change)) return '--change exige NNNN';
  return {
    config: values.get('--config') ?? 'agentic.config.ts',
    out: values.get('--out') ?? '.agentic-tasks/runs',
    change,
    staticPlan: flags.has('--static'),
    real: flags.has('--real'),
    review: flags.has('--review'),
    maxInvocations,
    maxTokens: maxTokens ?? undefined,
    maxTurns,
    maxUsd,
    timeoutMin,
    policy: {
      ...(Object.keys(tiers).length ? { tiers } : {}),
      ...(ladder ? { ladder } : {}),
    },
  };
}

export async function main(argv: readonly string[]): Promise<number> {
  const cli = parseCli(argv);
  if (typeof cli === 'string') {
    console.error(`${cli}\n${USAGE}`);
    return 2;
  }
  try {
    const root = process.cwd();
    const out = assertOutsideGenerated(root, cli.out);
    const ports = await import('./orchestrate-ports');
    const gates = ports.createCliGates({
      root,
      config: cli.config,
      ignore: [relative(root, out)],
    });
    const statusArgs = [
      resolve(import.meta.dir, '../src/cli/main.ts'),
      'status',
      '--json',
      ...(cli.staticPlan ? ['--static'] : []),
      ...(cli.change ? ['--change', cli.change] : []),
      '--config',
      cli.config,
    ];
    const status = Bun.spawnSync([process.execPath, ...statusArgs], {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (status.exitCode !== 0)
      throw new Error(`status falhou: ${status.stderr.toString().trim()}`);
    const report = JSON.parse(status.stdout.toString()) as Parameters<
      typeof import('../src/compiler/state').waves
    >[0];
    const { waves: computeWaves } = await import('../src/compiler/state');
    const byId = new Map(report.items.map((i) => [i.id, i]));
    const planned = computeWaves(report).waves.map((wave) =>
      wave.map((id): PlanItem => ({
        id,
        layer: byId.get(id)!.layer,
        dependsOn: byId.get(id)!.dependsOn,
      })),
    );
    if (!cli.real) {
      const plan = await planRun(planned, gates, cli.policy);
      console.log(JSON.stringify({ mode: 'plan', items: plan }, null, 2));
      return 0;
    }
    if (!process.env.ANTHROPIC_API_KEY)
      throw new Error(
        'ANTHROPIC_API_KEY ausente: o modo real usa claude --bare',
      );
    const found = Bun.which('claude');
    if (!found) throw new Error('CLI claude não encontrado no PATH');
    const options = {
      executable: await realpath(found),
      root,
      maxTurns: cli.maxTurns,
      maxUsdPerInvocation: cli.maxUsd,
      timeoutMs: cli.timeoutMin * 60_000,
    };
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const telemetryPath = join(out, runId, 'telemetry.jsonl');
    const result = await orchestrate({
      waves: planned,
      executor: ports.createClaudeExecutor(options),
      gates,
      reviewer: cli.review ? ports.createClaudeReviewer(options) : undefined,
      policy: cli.policy,
      budget: { maxInvocations: cli.maxInvocations!, maxTokens: cli.maxTokens },
      telemetry: jsonlTelemetry(telemetryPath),
    });
    console.log(
      JSON.stringify({ ...result, telemetry: telemetryPath }, null, 2),
    );
    return result.status === 'completed' ? 0 : 1;
  } catch (error) {
    console.error(`orchestrate: ${(error as Error).message}`);
    return 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
