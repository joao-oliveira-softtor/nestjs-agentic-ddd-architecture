import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseClaudeTranscript } from './evals/adapters/claude';
import { bodyOnlyFindings, importDirectionFindings } from './boundary-gates';
import type { GateLayer } from './boundary-gates';
import type {
  Executor,
  ExecutorResult,
  GateOutcome,
  Gates,
  Reviewer,
  ReviewerResult,
} from './orchestrate';

/** Portas reais do driver: gates sobre o CLI do framework e execução pelo Claude Code. */

const CLI = resolve(import.meta.dir, '../src/cli/main.ts');
const REPORT_LIMIT = 6000;

interface Spawned {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}
async function spawn(
  argv: readonly string[],
  cwd: string,
  options: {
    env?: Record<string, string | undefined>;
    signal?: AbortSignal;
  } = {},
): Promise<Spawned> {
  const run = Bun.spawn([...argv], {
    cwd,
    env: options.env ?? process.env,
    stdout: 'pipe',
    stderr: 'pipe',
    signal: options.signal,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
    run.exited,
  ]);
  return { code, stdout, stderr };
}

interface FileSnapshot {
  readonly path: string;
  readonly text: string;
}
export interface CliGatesOptions {
  readonly root: string;
  readonly config: string;
}

/**
 * Gates do driver: fronteira (imports por camada e, em itens `method:`, só o corpo atribuído)
 * e depois `verify --item` com o specHash do packet. O packet vem de `packet --static`.
 */
export function createCliGates(options: CliGatesOptions): Gates {
  const run = (...args: string[]) =>
    spawn(
      [process.execPath, CLI, ...args, '--config', options.config],
      options.root,
    );
  return {
    async packet(id) {
      const result = await run('packet', id, '--static');
      if (result.code !== 0)
        throw new Error(`packet ${id} falhou: ${result.stderr.trim()}`);
      return result.stdout;
    },
    async snapshot(facts): Promise<FileSnapshot> {
      const path = resolve(options.root, facts.sourcePath);
      return { path, text: await readFile(path, 'utf8') };
    },
    async verify(facts, snapshot): Promise<GateOutcome> {
      const before = snapshot as FileSnapshot;
      const after = await readFile(before.path, 'utf8');
      const findings = importDirectionFindings(
        facts.sourcePath,
        after,
        facts.layer as GateLayer,
      );
      const method = /^method:([^.]+)\.(.+)$/.exec(facts.id);
      if (method)
        findings.push(
          ...bodyOnlyFindings(
            before.text,
            after,
            method[1]!,
            method[2]!,
            facts.sourcePath,
          ),
        );
      if (findings.length)
        return {
          passed: false,
          report: `Gate de fronteira:\n${findings.join('\n')}`,
        };
      const verified = await run(
        'verify',
        '--item',
        facts.id,
        '--spec-hash',
        facts.specHash,
      );
      return {
        passed: verified.code === 0,
        report: verified.stderr.trim().slice(0, REPORT_LIMIT),
      };
    },
    async restore(_facts, snapshot) {
      const before = snapshot as FileSnapshot;
      await writeFile(before.path, before.text);
    },
    async diff() {
      const result = await spawn(['git', 'diff'], options.root);
      return result.stdout.trim() || '(sem alterações rastreadas)';
    },
  };
}

