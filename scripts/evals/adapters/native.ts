import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  AdapterInfo,
  AdapterRequest,
  AdapterResult,
  EvalAdapter,
  EvalConfiguration,
  ProcessResult,
  Usage,
} from '../contracts';
import { available, emptyUsage, unavailable } from '../contracts';
import {
  getWorkspace,
  protectedWorkspacePaths,
  sandboxCommand,
  sha256,
} from '../isolation';
import { runProcess } from '../process';
import { TASK_ITEMS } from '../audit';

export function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
export function events(stdout: string): Record<string, unknown>[] {
  return stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const event = object(JSON.parse(line));
      if (!event || typeof event.type !== 'string')
        throw Error('invalid native event');
      return event;
    });
}
export function nativeUsage(value: unknown, source: string): Usage {
  const usage = object(value);
  const measured = (key: string) =>
    typeof usage?.[key] === 'number' &&
    Number.isSafeInteger(usage[key]) &&
    usage[key] >= 0
      ? available(usage[key] as number, `${source}.${key}`)
      : unavailable<number>();
  return {
    inputTokens: measured('input_tokens'),
    cachedInputTokens: measured('cached_input_tokens'),
    outputTokens: measured('output_tokens'),
    cost: unavailable(),
  };
}
export function processResult(result: ProcessResult): AdapterResult {
  return {
    transport:
      result.transport === 'finished' && result.exitCode !== 0
        ? 'infra_error'
        : result.transport,
    finalText: null,
    exitCode: result.exitCode,
    signal: result.signal,
    sessionId: unavailable(),
    observedModel: unavailable(),
    modelRevision: unavailable(),
    usage: emptyUsage(),
    durationMs: result.durationMs,
    evidence: result.evidence,
    diagnostic:
      result.diagnostic ?? (result.exitCode !== 0 ? 'cli_exit_nonzero' : null),
  };
}
export interface NativeAdapterOptions {
  executable?: string;
  credentials?: Readonly<Record<string, string>>;
  probeEvidenceDir?: string;
  probeSignal?: AbortSignal;
}
interface NativeDefinition {
  command: 'codex' | 'cursor-agent';
  credential: 'CODEX_API_KEY' | 'CURSOR_API_KEY';
  bundle: boolean;
  argv(
    executable: string,
    configuration: EvalConfiguration,
    request: AdapterRequest,
  ): string[];
  parse(result: ProcessResult): AdapterResult;
  collect?(
    home: string,
    result: AdapterResult,
    evidenceDir: string,
    secrets: readonly string[],
  ): Promise<void>;
}
export function createNativeAdapter(
  configuration: EvalConfiguration,
  definition: NativeDefinition,
  options: NativeAdapterOptions = {},
): EvalAdapter {
  let executable: string | null = null;
  let info: AdapterInfo | null = null;
  async function resolveExecutable() {
    if (!executable) {
      const found = options.executable ?? Bun.which(definition.command);
      if (!found) throw Error(`Missing ${definition.command}`);
      executable = await realpath(found);
    }
    return executable;
  }
  return {
    async probe() {
      const path = await resolveExecutable();
      const root = await mkdtemp(join(tmpdir(), 'eval-probe-'));
      try {
        const command = await runProcess(
          {
            argv: [path, '--version'],
            cwd: root,
            env: { HOME: root, PATH: '/usr/bin:/bin', NO_COLOR: '1' },
            timeoutMs: 120000,
            evidenceDir: options.probeEvidenceDir ?? join(root, 'evidence'),
          },
          { signal: options.probeSignal ?? new AbortController().signal },
        );
        if (
          command.transport !== 'finished' ||
          command.exitCode !== 0 ||
          !command.stdout.trim()
        )
          throw Error(`Probe failed: ${definition.command}`);
        info = {
          id: configuration.adapter,
          version: command.stdout.trim(),
          executableSha256: sha256(await readFile(path)),
        };
        return info;
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    async run(request, runOptions) {
      const key =
        options.credentials?.[definition.credential] ??
        process.env[definition.credential];
      if (!key)
        return {
          ...processResult({
            transport: 'infra_error',
            exitCode: null,
            signal: null,
            stdout: '',
            stderr: '',
            durationMs: 0,
            evidence: [],
            diagnostic: `Missing external ${definition.credential}`,
          }),
        };
      const path = await resolveExecutable();
      if (info && sha256(await readFile(path)) !== info.executableSha256)
        throw Error('CLI executable changed after probe');
      const workspace = getWorkspace(request.cwd);
      const home = await mkdtemp(join(dirname(request.cwd), 'session-home-'));
      await mkdir(join(home, '.codex'));
      try {
        const assignment = TASK_ITEMS.find((i) => i.id === request.id);
        const protectedPaths = await protectedWorkspacePaths(
          workspace,
          assignment
            ? [assignment.test, ...(assignment.file ? [assignment.file] : [])]
            : [],
        );
        const argv = await sandboxCommand(
          workspace,
          definition.argv(path, configuration, request),
          {
            network: true,
            homeDir: home,
            extraReadOnly: [
              definition.bundle ? dirname(path) : path,
              ...protectedPaths,
            ],
          },
        );
        const execution = await runProcess(
          {
            argv,
            cwd: request.cwd,
            env: {
              HOME: '/home/eval',
              CODEX_HOME: '/home/eval/.codex',
              PATH: '/tools:/usr/bin:/bin',
              NO_COLOR: '1',
              [definition.credential]: key,
            },
            timeoutMs: request.timeoutMs,
            evidenceDir: request.evidenceDir,
            secrets: [key],
          },
          runOptions,
        );
        const result = definition.parse(execution);
        await definition.collect?.(home, result, request.evidenceDir, [key]);
        await writeFile(
          join(request.evidenceDir, 'adapter.json'),
          JSON.stringify(result, null, 2) + '\n',
        );
        return result;
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  };
}
