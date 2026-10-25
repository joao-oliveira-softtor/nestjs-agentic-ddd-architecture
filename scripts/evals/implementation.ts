import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type {
  ProjectStatus,
  NextReport,
  Proposal,
} from '@agentic-ddd/compiler';
import { approxTokens, parseProposal } from '@agentic-ddd/compiler';
import { isMatching, match, P } from 'ts-pattern';
import { renderReviewerBrief } from '../agent-briefs';
import { decideAttempt } from '../orchestrate';
import { parseReviewerReport } from '../reviewer-report';
import { parseFinalReport } from './final-verification';
import type {
  AdapterResult,
  BenchmarkResult,
  EvalAdapter,
  ItemAttempt,
  ItemHandoff,
  PreparedSource,
  ReviewResult,
  Routing,
  RunManifest,
  RunOptions,
} from './contracts';
import { emptyUsage, unavailable } from './contracts';
import {
  buildImplementationPrompt,
  type PromptMode,
} from './implementation-prompt';
import { createAttemptWorkspace, disposeWorkspace } from './isolation';
import { auditSubmission, treeHash, readTree } from './audit';
import {
  TUTORIALS,
  findItem,
  collaborators,
  type Benchmark,
  type IrView,
} from './tutorials';
import { completeItem } from './solutions/matriculas';
import { cliArgv, requireFinished, workspaceCommand } from './commands';
import { parseImplementationReply } from './judge';
import { oracleGreen, verifySubmission } from './reference';

async function query(
  source: PreparedSource,
  baseline: string,
  args: readonly string[],
  name: string,
  options: RunOptions,
) {
  const workspace = await createAttemptWorkspace(source, baseline, 'skills');
  try {
    const command = await workspaceCommand(
      workspace,
      name,
      cliArgv(workspace, args),
      options,
      join(options.outDir, name),
    );
    requireFinished(command);
    return command;
  } finally {
    await disposeWorkspace(workspace);
  }
}
export const prepareTasksBaseline = (
  source: PreparedSource,
  options: RunOptions,
) => prepareBaseline('tasks', source, options);
export async function prepareBaseline(
  benchmark: Benchmark,
  source: PreparedSource,
  options: RunOptions,
): Promise<string> {
  const tutorial = TUTORIALS[benchmark];
  const empty = await mkdtemp(join(source.root, 'empty-'));
  const workspace = {
    root: empty,
    frameworkRoot: source.frameworkRoot,
    configPath: join(empty, 'agentic.config.ts'),
    baseline: empty,
    mode: 'implementation' as const,
  };
  const destination = join(workspace.root, benchmark);
  try {
    const command = await workspaceCommand(
      workspace,
      'create-tutorial',
      [
        process.execPath,
        join(source.frameworkRoot, 'scripts/create-skills-example.ts'),
        '--root',
        destination,
        ...(benchmark === 'tasks' ? [] : ['--tutorial', benchmark]),
      ],
      options,
      join(options.outDir, 'preparation/create-tutorial'),
    );
    requireFinished(command);
    const baseline = await mkdtemp(join(source.root, `${benchmark}-parent-`));
    const root = join(baseline, benchmark);
    await rename(destination, root);
    const compileWorkspace = await createAttemptWorkspace(
      source,
      root,
      'implementation',
    );
    try {
      const compiled = await workspaceCommand(
        compileWorkspace,
        'compile',
        cliArgv(compileWorkspace, ['compile']),
        options,
        join(options.outDir, 'preparation/compile'),
      );
      requireFinished(compiled);
      // Copy only the manager-generated baseline; never install solution code.
      await rm(root, { recursive: true, force: true });
      await rename(compileWorkspace.root, root);
    } finally {
      await disposeWorkspace(compileWorkspace);
    }
    await query(
      source,
      root,
      ['compile', '--check'],
      'preparation/compile-check',
      options,
    );
    const status = JSON.parse(
      (
        await query(
          source,
          root,
          ['status', '--json'],
          'preparation/status',
          options,
        )
      ).result.stdout,
    ) as ProjectStatus;
    if (
      status.items.length !== tutorial.items.length ||
      tutorial.items.some(
        (item) => !status.items.some((i) => i.id === item.id),
      ) ||
      status.items.some((i) => i.baseState === 'done')
    )
      throw Error('Unexpected tutorial baseline');
    const proposal = await readFile(
      join(root, `changes/archive/${tutorial.changeSlug}/proposal.md`),
      'utf8',
    );
    if (!proposal.includes('status: applied'))
      throw Error('Tutorial proposal not archived');
    await mkdir(join(options.outDir, 'preparation'), { recursive: true });
    await writeFile(
      join(options.outDir, 'preparation/baseline-tree.json'),
      JSON.stringify(
        { hash: await treeHash(root), entries: [...(await readTree(root))] },
        null,
        2,
      ) + '\n',
    );
    return root;
  } finally {
    await disposeWorkspace(workspace);
  }
}
/**
 * Limite do brief do revisor no piloto cycle-21 (pré-registro): ao menos 3× o maior brief do
 * ensaio e da estimativa com os patches aceitos do cycle-20 (≈13k tokens), piso de 50000.
 * `test/evals-pilot-rehearsal.test.ts` falha se o brief crescer além disso.
 */