export interface ClaudeRunOptions {
  readonly executable: string;
  readonly root: string;
  readonly maxTurns: number;
  /** Teto nativo do CLI por invocação (`--max-budget-usd`). */
  readonly maxUsdPerInvocation: number;
  readonly timeoutMs: number;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const EXECUTOR_TOOLS = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'];
const REVIEWER_TOOLS = ['Read', 'Grep', 'Glob'];

export function claudeRunArgv(
  options: ClaudeRunOptions,
  model: string,
  prompt: string,
  tools: readonly string[],
): string[] {
  return [
    options.executable,
    '--print',
    '--output-format',
    'stream-json',
    '--verbose',
    '--bare',
    '--model',
    model,
    '--max-turns',
    String(options.maxTurns),
    '--max-budget-usd',
    String(options.maxUsdPerInvocation),
    '--no-session-persistence',
    '--permission-mode',
    'dontAsk',
    '--tools',
    tools.join(','),
    '--allowed-tools',
    tools.join(','),
    prompt,
  ];
}

/**
 * Profundidade 1 (topologia plana, ADR-0003 D9). `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` nunca
 * passa: ele sobrepõe o modelo escolhido por tarefa e invalidaria a medição por nível.
 */
export function claudeRunEnv(
  base: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string | undefined> {
  const env = { ...base };
  delete env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE;
  return {
    ...env,
    CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '1',
    DISABLE_AUTOUPDATER: '1',
    NO_COLOR: '1',
  };
}

interface ClaudeOutput {
  readonly text: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly durationMs: number;
  readonly diagnostic: string | null;
}
async function runClaude(
  options: ClaudeRunOptions,
  model: string,
  prompt: string,
  tools: readonly string[],
  signal: AbortSignal,
): Promise<ClaudeOutput> {
  const started = performance.now();
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const controller = AbortSignal.any([signal, timeout]);
  let spawned: Spawned;
  try {
    spawned = await spawn(
      claudeRunArgv(options, model, prompt, tools),
      options.root,
      { env: claudeRunEnv(options.env), signal: controller },
    );
  } catch (error) {
    return {
      text: null,
      inputTokens: null,
      outputTokens: null,
      durationMs: Math.round(performance.now() - started),
      diagnostic: timeout.aborted ? 'deadline_exceeded' : String(error),
    };
  }
  const parsed = parseClaudeTranscript({
    transport: 'finished',
    exitCode: spawned.code,
    signal: null,
    stdout: spawned.stdout,
    stderr: spawned.stderr,
    durationMs: Math.round(performance.now() - started),
    evidence: [],
    diagnostic: null,
  });
  const measured = (value: typeof parsed.usage.inputTokens) =>
    value.status === 'available' ? value.value : null;
  return {
    text: parsed.finalText,
    inputTokens: measured(parsed.usage.inputTokens),
    outputTokens: measured(parsed.usage.outputTokens),
    durationMs: parsed.durationMs,
    diagnostic: parsed.diagnostic,
  };
}

/** Relato do executor (resposta final JSON do brief). O gate decide; isto só classifica a saída. */
export function parseExecutorResponse(text: string | null): {
  status: ExecutorResult['status'];
  diagnostic: string | null;
} {
  if (text === null)
    return { status: 'failed', diagnostic: 'sem resposta final' };
  try {
    const value = JSON.parse(text) as {
      status?: unknown;
      findings?: unknown;
    };
    if (
      value.status === 'done' ||
      value.status === 'blocked' ||
      value.status === 'failed'
    )
      return {
        status: value.status,
        diagnostic:
          value.status === 'done' || !Array.isArray(value.findings)
            ? null
            : value.findings.map(String).join('; ') || null,
      };
  } catch {
    // resposta fora do formato: tratada como falha abaixo
  }
  return {
    status: 'failed',
    diagnostic: 'resposta final fora do formato JSON do brief',
  };
}

export function createClaudeExecutor(options: ClaudeRunOptions): Executor {
  return {
    async run(task, signal): Promise<ExecutorResult> {
      const output = await runClaude(
        options,
        task.model,
        task.brief,
        EXECUTOR_TOOLS,
        signal,
      );
      const response = parseExecutorResponse(output.text);
      return {
        status:
          output.diagnostic && output.text === null
            ? 'failed'
            : response.status,
        inputTokens: output.inputTokens,
        outputTokens: output.outputTokens,
        durationMs: output.durationMs,
        diagnostic: output.diagnostic ?? response.diagnostic,
      };
    },
  };
}

export function createClaudeReviewer(options: ClaudeRunOptions): Reviewer {
  return {
    async run(brief, model, signal): Promise<ReviewerResult> {
      return runClaude(options, model, brief, REVIEWER_TOOLS, signal);
    },
  };
}
