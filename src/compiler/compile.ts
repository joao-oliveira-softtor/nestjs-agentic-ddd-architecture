import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultRegistry, type Registry } from '@agentic-ddd/decorators';
import { analyze } from './analyze.js';
import { loadConfig, type ResolvedConfig } from './config.js';
import type { CompileError, IR } from './ir.js';
import { lintRendered, type LintFinding } from './lint.js';
import { importModules } from './load.js';
import { renderAll, type Rendered } from './render/index.js';
import { checkOutputs, writeOutputs, type Drift } from './write.js';

export interface CompileOptions {
  readonly configPath: string;
  readonly outRoot?: string;
  readonly mode: 'write' | 'check';
  readonly registry?: Registry;
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

export async function compile(options: CompileOptions): Promise<CompileResult> {
  const config = await loadConfig(options.configPath, {
    outRoot: options.outRoot,
  });
  await importModules(config);
  const { ir, errors } = analyze(options.registry ?? defaultRegistry, {
    root: config.root,
    modules: config.modules,
  });
  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      drift: [],
      written: [],
      warnings: [],
      lint: [],
      ir,
      rendered: null,
      config,
    };
  }
  const rendered = renderAll(ir, config.out);
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
  if (options.mode === 'check') {
    const drift = await checkOutputs(config, rendered);
    return {
      ok: drift.length === 0 && lintErrors.length === 0,
      errors: lintErrors,
      drift,
      written: [],
      warnings,
      lint,
      ir,
      rendered,
      config,
    };
  }
  const result = await writeOutputs(config, rendered);
  return {
    ok: lintErrors.length === 0,
    errors: lintErrors,
    drift: [],
    written: result.written,
    warnings: [...warnings, ...result.warnings],
    lint,
    ir,
    rendered,
    config,
  };
}