export const REVIEW_MAX_TOKENS = 50_000;

/** Arquivos de skill e regras que o C0 (`bare`) não pode ter no workspace. */
export const BARE_HIDDEN = [
  '.agents',
  '.claude',
  '.cursor',
  '.codex',
  '.agentic',
  '.ai',
  'AGENTS.md',
  'CLAUDE.md',
] as const;
/**
 * Tira `BARE_HIDDEN` do workspace (fora do sandbox, antes de o adapter montá-lo) enquanto
 * `run` executa e devolve tudo num `finally`, também quando `run` lança.
 */
export async function withoutAgentFiles<T>(
  root: string,
  run: () => Promise<T>,
): Promise<T> {
  const stash = await mkdtemp(join(dirname(root), 'hidden-'));
  const moved: string[] = [];
  // Devolve o que saiu; lança só se a restauração falhar (e o stash fica para recuperação).
  const restore = async () => {
    const errors: unknown[] = [];
    for (const name of moved)
      try {
        // O adapter pode ter recriado o nome no workspace; o original volta por cima.
        await rm(join(root, name), { recursive: true, force: true });
        await rename(join(stash, name), join(root, name));
      } catch (error) {
        errors.push(error);
      }
    if (errors.length === 0) await rm(stash, { recursive: true, force: true });
    else
      throw new AggregateError(errors, 'falha ao restaurar arquivos de agente');
  };
  let result: T;
  try {
    for (const name of BARE_HIDDEN)
      try {
        await rename(join(root, name), join(stash, name));
        moved.push(name);
      } catch (error) {
        if (!isMatching({ code: 'ENOENT' }, error)) throw error;
      }
    result = await run();
  } catch (error) {
    // O erro da execução continua o principal; falha de restauração não o esconde.
    await restore().catch(() => {});
    throw error;
  }
  await restore();
  return result;
}

/** `default`: tasks; `framework`: F no matriculas; `transport`: C0 (`bare`) no matriculas. */
export type RetryPolicy = 'default' | 'framework' | 'transport';
export const retryPolicy = (
  seeded: boolean,
  promptMode: PromptMode | undefined,
): RetryPolicy =>
  match([seeded, promptMode] as const)
    .with([false, P._], () => 'default' as const)
    .with([true, 'bare'], () => 'transport' as const)
    .with(
      [true, P.union('legacy', 'brief', undefined)],
      () => 'framework' as const,
    )
    .exhaustive();
const ORACLE_FINDING = 'Private behavior oracle failed';
/** O oráculo privado nunca vai para a correção. */
export const frameworkFindings = (attempt: ItemAttempt): string[] => [
  ...(attempt.audit?.findings ?? []),
  ...(attempt.verification?.findings ?? []).filter(
    (f) => !f.startsWith(ORACLE_FINDING),
  ),
];
export const BARE_RETRY =
  'a submissão anterior não terminou; refaça a partir do baseline';
