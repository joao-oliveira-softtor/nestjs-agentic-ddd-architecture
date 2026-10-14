import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ProjectStatus,
  NextReport,
  Proposal,
} from '@agentic-ddd/compiler';
import { approxTokens, parseProposal } from '@agentic-ddd/compiler';
import { match } from 'ts-pattern';
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
import { buildImplementationPrompt } from './implementation-prompt';
import { createAttemptWorkspace, disposeWorkspace } from './isolation';
import { TASK_ITEMS, auditSubmission, treeHash, readTree } from './audit';
import { cliArgv, requireFinished, workspaceCommand } from './commands';
import { parseImplementationReply } from './judge';
import { verifySubmission } from './reference';

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
export async function prepareTasksBaseline(
  source: PreparedSource,
  options: RunOptions,
): Promise<string> {
  const empty = await mkdtemp(join(source.root, 'empty-'));
  const workspace = {
    root: empty,
    frameworkRoot: source.frameworkRoot,
    configPath: join(empty, 'agentic.config.ts'),
    baseline: empty,
    mode: 'implementation' as const,
  };
  const destination = join(workspace.root, 'tasks');
  try {
    const command = await workspaceCommand(
      workspace,
      'create-tutorial',
      [
        process.execPath,
        join(source.frameworkRoot, 'scripts/create-skills-example.ts'),
        '--root',
        destination,
      ],
      options,
      join(options.outDir, 'preparation/create-tutorial'),
    );
    requireFinished(command);
    const baseline = await mkdtemp(join(source.root, 'tasks-parent-'));
    const root = join(baseline, 'tasks');
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
      status.items.length !== 5 ||
      TASK_ITEMS.some((item) => !status.items.some((i) => i.id === item.id)) ||
      status.items.some((i) => i.baseState === 'done')
    )
      throw Error('Unexpected tutorial baseline');
    const proposal = await readFile(
      join(root, 'changes/archive/0001-tasks/proposal.md'),
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
/** Limite provisório do brief do revisor (plano da #36); o PR-3 fixa o valor do piloto. */
export const REVIEW_MAX_TOKENS = 50_000;

/** Degrau inicial do item: o da camada dele em `routing.byLayer`. */
function startStep(routing: Routing, layer: string): number {
  const model = match(layer)
    .with(
      'domain',
      'application',
      'operators',
      (known) => routing.byLayer[known],
    )
    .otherwise(() => {
      throw Error(`routing sem modelo para a camada ${layer}`);
    });
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
        const task = TASK_ITEMS.find((t) => t.id === i.item)!;
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
  const initial = await prepareTasksBaseline(source, options);
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
      join(initial, 'changes/archive/0001-tasks/proposal.md'),
      'utf8',
    ),
    '0001-tasks',
    'changes/archive/0001-tasks/proposal.md',
    true,
  );
  if (proposalResult.errors.length || !proposalResult.proposal)
    throw Error('Archived criteria unavailable');
  const proposal: Proposal = proposalResult.proposal;
  const baselineHash = await treeHash(initial);
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
      items: TASK_ITEMS.map((item) => ({
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
    while (true) {
      if (options.signal.aborted || options.control?.stopReason()) break;
      const status = JSON.parse(
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
      const eligible = next.waves
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
      if (!eligible) break;
      const item = result.items.find((i) => i.item === eligible)!;
      const assignment = TASK_ITEMS.find((i) => i.id === eligible)!;
      if (
        status.items.find((i) => i.id === eligible)?.specHash !== item.specHash
      )
        throw Error('Original specHash changed before dispatch');
      const packet = (
        await query(
          source,
          baseline,
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
        configPath: join(baseline, 'agentic.config.ts'),
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
          baseline,
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
          packet,
          root: workspace.root,
          configPath: workspace.configPath,
          specHash: item.specHash!,
          file: assignment.file,
          className: assignment.className,
          method: assignment.method,
          test: assignment.test,
          criteria: handoff.criteria,
          correction: previous
            ? `\nCorrection: aplique uma nova submissão a partir deste baseline; nenhuma edição anterior foi reaplicada. Patch anterior: ${previous.audit?.patch ?? 'unavailable'}. Findings: ${JSON.stringify(previous.audit?.findings.length ? previous.audit.findings : (previous.verification?.findings ?? [previous.reason]))}`
            : '',
        });
        await writeFile(join(evidenceDir, 'prompt.txt'), prompt);
        await writeFile(
          join(evidenceDir, 'handoff.json'),
          JSON.stringify(handoff, null, 2) + '\n',
        );
        const attempt: ItemAttempt = {
          number,
          handoff,
          baselineHash: await treeHash(baseline),
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
          attempt.execution = await adapter.run(
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
          attempt.audit = await auditSubmission(
            baseline,
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
            if (attempt.reply?.status === 'done' && attempt.audit.ok) {
              attempt.verification = await verifySubmission(
                source,
                workspace,
                handoff,
                {
                  signal: options.signal,
                  control: options.control,
                  outDir: join(evidenceDir, 'verification'),
                },
              );
              attempt.accepted = attempt.verification.ok;
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
            if (attempt.accepted) {
              if (assignment.file)
                await cp(
                  join(workspace.root, assignment.file),
                  join(baseline, assignment.file),
                );
              await mkdir(join(baseline, 'app/test'), { recursive: true });
              await cp(
                join(workspace.root, assignment.test),
                join(baseline, assignment.test),
              );
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
          attempt.accepted ||
          infra ||
          attempt.execution.transport === 'cancelled'
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
      if (!itemsBudgetReserved || item.attempts.length) terminal.add(eligible);
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
    for (const item of result.items)
      if (item.state === 'not_run') {
        const deps = initialStatus.items.find(
          (i) => i.id === item.item,
        )!.dependsOn;
        if (
          !infra &&
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
    if (!infra && !options.signal.aborted && !options.control?.stopReason()) {
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
