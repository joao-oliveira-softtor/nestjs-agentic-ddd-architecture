import { join } from 'node:path';
import type { Proposal } from './changes/proposal';
import { listProposals } from './changes/proposal';
import { analyzeProject, type ProjectAnalysis } from './compile';
import { implementation } from './implementation';
import {
  evaluateStatus,
  selectChange,
  waves,
  type ProjectStatus,
  type NextReport,
} from './state';
import { readStaticTests } from './static-tests';
import { runTests, type TestRun } from './verify/test-run';

export interface StatusOptions {
  readonly configPath: string;
  readonly static?: boolean;
  readonly change?: string;
}
export interface StateContext {
  readonly project: ProjectAnalysis;
  readonly proposals: Proposal[];
}

export async function stateContext(configPath: string): Promise<StateContext> {
  const project = await analyzeProject({ configPath });
  if (project.errors.length)
    throw new Error(
      `o domínio não compila:\n${project.errors.map((e) => `${e.source ?? '-'}: ${e.message}`).join('\n')}`,
    );
  const listed = await listProposals(
    join(project.config.outRoot, project.config.changesDir),
    project.config.changesDir,
  );
  if (listed.errors.length)
    throw new Error(
      `propostas inválidas:\n${listed.errors.map((e) => `${e.source}: ${e.message}`).join('\n')}`,
    );
  return { project, proposals: listed.proposals };
}

export function statusFromEvidence(
  context: StateContext,
  evidence: TestRun,
  mode: ProjectStatus['mode'] = 'dynamic',
  diagnostics: string[] = [],
): ProjectStatus {
  return evaluateStatus({
    ir: context.project.ir,
    implemented: implementation(context.project.ir, context.project.registry),
    proposals: context.proposals,
    evidence,
    mode,
    diagnostics,
  });
}

export async function collectStatus(
  context: StateContext,
  staticMode = false,
): Promise<ProjectStatus> {
  const config = context.project.config;
  if (staticMode) {
    const evidence = await readStaticTests(config.root);
    return statusFromEvidence(
      context,
      { cases: evidence.cases, exitCode: 0 },
      'static',
      evidence.diagnostics,
    );
  }
  const evidence = await runTests(config.verify.test, config.root);
  if (evidence.collectionError) throw new Error(evidence.collectionError);
  return statusFromEvidence(context, evidence);
}

export async function status(options: StatusOptions): Promise<ProjectStatus> {
  if (options.change !== undefined && !/^\d{4}$/.test(options.change))
    throw new Error('change deve ser NNNN');
  const context = await stateContext(options.configPath);
  const proposal =
    options.change === undefined
      ? undefined
      : context.proposals.find((p) => p.id === options.change);
  if (options.change !== undefined && !proposal)
    throw new Error(`proposta ${options.change} não encontrada`);
  const report = await collectStatus(context, options.static);
  return proposal ? selectChange(report, context.project.ir, proposal) : report;
}
export async function next(
  options: Omit<StatusOptions, 'static'>,
): Promise<NextReport> {
  return waves(await status(options));
}