/** Texto de correção (começa com `\n`) para a tentativa seguinte. */
export function correctionFor(
  policy: RetryPolicy,
  previous: ItemAttempt | undefined,
): string {
  if (!previous) return '';
  return match(policy)
    .with('transport', () => `\n${BARE_RETRY}`)
    .with('framework', () => {
      const findings = frameworkFindings(previous);
      return `\nCorrection: aplique uma nova submissão a partir deste baseline; nenhuma edição anterior foi reaplicada. Patch anterior: ${previous.audit?.patch ?? 'unavailable'}. Findings: ${JSON.stringify(findings.length ? findings : [previous.reason])}`;
    })
    .with(
      'default',
      () =>
        `\nCorrection: aplique uma nova submissão a partir deste baseline; nenhuma edição anterior foi reaplicada. Patch anterior: ${previous.audit?.patch ?? 'unavailable'}. Findings: ${JSON.stringify(previous.audit?.findings.length ? previous.audit.findings : (previous.verification?.findings ?? [previous.reason]))}`,
    )
    .exhaustive();
}
/** Há o que corrigir? No C0 só a execução que não terminou; no F só falha dos gates do framework. */
export const wantsRetry = (policy: RetryPolicy, attempt: ItemAttempt) =>
  match(policy)
    .with('default', () => !attempt.accepted)
    .with('transport', () => attempt.execution.transport !== 'finished')
    .with(
      'framework',
      () =>
        !attempt.accepted &&
        (frameworkFindings(attempt).length > 0 ||
          attempt.reply?.status !== 'done'),
    )
    .exhaustive();

/** Esqueleto + soluções de referência (corpo e teste) dos colaboradores do item. */
export async function seedBaseline(
  source: PreparedSource,
  initial: string,
  collaboratorIds: readonly string[],
): Promise<string> {
  const parent = await mkdtemp(join(source.root, 'seeded-'));
  const root = join(parent, basename(initial));
  await cp(initial, root, { recursive: true, verbatimSymlinks: true });
  for (const id of collaboratorIds) await completeItem(root, id);
  return root;
}

/** Degrau inicial do item: o da camada dele em `routing.byLayer`. */
function startStep(routing: Routing, layer: string): number {
  const model = match(layer)
    .with(
      'domain',
      'application',
      'operators',
      'infrastructure',
      (known) => routing.byLayer[known],
    )
    .otherwise(() => {
      throw Error(`routing sem modelo para a camada ${layer}`);
    });
  if (!model) throw Error(`routing sem modelo para a camada ${layer}`);
  return routing.ladder.findIndex((step) => step.model === model);
}

