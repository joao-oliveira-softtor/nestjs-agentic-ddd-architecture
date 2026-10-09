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
import { parseProposal } from '@agentic-ddd/compiler';
import type {
  AdapterResult,
  BenchmarkResult,
  EvalAdapter,
  ItemAttempt,
  ItemHandoff,
  PreparedSource,
  RunManifest,
  RunOptions,
} from './contracts';
import { emptyUsage, unavailable } from './contracts';
import { createAttemptWorkspace, disposeWorkspace } from './isolation';
import { TASK_ITEMS, auditSubmission, treeHash } from './audit';
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
    return root;
  } finally {
    await disposeWorkspace(workspace);
  }
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
    const done = new Set<string>();
    const terminal = new Set<string>();
    let queryIndex = 0;
    let infra = false;
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
        specHash: item.specHash,
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
      for (
        let number = 1;
        number <= manifest.budget.maxCorrectionsPerItem + 1;
        number++
      ) {
        if (
          options.signal.aborted ||
          options.control?.stopReason() ||
          (options.control && !options.control.reserveInvocation())
        )
          break;
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
        const prompt =
          `Packet:\n${packet}\nEnd packet\nRoot atual: ${workspace.root}; configuração atual: ${workspace.configPath}. Use esses paths no lugar de paths temporários do packet; conserve o specHash original ${item.specHash}.\nEdite somente ${assignment.file ? `${assignment.file} ${assignment.className}.${assignment.method} (somente interior do corpo, mesma quantidade de linhas)` : 'nenhum corpo'} e o novo teste ${assignment.test}. Preserve imports, contratos, decorators, outros corpos, testes existentes, configurações, propostas e gerados.\nCritérios adicionais arquivados: ${JSON.stringify(handoff.criteria.map((c) => ({ ...c, id: `criterion:0001/${c.id}` })))}. Cubra-os com covers do executor.\nLeia .agents/skills/agentic-ddd/SKILL.md e referências de executor pertinentes. Use só a sessão principal, sem delegação ou subagentes. Resposta final: somente {"status":"done|blocked|failed","summary":"texto"}, com um dos três valores de status, sem prosa ou cercas.` +
          (previous
            ? `\nCorrection: aplique uma nova submissão a partir deste baseline; nenhuma edição anterior foi reaplicada. Patch anterior: ${previous.audit?.patch ?? 'unavailable'}. Findings: ${JSON.stringify(previous.audit?.findings.length ? previous.audit.findings : (previous.verification?.findings ?? [previous.reason]))}`
            : '');
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
        };
        item.attempts.push(attempt);
        try {
          attempt.execution = await adapter.run(
            {
              id: eligible,
              mode: 'implementation',
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
              if (!attempt.accepted)
                attempt.reason = 'independent_verification_failed';
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
          attempt.execution = syntheticFailure(String(error));
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
      }
      terminal.add(eligible);
      if (item.state !== 'accepted') {
        item.state = infra
          ? 'infra_error'
          : item.attempts.length
            ? 'failed'
            : 'not_run';
        item.reason =
          item.attempts.at(-1)?.reason ??
          options.control?.stopReason() ??
          'cancelled';
      }
      if (infra) break;
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
          deps.some((dep) => !done.has(dep))
        ) {
          item.state = 'blocked';
          item.reason = 'dependency_failed';
        } else
          item.reason = infra
            ? 'configuration_infrastructure_failed'
            : (options.control?.stopReason() ?? 'cancelled');
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
            report: JSON.parse(command.result.stdout) as NonNullable<
              BenchmarkResult['finalVerification']
            >['report'],
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
  }
  return results;
}
