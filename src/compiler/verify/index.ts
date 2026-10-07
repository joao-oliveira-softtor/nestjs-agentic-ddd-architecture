import { join } from 'node:path';
import { listProposals } from '../changes/proposal';
import { compile } from '../compile';
import { EMPTY_IR, elementsOf, semanticDiff } from '../diff';
import { readLock } from '../lock';
import { evaluateGates, type CommandResult, type VerifyReport } from './gates';
import { VERIFY_ENV, runTests } from './test-run';

export interface VerifyOptions {
  readonly configPath: string;
  readonly change: string;
}

export async function verify(options: VerifyOptions): Promise<VerifyReport> {
  if (!/^\d{4}$/.test(options.change))
    throw new Error(
      `verify: número de change inválido "${options.change}" (esperado NNNN)`,
    );
  const check = await compile({
    configPath: options.configPath,
    mode: 'check',
  });
  const { config } = check;
  if (check.ir === null)
    throw new Error('verify: não foi possível analisar o domínio');
  const lock = await readLock(
    join(config.outRoot, config.out.lock),
    config.out.lock,
  );
  const { proposals } = await listProposals(
    join(config.outRoot, config.changesDir),
    config.changesDir,
  );
  const proposal = proposals.find((p) => p.id === options.change);
  if (!proposal) {
    throw new Error(
      `verify: proposta ${options.change} não encontrada em ${config.changesDir}/ nem em ${config.changesDir}/archive/`,
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
  const checkProblems = [
    ...check.errors.map((e) => `${e.source ?? '-'}: ${e.message}`),
    ...check.drift.map((d) => `desatualizado (${d.reason}): ${d.path}`),
    ...check.pending,
  ];
  const knownIds = new Set([
    ...elementsOf(check.ir).keys(),
    ...proposals.flatMap((p) =>
      p.acceptance.map((c) => `criterion:${p.id}/${c.id}`),
    ),
  ]);
  return evaluateGates({
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