/** Diff unificado de cada caminho entre o baseline inicial e o final (arquivos novos inclusos). */
function unifiedDiff(
  initial: string,
  final: string,
  paths: readonly string[],
): string {
  return paths
    .map((path) => {
      const before = join(initial, path);
      const run = Bun.spawnSync(
        [
          'git',
          'diff',
          '--no-index',
          '--no-color',
          '--',
          Bun.file(before).size ? before : '/dev/null',
          join(final, path),
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      return run.stdout
        .toString()
        .replaceAll(`${initial}/`, '')
        .replaceAll(`${final}/`, '');
    })
    .filter((part) => part.trim())
    .join('\n');
}

async function reviewAcceptedItems(input: {
  readonly source: PreparedSource;
  readonly initial: string;
  readonly baseline: string;
  readonly result: BenchmarkResult;
  readonly reviewer: NonNullable<Routing['reviewer']>;
  readonly adapter: EvalAdapter;
  readonly manifest: RunManifest;
  readonly options: RunOptions;
  readonly outDir: string;
}): Promise<ReviewResult> {
  const { options } = input;
  const skipped = (
    outcome: ReviewResult['outcome'],
    reason: string,
    briefTokens: number | null = null,
  ): ReviewResult => ({
    outcome,
    dispatched: false,
    execution: null,
    briefTokens,
    findings: 0,
    reason,
  });
  const accepted = input.result.items.filter((i) => i.state === 'accepted');
  if (!accepted.length) return skipped('not_run', 'no_accepted_items');
  const winners = accepted.map((i) => i.attempts.find((a) => a.accepted)!);
  const paths = [
    ...new Set(
      accepted.flatMap((i) => {
        const task = findItem(i.item)!;
        return [...(task.file ? [task.file] : []), task.test];
      }),
    ),
  ];
  // Sem limite aqui: o tamanho é medido e comparado antes de gastar a invocação.
  const brief = renderReviewerBrief({
    packets: winners.map((a) => a.handoff.packet),
    diff: unifiedDiff(input.initial, input.baseline, paths),
    gates: accepted
      .map(
        (i) =>
          `${i.item}: aceito pela verificação independente (${i.attempts.length} tentativa(s), degrau ${i.attempts.at(-1)?.tier ?? 0})`,
      )
      .join('\n'),
    maxTokens: Number.POSITIVE_INFINITY,
  });
  const briefTokens = approxTokens(brief);
  if (briefTokens > REVIEW_MAX_TOKENS)
    return skipped('error', 'brief_over_budget', briefTokens);
  if (options.control && !options.control.reserveInvocation())
    return skipped('not_run', 'budget_exhausted', briefTokens);
  const workspace = await createAttemptWorkspace(
    input.source,
    input.baseline,
    'skills',
  );
  const evidenceDir = join(input.outDir, 'review');
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, 'prompt.txt'), brief);
  let review: ReviewResult;
  try {
    const execution = await input.adapter.run(
      {
        id: 'review',
        mode: 'review',
        cwd: workspace.root,
        prompt: brief,
        model: input.reviewer.model,
        ...(input.reviewer.reasoningEffort
          ? { reasoningEffort: input.reviewer.reasoningEffort }
          : {}),
        timeoutMs: Math.min(
          input.manifest.budget.implementationTimeoutMs,
          options.control?.remainingMs() ?? Infinity,
        ),
        evidenceDir,
      },
      { signal: options.control?.signal ?? options.signal },
    );
    const dispatched = { dispatched: true, execution, briefTokens };
    if (execution.transport !== 'finished')
      review = {
        ...dispatched,
        outcome: 'error',
        findings: 0,
        reason: execution.diagnostic ?? execution.transport,
      };
    else
      try {
        const report = parseReviewerReport(execution.finalText ?? '');
        review = {
          ...dispatched,
          outcome: report.status,
          findings: report.findings.length,
          reason: null,
        };
      } catch {
        review = {
          ...dispatched,
          outcome: 'error',
          findings: 0,
          reason: 'invalid_reviewer_report',
        };
      }
  } catch (error) {
    // A invocação já foi reservada: entra no teto e no relatório como erro despachado.
    review = {
      outcome: 'error',
      dispatched: true,
      execution: null,
      briefTokens,
      findings: 0,
      reason: String(error),
    };
  } finally {
    await disposeWorkspace(workspace);
  }
  await writeFile(
    join(evidenceDir, 'review.json'),
    JSON.stringify(review, null, 2) + '\n',
  );
  return review;
}

