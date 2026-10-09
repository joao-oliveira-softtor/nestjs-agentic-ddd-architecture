import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
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
import { readPrivateFile } from '../private-files';
import { TASK_ITEMS } from '../audit';

export function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
export function* events(stdout: string): Generator<Record<string, unknown>> {
  for (const line of stdout.split('\n').filter((line) => line.trim())) {
    const event = object(JSON.parse(line));
    if (!event || typeof event.type !== 'string')
      throw Error('invalid native event');
    yield event;
  }
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
  localLoginFile?: string;
  onSecrets?: (secrets: readonly string[]) => void;
}
interface NativeDefinition {
  command: 'codex' | 'cursor-agent';
  credential: 'CODEX_API_KEY' | 'CURSOR_API_KEY';
  bundle: boolean;
  companions?: readonly string[];
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
  let companions: { name: string; path: string; sha256: string }[] = [];
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
      companions = await Promise.all(
        (definition.companions ?? []).map(async (name) => {
          const companion = await realpath(join(dirname(path), name));
          return {
            name,
            path: companion,
            sha256: sha256(await readFile(companion)),
          };
        }),
      );
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
          ...(companions.length
            ? {
                companions: companions.map(({ name, sha256 }) => ({
                  name,
                  sha256,
                })),
              }
            : {}),
        };
        return info;
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    async run(request, runOptions) {
      const local = configuration.authentication === 'local-login';
      const key =
        options.credentials?.[definition.credential] ??
        process.env[definition.credential];
      if (!local && !key)
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
      if (!info) await this.probe();
      for (const companion of companions)
        if (sha256(await readFile(companion.path)) !== companion.sha256)
          throw Error('CLI companion changed after probe');
      const workspace = getWorkspace(request.cwd);
      const home = await mkdtemp(join(dirname(request.cwd), 'session-home-'));
      await mkdir(join(home, '.codex'));
      const relativeAuth =
        definition.command === 'codex'
          ? '.codex/auth.json'
          : '.config/cursor/auth.json';
      const secrets: string[] = [];
      function collect(value: unknown): void {
        if (typeof value === 'string' && value) secrets.push(value);
        else if (value && typeof value === 'object')
          Object.values(value).forEach(collect);
      }
      function collectAuth(auth: Record<string, unknown>): void {
        if (definition.command === 'codex') {
          collect(auth.tokens);
          collect(auth.OPENAI_API_KEY);
        } else {
          collect(auth.accessToken);
          collect(auth.refreshToken);
        }
      }
      try {
        if (local) {
          let original: unknown;
          try {
            original = JSON.parse(
              await readFile(
                options.localLoginFile ?? join(homedir(), relativeAuth),
                'utf8',
              ),
            );
          } catch {
            throw Error('Local login file is unavailable or malformed');
          }
          const auth = object(original);
          if (!auth) throw Error('Invalid local login file');
          const names =
            definition.command === 'codex'
              ? ['auth_mode', 'OPENAI_API_KEY', 'tokens', 'last_refresh']
              : ['accessToken', 'refreshToken'];
          const selected = Object.fromEntries(
            names
              .filter((name) => name in auth)
              .map((name) => [name, auth[name]]),
          );
          collectAuth(selected);
          if (!secrets.length)
            throw Error('Local login file contains no credentials');
          const target = join(home, relativeAuth);
          await mkdir(dirname(target), { recursive: true, mode: 0o700 });
          await writeFile(target, JSON.stringify(selected), {
            mode: 0o600,
            flag: 'wx',
          });
        } else secrets.push(key!);
        options.onSecrets?.(secrets);
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
            framework: request.mode === 'implementation',
            homeDir: home,
            extraReadOnly: [
              definition.bundle ? dirname(path) : path,
              ...companions.map((c) => c.path),
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
              ...(!local ? { [definition.credential]: key! } : {}),
            },
            timeoutMs: request.timeoutMs,
            evidenceDir: request.evidenceDir,
            secrets,
            collectSecrets: async () => {
              try {
                const auth = object(
                  JSON.parse(
                    await readPrivateFile(
                      home,
                      join(home, relativeAuth),
                      1024 * 1024,
                    ),
                  ),
                );
                if (!auth) throw Error('Invalid private auth');
                collectAuth(auth);
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                  throw error;
              }
              options.onSecrets?.(secrets);
              return secrets;
            },
          },
          runOptions,
        );
        const result = definition.parse(execution);
        await definition.collect?.(home, result, request.evidenceDir, secrets);
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
