import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { defaultRegistry, type Registry } from '@agentic-ddd/decorators';
import { analyze } from './analyze';
import { archiveProposal } from './changes/apply';
import { writeDraft } from './changes/draft';
import { listProposals } from './changes/proposal';
import { reconcile } from './changes/reconcile';
import { loadConfig, type ResolvedConfig } from './config';
import type { DiffItem } from './diff';
import {
  AgenticError,
  toPosix,
  type Coded,
  type CompileError,
  type IR,
} from './ir';
import { lintRendered, type LintFinding } from './lint';
import { importModules } from './load';
import { readLock, serializeLock } from './lock';
import { fillMarkers, loadRules, RuleError, type Rule } from './rules';
import { renderAll, type Rendered } from './render/index';
import { removeSnapshot, sourceLines, writeSnapshot } from './snapshot';
import { stableStringify } from './canonical';
import { registrySizes, scopeRegistry } from './scope';
import { relationWarnings } from './validate';
import { checkOutputs, writeOutputs, type Drift } from './write';

export interface CompileOptions {
  readonly configPath: string;
  readonly outRoot?: string;
  readonly mode: 'write' | 'check';
  readonly registry?: Registry;
  readonly draftChange?: string;
}

export interface CompileResult {
  readonly registry: Registry;
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
  readonly pending: Coded[];
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
    ? [`${config.out.claudeMd} exists but does not contain @AGENTS.md`]
    : [];
}

const snapshotPlace = (config: ResolvedConfig, configPath: string) => ({
  root: toPosix(relative(config.outRoot, config.root)),
  config: toPosix(relative(config.outRoot, resolve(configPath))),
  rulesDir: config.rules.dir,
});

const byPath = (a: Drift, b: Drift): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

export async function compile(options: CompileOptions): Promise<CompileResult> {
  // Sources are read before importing: editing during compile leaves the MCP
  // snapshot stale, never falsely current. A failure here only skips the snapshot;
  // the real error shows up later (config, rules).
  const sources =
    options.mode === 'write'
      ? await loadConfig(options.configPath, { outRoot: options.outRoot })
          .then((early) =>
            sourceLines(
              early.outRoot,
              snapshotPlace(early, options.configPath),
              early.modules,
            ),
          )
          .catch(() => null)
      : null;
  const { config, ir, errors, registry } = await analyzeProject(options);
  const empty = {
    registry,
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

  // Before --draft-change: an invalid rule must not leave a draft written without a warning.
  let rules: Rule[];
  try {
    rules = await loadRules(config);
  } catch (error) {
    if (!(error instanceof RuleError)) throw error;
    return {
      ...empty,
      ok: false,
      errors: [
        { code: error.code, message: error.message, source: error.source },
      ],
    };
  }

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
      throw new AgenticError(
        'compile.draft-with-check',
        '--draft-change cannot be used with --check',
      );
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
    rules,
    history: plan.nextLock?.changes ?? [],
    changesDir: config.changesDir,
    conventions: config.conventions,
  });
  const lint = lintRendered(rendered);
  const lintErrors: CompileError[] = lint
    .filter((f) => f.severity === 'error')
    .map((f) => ({ code: f.code, message: f.message, source: f.path }));
  const warnings = [
    ...(await claudeWarnings(config)),
    ...relationWarnings(ir, registry),
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
          {
            code: 'compile.proposal-ready' as const,
            message: `the proposal ${plan.apply.id} is ready to be applied; run \`bun run agentic compile\``,
          },
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
  // With lint errors the artifacts are written, but the proposal stays open and the lock does not advance
  const commit = lintErrors.length === 0;
  if (commit && plan.apply && plan.archivedPath) {
    await archiveProposal(config, plan.apply, plan.archivedPath);
    written.push(plan.archivedPath);
  }
  if (commit && lockText !== null) {
    await mkdir(dirname(lockAbs), { recursive: true });
    await writeFile(lockAbs, lockText);
    written.push(config.out.lock);
  }
  if (
    commit &&
    sources !== null &&
    plan.nextLock !== null &&
    stableStringify(plan.nextLock.ir) === stableStringify(ir)
  )
    await writeSnapshot(
      config.outRoot,
      {
        ...snapshotPlace(config, options.configPath),
        lock: config.out.lock,
        modules: ir.modules,
        rules: rules.map((r) =>
          r.file === null
            ? {
                ...r,
                body: fillMarkers(r.body, {
                  changes: config.changesDir,
                  devSkills: config.out.devSkills,
                  runtimeSkills: config.out.runtimeSkills,
                  layers: config.conventions?.layers,
                }),
              }
            : r,
        ),
      },
      sources,
    );
  else await removeSnapshot(config.outRoot);
  return {
    ...empty,
    ok: commit,
    errors: lintErrors,
    written,
    warnings: [...warnings, ...result.warnings],
    lint,
    rendered,
    diff: plan.diff,
    pending: plan.pending,
    applied: commit ? (plan.apply?.id ?? null) : null,
    drafted,
  };
}
