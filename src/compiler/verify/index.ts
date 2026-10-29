import { join } from 'node:path';
import { listProposals } from '../changes/proposal';
import { compile } from '../compile';
import { workItems } from '../graph';
import { EMPTY_IR, elementsOf, semanticDiff } from '../diff';
import {
  AgenticError,
  formatCoded,
  type Coded,
  type CompileError,
} from '../ir';
import { driftProblem } from '../write';
import { readLock } from '../lock';
import { statusFromEvidence } from '../project-state';
import { workItemFindings } from './work-items';
import { evaluateGates, type CommandResult, type VerifyReport } from './gates';
import { VERIFY_ENV, runTests } from './test-run';

export interface VerifyOptions {
  readonly configPath: string;
  readonly change: string;
}

const formatErrors = (errors: readonly CompileError[]): string =>
  errors.map((e) => `- ${e.source ?? '-'}: ${formatCoded(e)}`).join('\n');

export async function verify(options: VerifyOptions): Promise<VerifyReport> {
  if (!/^\d{4}$/.test(options.change))
    throw new AgenticError(
      'state.change-format',
      `verify: invalid change number "${options.change}" (expected NNNN)`,
    );
  const check = await compile({
    configPath: options.configPath,
    mode: 'check',
  });
  const { config } = check;
  if (check.ir === null)
    throw new AgenticError(
      'verify.domain-unanalyzable',
      'verify: could not analyze the domain',
    );
  const lock = await readLock(
    join(config.outRoot, config.out.lock),
    config.out.lock,
  );
  const { proposals, errors: proposalErrors } = await listProposals(
    join(config.outRoot, config.changesDir),
    config.changesDir,
  );
  if (proposalErrors.length > 0)
    throw new AgenticError(
      'state.proposals-invalid',
      `verify: invalid proposals in ${config.changesDir}/:\n${formatErrors(proposalErrors)}`,
    );
  const domainErrors = check.errors.filter((e) => !e.code.startsWith('lint.'));
  if (domainErrors.length > 0)
    throw new AgenticError(
      'state.domain-invalid',
      `verify: the domain does not compile:\n${formatErrors(domainErrors)}`,
    );
  const proposal = proposals.find((p) => p.id === options.change);
  if (!proposal) {
    throw new AgenticError(
      'verify.proposal-not-found',
      `verify: proposal ${options.change} not found in ${config.changesDir}/ or in ${config.changesDir}/archive/`,
    );
  }
  const tests = await runTests(config.verify.test, config.root);
  const commands: CommandResult[] = [];
  for (const { name, command } of config.verify.commands) {
    const proc = Bun.spawn([...command], {
      cwd: config.root,
      env: { ...process.env, [VERIFY_ENV]: '1' },
      stdout: 'ignore',
      stderr: 'ignore',
    });
    commands.push({ name, command, exitCode: await proc.exited });
  }
  const checkProblems: Coded[] = [
    ...check.errors.map((e) => ({
      code: e.code,
      message: `${e.source ?? '-'}: ${e.message}`,
    })),
    ...check.drift.map(driftProblem),
    ...check.pending,
  ];
  const knownIds = new Set([
    ...elementsOf(check.ir).keys(),
    ...workItems(check.ir).flatMap((i) => i.obligations),
    ...proposals.flatMap((p) =>
      p.acceptance.map((c) => `criterion:${p.id}/${c.id}`),
    ),
  ]);
  return evaluateGates({
    workItemFindings: workItemFindings(
      check.ir,
      statusFromEvidence(
        {
          project: {
            config,
            ir: check.ir,
            registry: check.registry,
            errors: [],
          },
          proposals,
        },
        tests,
      ),
      proposal,
    ),
    proposal,
    lock,
    diff: semanticDiff(lock?.ir ?? EMPTY_IR, check.ir),
    checkOk: check.ok,
    checkProblems,
    tests,
    commands,
    knownIds,
  });
}
