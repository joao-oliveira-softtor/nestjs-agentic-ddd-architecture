import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { defaultRegistry, type Registry } from '@agentic-ddd/decorators';
import { analyze } from './analyze';
import { archiveProposal } from './changes/apply';
import { writeDraft } from './changes/draft';
import { listProposals } from './changes/proposal';
import { reconcile } from './changes/reconcile';
import { loadConfig, type ResolvedConfig } from './config';
import type { DiffItem } from './diff';
import type { CompileError, IR } from './ir';
import { lintRendered, type LintFinding } from './lint';
import { importModules } from './load';
import { readLock, serializeLock } from './lock';
import { renderAll, type Rendered } from './render/index';
import { registrySizes, scopeRegistry } from './scope';
import { checkOutputs, writeOutputs, type Drift } from './write';

export interface CompileOptions {
  readonly configPath: string;
  readonly outRoot?: string;
  readonly mode: 'write' | 'check';
  readonly registry?: Registry;
  readonly draftChange?: string;
}

export interface CompileResult {
  readonly ok: boolean;
  readonly errors: CompileError[];
  readonly drift: Drift[];
  readonly written: string[];
  readonly warnings: string[];
  readonly lint: LintFinding[];
  readonly ir: IR | null;
  readonly rendered: Rendered | null;
  readonly config: ResolvedConfig;
  readonly diff: DiffItem[];
  readonly pending: string[];
  readonly applied: string | null;
  readonly drafted: string | null;
}

export interface ProjectAnalysis {
  readonly registry: Registry;
  readonly config: ResolvedConfig;
  readonly ir: IR;
  readonly errors: CompileError[];
}

export async function analyzeProject(options: {
  readonly configPath: string;
  readonly outRoot?: string;
  readonly registry?: Registry;
}): Promise<ProjectAnalysis> {
  const config = await loadConfig(options.configPath, {
    outRoot: options.outRoot,
  });
  const origin = options.registry ?? defaultRegistry;
  const before = registrySizes(origin);
  const files = await importModules(config);
  const registry = scopeRegistry(origin, files, before);
  const { ir, errors } = analyze(registry, {
    root: config.root,
    modules: config.modules,
  });
  return { config, ir, errors, registry };
}

async function claudeWarnings(config: ResolvedConfig): Promise<string[]> {
  const content = await readFile(
    join(config.outRoot, config.out.claudeMd),
    'utf8',
  ).catch(() => null);
  return content !== null && !content.includes('@AGENTS.md')
    ? [`${config.out.claudeMd} existe mas não contém @AGENTS.md`]
    : [];
}

const byPath = (a: Drift, b: Drift): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

export async function compile(options: CompileOptions): Promise<CompileResult> {
  const { config, ir, errors } = await analyzeProject(options);
  const empty = {
    drift: [],
    written: [],
    warnings: [],
    lint: [],
    rendered: null,
    config,
    ir,
    diff: [],
    pending: [],
    applied: null,
    drafted: null,
  };
  if (errors.length > 0) return { ...empty, ok: false, errors };

  const lockAbs = join(config.outRoot, config.out.lock);
  const lock = await readLock(lockAbs, config.out.lock);
  const listed = await listProposals(
    join(config.outRoot, config.changesDir),
    config.changesDir,
  );
  if (listed.errors.length > 0)
    return { ...empty, ok: false, errors: listed.errors };
  let proposals = listed.proposals;

  let drafted: string | null = null;
  if (options.draftChange !== undefined) {
    if (options.mode !== 'write')
      throw new Error('--draft-change não pode ser usado com --check');
    const draft = await writeDraft(
      config,
      ir,
      lock,
      proposals,
      options.draftChange,
    );
    drafted = draft.path;
    proposals = [...proposals, draft.proposal];
  }

  const plan = reconcile({
    ir,
    lock,
    proposals,
    changesDir: config.changesDir,
  });
  if (plan.errors.length > 0)
    return {
      ...empty,
      ok: false,
      errors: plan.errors,
      diff: plan.diff,
      drafted,
    };

  const rendered = renderAll(ir, config.out, {
    history: plan.nextLock?.changes ?? [],
    changesDir: config.changesDir,
  });
  const lint = lintRendered(rendered);
  const lintErrors: CompileError[] = lint
    .filter((f) => f.severity === 'error')
    .map((f) => ({ message: `lint: ${f.message}`, source: f.path }));
  const warnings = [
    ...(await claudeWarnings(config)),
    ...lint
      .filter((f) => f.severity === 'warning')
      .map((f) => `${f.path}: ${f.message}`),
  ];
  const lockText = plan.nextLock ? serializeLock(plan.nextLock) : null;

  if (options.mode === 'check') {
    const drift = await checkOutputs(config, rendered);
    const current = await readFile(lockAbs, 'utf8').catch(() => null);
    if (lockText !== null && current !== lockText) {
      drift.push({
        path: config.out.lock,
        reason: current === null ? 'missing' : 'changed',
      });
    }
    drift.sort(byPath);
    const pending = plan.apply
      ? [
          ...plan.pending,
          `a proposta ${plan.apply.id} está pronta para ser aplicada; rode \`bun run agentic compile\``,
        ]
      : plan.pending;
    return {
      ...empty,
      ok: drift.length === 0 && lintErrors.length === 0 && pending.length === 0,
      errors: lintErrors,
      drift,
      warnings,
      lint,
      rendered,
      diff: plan.diff,
      pending,
    };
  }

  const result = await writeOutputs(config, rendered);
  const written = [...result.written];
  if (plan.apply && plan.archivedPath) {
    await archiveProposal(config, plan.apply, plan.archivedPath);
    written.push(plan.archivedPath);
  }
  if (lockText !== null) {
    await mkdir(dirname(lockAbs), { recursive: true });
    await writeFile(lockAbs, lockText);
    written.push(config.out.lock);
  }
  return {
    ...empty,
    ok: lintErrors.length === 0,
    errors: lintErrors,
    written,
    warnings: [...warnings, ...result.warnings],
    lint,
    rendered,
    diff: plan.diff,
    pending: plan.pending,
    applied: plan.apply?.id ?? null,
    drafted,
  };
}