function syntheticFailure(message: string): AdapterResult {
  return {
    transport: 'infra_error',
    finalText: null,
    exitCode: null,
    signal: null,
    sessionId: unavailable(),
    observedModel: unavailable(),
    modelRevision: unavailable(),
    usage: emptyUsage(),
    durationMs: 0,
    evidence: [],
    diagnostic: message,
  };
}
export async function evaluateImplementation(
  manifest: RunManifest,
  source: PreparedSource,
  adapters: ReadonlyMap<string, EvalAdapter>,
  options: RunOptions,
): Promise<readonly BenchmarkResult[]> {
  if (
    !options.real &&
    manifest.configurations.some((c) => c.adapter !== 'scripted')
  )
    throw Error('Real adapters require --real');
  const tutorial = TUTORIALS[manifest.benchmark];
  const seeded = tutorial.seedDependencies;
  const initial = await prepareBaseline(manifest.benchmark, source, options);
  const initialStatus = JSON.parse(
    (
      await query(
        source,
        initial,
        ['status', '--json'],
        'implementation/initial-status',
        options,
      )
    ).result.stdout,
  ) as ProjectStatus;
  const proposalResult = parseProposal(
    await readFile(
      join(initial, `changes/archive/${tutorial.changeSlug}/proposal.md`),
      'utf8',
    ),
    tutorial.changeSlug,
    `changes/archive/${tutorial.changeSlug}/proposal.md`,
    true,
  );
  if (proposalResult.errors.length || !proposalResult.proposal)
    throw Error('Archived criteria unavailable');
  const proposal: Proposal = proposalResult.proposal;
  const baselineHash = await treeHash(initial);
  // Com dependências semeadas: ordem das ondas e colaboradores de cada item, uma vez só.
  let order: string[] = [];
  let collaboratorsOf: Record<string, string[]> = {};
  if (seeded) {
    const queryJson = async (args: string[], name: string) =>
      JSON.parse(
        (await query(source, initial, args, `implementation/${name}`, options))
          .result.stdout,
      );
    const ir = (await queryJson(['ir'], 'initial-ir')) as IrView;
    const next = (await queryJson(
      ['next', '--change', '0001', '--json'],
      'initial-next',
    )) as NextReport;
    order = next.waves.flat();
    const dependsOn = Object.fromEntries(
      initialStatus.items.map((i) => [i.id, i.dependsOn]),
    );
    collaboratorsOf = Object.fromEntries(
      order.map((id) => [id, collaborators(id, dependsOn, ir)]),
    );
  }
  const results: BenchmarkResult[] = [];
  for (const configuration of manifest.configurations) {
    const adapter = adapters.get(configuration.id);
    if (!adapter) throw Error(`Adapter missing: ${configuration.id}`);
    const parent = await mkdtemp(join(source.root, 'accepted-'));
    const baseline = join(parent, 'tasks');
    await cp(initial, baseline, { recursive: true, verbatimSymlinks: true });
    const result: BenchmarkResult = {
      configuration: configuration.id,
      baselineHash,
      items: tutorial.items.map((item) => ({
        item: item.id,
        specHash: initialStatus.items.find((i) => i.id === item.id)!.specHash,
        state: 'not_run',
        reason: null,
        attempts: [],
      })),
      finalVerification: null,
    };
    results.push(result);
    options.onBenchmark?.(result);
    const policy = retryPolicy(seeded, configuration.promptMode);
    const bare = configuration.promptMode === 'bare';
    const queue = [...order];
    const done = new Set<string>();
    const terminal = new Set<string>();
    let queryIndex = 0;
    let infra = false;
    const routing: Routing | undefined = configuration.routing;
    const ladderLength = routing?.ladder.length ?? 1;
    // Com revisor, a última invocação do teto fica para a revisão.
    const reservedForReview = () =>
      routing?.reviewer !== undefined &&
      options.control !== undefined &&
      options.control.invocations >= manifest.budget.maxInvocations - 1;
    let itemsBudgetReserved = false;
    const runOptions = {
      ...options,
      outDir: join(options.outDir, 'implementation', configuration.id),
    };
    let seededParent: string | undefined;
    const dropSeeded = async () => {
      if (seededParent)
        await rm(seededParent, { recursive: true, force: true });
      seededParent = undefined;
    };
    try {
      while (true) {
        await dropSeeded();
        if (options.signal.aborted || options.control?.stopReason()) break;
        let itemBaseline = baseline;
        let eligible: string | undefined;
        let status: ProjectStatus;
        if (seeded) {
          eligible = queue.shift();
          if (!eligible) break;
          itemBaseline = await seedBaseline(
            source,
            initial,
            collaboratorsOf[eligible] ??
              (() => {
                throw new Error(
                  `colaboradores ausentes para o item ${eligible}`,
                );
              })(),
          );
          seededParent = dirname(itemBaseline);
          status = JSON.parse(
            (
              await query(
                source,
                itemBaseline,
                ['status', '--json'],
                `query-${queryIndex++}/status`,
                runOptions,
              )
            ).result.stdout,
          ) as ProjectStatus;
        } else {
          status = JSON.parse(
            (
              await query(
                source,
                baseline,
                ['status', '--json'],
                `query-${queryIndex}/status`,
                runOptions,
              )
            ).result.stdout,
          ) as ProjectStatus;
          const next = JSON.parse(
            (
              await query(
                source,
                baseline,
                ['next', '--change', '0001', '--json'],
                `query-${queryIndex++}/next`,
                runOptions,
              )
            ).result.stdout,
          ) as NextReport;
          // A terminal failure can remain in wave 1. Remove it from scheduling, but
          // never release its dependents; independent items are selected by dynamic deps.
          eligible = next.waves
            .flat()
            .find(
              (id) =>
                !terminal.has(id) &&
                !done.has(id) &&
                status.items
                  .find((i) => i.id === id)
                  ?.dependsOn.every(
                    (dep) =>
                      done.has(dep) &&
                      status.items.find((i) => i.id === dep)?.state === 'done',
                  ),
            );
        }
        if (!eligible) break;
        const item = result.items.find((i) => i.item === eligible)!;
        const assignment = tutorial.items.find((i) => i.id === eligible)!;
        if (
          status.items.find((i) => i.id === eligible)?.specHash !==
          item.specHash
        )
          throw Error('Original specHash changed before dispatch');
        const packet = (
          await query(
            source,
            itemBaseline,
            ['packet', eligible],
            `packet-${eligible.replaceAll(/[:.]/g, '-')}`,
            runOptions,
          )
        ).result.stdout;
        if (!packet.includes(item.specHash))
          throw Error('Packet omitted original specHash');
        const handoff: ItemHandoff = {
          item: eligible,
          packet,
          specHash: item.specHash!,
          configPath: join(itemBaseline, 'agentic.config.ts'),
          testFile: assignment.test,
          criteria: assignment.criteria.map((id) => {
            const criterion = proposal.acceptance.find((c) => c.id === id);
            if (!criterion || criterion.manual)
              throw Error(`Criterion unavailable: ${id}`);
            return {
              id: criterion.id,
              given: criterion.given ?? undefined,
              when: criterion.when ?? undefined,
              // eslint-disable-next-line unicorn/no-thenable
              then: criterion.then,
            };
          }),
        };
        const layer = status.items.find((i) => i.id === eligible)!.layer;
        let tier = routing ? startStep(routing, layer) : 0;
        let tierAttempts = 0;
        for (let number = 1; ; number++) {
          if (options.signal.aborted || options.control?.stopReason()) break;
          if (reservedForReview()) {
            itemsBudgetReserved = true;
            break;
          }
          if (options.control && !options.control.reserveInvocation()) break;
          const step = routing?.ladder[tier];
          const workspace = await createAttemptWorkspace(
            source,
            itemBaseline,
            'implementation',
          );
          const evidenceDir = join(
            runOptions.outDir,
            assignment.test.split('/').at(-1)!.replace('.test.ts', ''),
            `attempt-${number}`,
          );
          await mkdir(evidenceDir, { recursive: true });
          const previous = item.attempts.at(-1);
          const prompt = buildImplementationPrompt({
            mode: configuration.promptMode ?? 'legacy',
            item: eligible,
            packet,
            root: workspace.root,
            configPath: workspace.configPath,
            specHash: item.specHash!,
            file: assignment.file,
            className: assignment.className,
            method: assignment.method,
            test: assignment.test,
            criteria: handoff.criteria,
            correction: correctionFor(policy, previous),
          });
          await writeFile(join(evidenceDir, 'prompt.txt'), prompt);
          await writeFile(
            join(evidenceDir, 'handoff.json'),
            JSON.stringify(handoff, null, 2) + '\n',
          );
          const attempt: ItemAttempt = {
            number,
            handoff,
            baselineHash: await treeHash(itemBaseline),
            execution: syntheticFailure('not_dispatched'),
            reply: null,
            audit: null,
            verification: null,
            accepted: false,
            reason: null,
            ...(step
              ? {
                  tier,
                  model: step.model,
                  ...(step.reasoningEffort
                    ? { reasoningEffort: step.reasoningEffort }
                    : {}),
                }
              : {}),
          };
          item.attempts.push(attempt);
          const agentStarted = performance.now();
          try {
            const run = () =>
              adapter.run(
                {
                  id: eligible,
                  mode: 'implementation',
                  ...(step
                    ? {
                        model: step.model,
                        ...(step.reasoningEffort
                          ? { reasoningEffort: step.reasoningEffort }
                          : {}),
                      }
                    : {}),
                  cwd: workspace.root,
                  prompt,
                  timeoutMs: Math.min(
                    manifest.budget.implementationTimeoutMs,
                    options.control?.remainingMs() ?? Infinity,
                  ),
                  evidenceDir,
                },
                { signal: options.control?.signal ?? options.signal },
              );
            // C0: sem skill nem regras no workspace durante o turno, devolvidas antes da auditoria.
            attempt.execution = await (bare
              ? withoutAgentFiles(workspace.root, run)
              : run());
            attempt.audit = await auditSubmission(
              itemBaseline,
              workspace.root,
              eligible,
            );
            await writeFile(
              join(evidenceDir, 'submission.json'),
              attempt.audit.patch,
            );
            if (attempt.execution.transport !== 'finished') {
              attempt.reason =
                attempt.execution.diagnostic ?? attempt.execution.transport;
              infra = attempt.execution.transport === 'infra_error';
            } else {
              try {
                attempt.reply = parseImplementationReply(
                  attempt.execution.finalText ?? '',
                );
              } catch {
                attempt.reason = 'invalid_implementation_reply';
              }
              if (!attempt.audit.ok)
                attempt.reason = 'submission_boundary_violation';
              // Matriculas mede sempre (oráculo e T), salvo árvore insegura (não montável).
              const measure = seeded
                ? !attempt.audit.findings.some((f) =>
                    f.startsWith('Unsafe submission tree'),
                  )
                : attempt.reply?.status === 'done' && attempt.audit.ok;
              if (measure) {
                attempt.verification = await verifySubmission(
                  source,
                  workspace,
                  handoff,
                  {
                    signal: options.signal,
                    control: options.control,
                    outDir: join(evidenceDir, 'verification'),
                    benchmark: manifest.benchmark,
                  },
                );
                attempt.accepted =
                  attempt.verification.ok &&
                  attempt.audit.ok &&
                  attempt.reply?.status === 'done';
                if (
                  attempt.verification.commands.some(
                    (c) => c.result.transport === 'infra_error',
                  )
                ) {
                  infra = true;
                  attempt.reason = 'verifier_infrastructure_failed';
                }
                if (!attempt.accepted)
                  attempt.reason ??= 'independent_verification_failed';
              } else if (!attempt.reason)
                attempt.reason = `declared_${attempt.reply?.status ?? 'malformed'}`;
              if (bare ? oracleGreen(attempt.verification) : attempt.accepted) {
                if (assignment.file && !seeded)
                  await cp(
                    join(workspace.root, assignment.file),
                    join(baseline, assignment.file),
                  );
                if (!seeded) {
                  await mkdir(join(baseline, 'app/test'), { recursive: true });
                  await cp(
                    join(workspace.root, assignment.test),
                    join(baseline, assignment.test),
                  );
                }
                item.state = 'accepted';
                item.reason = null;
                done.add(eligible);
              }
            }
          } catch (error) {
            if (attempt.execution.diagnostic === 'not_dispatched') {
              attempt.execution = syntheticFailure(String(error));
              attempt.execution.durationMs = performance.now() - agentStarted;
            }
            attempt.reason = String(error);
            infra = true;
          } finally {
            await writeFile(
              join(evidenceDir, 'attempt.json'),
              JSON.stringify(attempt, null, 2) + '\n',
            );
            await disposeWorkspace(workspace);
          }
          if (
            infra ||
            attempt.execution.transport === 'cancelled' ||
            item.state === 'accepted' ||
            !wantsRetry(policy, attempt)
          )
            break;
          // Mesma escada do driver; aqui `blocked` conta como tentativa falha em todos os braços.
          tierAttempts++;
          const stop = match(
            decideAttempt({
              accepted: false,
              executorBlocked: false,
              tierAttempts,
              retries: manifest.budget.maxCorrectionsPerItem,
              lastTier: tier >= ladderLength - 1,
            }),
          )
            .with('retry', () => false)
            .with('escalate', () => {
              tier++;
              tierAttempts = 0;
              return false;
            })
            .with('accepted', 'needs-human', () => true)
            .exhaustive();
          if (stop) break;
        }
        // Item que nem chegou a tentar por causa da vaga da revisão não é falha terminal.
        if (!itemsBudgetReserved || item.attempts.length)
          terminal.add(eligible);
        if (item.state !== 'accepted') {
          item.state = infra
            ? 'infra_error'
            : item.attempts.length
              ? 'failed'
              : 'not_run';
          item.reason = itemsBudgetReserved
            ? 'items_budget_reserved_for_review'
            : (item.attempts.at(-1)?.reason ??
              options.control?.stopReason() ??
              'cancelled');
        }
        if (infra || itemsBudgetReserved) break;
      }
    } finally {
      await dropSeeded();
    }
    for (const item of result.items)
      if (item.state === 'not_run') {
        const deps = initialStatus.items.find(
          (i) => i.id === item.item,
        )!.dependsOn;
        if (
          !infra &&
          !seeded &&
          !options.signal.aborted &&
          !options.control?.stopReason() &&
          // Com a vaga da revisão reservada, dependência que só não rodou não é falha.
          deps.some(
            (dep) =>
              !done.has(dep) && (!itemsBudgetReserved || terminal.has(dep)),
          )
        ) {
          item.state = 'blocked';
          item.reason = 'dependency_failed';
        } else
          item.reason = infra
            ? 'configuration_infrastructure_failed'
            : (options.control?.stopReason() ??
              (itemsBudgetReserved
                ? 'items_budget_reserved_for_review'
                : 'cancelled'));
      }
    // Matriculas semeia dependências e não promove: não há mudança inteira para verificar.
    if (
      !infra &&
      !seeded &&
      !options.signal.aborted &&
      !options.control?.stopReason()
    ) {
      const workspace = await createAttemptWorkspace(
        source,
        baseline,
        'skills',
      );
      try {
        const command = await workspaceCommand(
          workspace,
          'verify-change',
          cliArgv(workspace, ['verify', '0001', '--json']),
          runOptions,
          join(runOptions.outDir, 'verify-change'),
        );
        let report: BenchmarkResult['finalVerification'] = null;
        try {
          report = {
            report: parseFinalReport(JSON.parse(command.result.stdout)),
            command,
          };
        } catch {
          report = { report: null, command };
        }
        result.finalVerification = report;
      } finally {
        await disposeWorkspace(workspace);
      }
    }
    if (routing?.reviewer)
      result.review =
        infra || options.signal.aborted || options.control?.stopReason()
          ? {
              outcome: 'not_run',
              dispatched: false,
              execution: null,
              briefTokens: null,
              findings: 0,
              reason: 'run_stopped',
            }
          : await reviewAcceptedItems({
              source,
              initial,
              baseline,
              result,
              reviewer: routing.reviewer,
              adapter,
              manifest,
              options,
              outDir: runOptions.outDir,
            });
  }
  return results;
}
