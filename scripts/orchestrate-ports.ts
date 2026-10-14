import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  claudeToolFlags,
  parseClaudeTranscript,
} from './evals/adapters/claude';
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

interface DirtyFile {
  /** Hash do conteúdo, ou `deleted`. Ausente do mapa = igual ao HEAD. */
  readonly hash: string;
  readonly content: Buffer | null;
}
interface Worktree {
  readonly source: { readonly path: string; readonly text: string };
  readonly dirty: ReadonlyMap<string, DirtyFile>;
}
export interface CliGatesOptions {
  readonly root: string;
  readonly config: string;
  /** Prefixos (relativos à raiz) que o driver escreve durante a execução: telemetria, briefs. */
  readonly ignore?: readonly string[];
}

const TEST_FILE = /\.test\.ts$/;
const sha = (data: Buffer | string) =>
  new Bun.CryptoHasher('sha256').update(data).digest('hex');

/**
 * Gates do driver. Escopo: só o arquivo-fonte do item e arquivos `*.test.ts` podem mudar no
 * worktree inteiro (um `Write`/`Bash` do executor pode tocar qualquer arquivo). Depois,
 * fronteira (imports por camada e, em itens `method:`, só o corpo atribuído) e
 * `verify --item` com o specHash do packet. O packet vem de `packet --static`.
 */
export function createCliGates(options: CliGatesOptions): Gates {
  const run = (...args: string[]) =>
    spawn(
      [process.execPath, CLI, ...args, '--config', options.config],
      options.root,
    );
  const git = (...args: string[]) => spawn(['git', ...args], options.root);
  const ignored = (path: string) =>
    (options.ignore ?? []).some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    );

  /** Arquivos que diferem do HEAD (modificados, novos, apagados), com hash e conteúdo. */
  async function dirtyFiles(): Promise<Map<string, DirtyFile>> {
    const status = await git(
      'status',
      '--porcelain=v1',
      '-z',
      '-uall',
      '--no-renames',
    );
    if (status.code !== 0)
      throw new Error(`git status falhou: ${status.stderr.trim()}`);
    const files = new Map<string, DirtyFile>();
    for (const entry of status.stdout.split('\0').filter(Boolean)) {
      const path = entry.slice(3);
      if (ignored(path)) continue;
      const file = Bun.file(resolve(options.root, path));
      if (await file.exists()) {
        const content = Buffer.from(await file.arrayBuffer());
        files.set(path, { hash: sha(content), content });
      } else files.set(path, { hash: 'deleted', content: null });
    }
    return files;
  }
  const changedPaths = (
    before: ReadonlyMap<string, DirtyFile>,
    after: ReadonlyMap<string, DirtyFile>,
  ) =>
    [...new Set([...before.keys(), ...after.keys()])]
      .filter((path) => before.get(path)?.hash !== after.get(path)?.hash)
      .sort();

  return {
    async packet(id) {
      const result = await run('packet', id, '--static');
      if (result.code !== 0)
        throw new Error(`packet ${id} falhou: ${result.stderr.trim()}`);
      return result.stdout;
    },
    async snapshot(facts): Promise<Worktree> {
      const path = resolve(options.root, facts.sourcePath);
      return {
        source: { path, text: await readFile(path, 'utf8') },
        dirty: await dirtyFiles(),
      };
    },
    async verify(facts, snapshot): Promise<GateOutcome> {
      const before = snapshot as Worktree;
      const outOfScope = changedPaths(before.dirty, await dirtyFiles()).filter(
        (path) => path !== facts.sourcePath && !TEST_FILE.test(path),
      );
      if (outOfScope.length)
        return {
          passed: false,
          report: `Gate de escopo: só ${facts.sourcePath} e arquivos *.test.ts podem mudar; alterados fora do escopo:\n${outOfScope.join('\n')}`,
        };
      const after = await readFile(before.source.path, 'utf8');
      const findings = importDirectionFindings(
        facts.sourcePath,
        after,
        facts.layer as GateLayer,
      );
      const method = /^method:([^.]+)\.(.+)$/.exec(facts.id);
      if (method)
        findings.push(
          ...bodyOnlyFindings(
            before.source.text,
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
      const before = snapshot as Worktree;
      for (const path of changedPaths(before.dirty, await dirtyFiles())) {
        const baseline = before.dirty.get(path);
        const target = resolve(options.root, path);
        if (baseline?.content) {
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, baseline.content);
        } else if (baseline) await rm(target, { force: true });
        else {
          // Sem entrada no baseline: o arquivo era igual ao HEAD (ou não existia).
          const tracked = await git('cat-file', '-e', `HEAD:${path}`);
          if (tracked.code === 0) await git('checkout', 'HEAD', '--', path);
          else await rm(target, { force: true });
        }
      }
    },
    /** Tudo o que difere do HEAD, inclusive arquivos novos (que `git diff` sozinho omite). */
    async diff() {
      const tracked = await git('diff', 'HEAD');
      const untracked = await git('ls-files', '-o', '--exclude-standard', '-z');
      const created: string[] = [];
      for (const path of untracked.stdout.split('\0').filter(Boolean)) {
        if (ignored(path)) continue;
        // `--no-index` sai com 1 quando há diferença; o texto do diff é o que importa.
        created.push(
          (await git('diff', '--no-index', '--', '/dev/null', path)).stdout,
        );
      }
      return (
        [tracked.stdout, ...created].filter((part) => part.trim()).join('\n') ||
        '(sem alterações)'
      );
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
    ...claudeToolFlags(tools),
    '--',
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
