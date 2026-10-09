import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProcessRequest, ProcessResult } from './contracts';

export const OUTPUT_LIMIT_BYTES = 8 * 1024 * 1024;
const GRACE_MS = 2000;
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Every invocation has a separate process group; evidence never records env values. */
export async function runProcess(
  request: ProcessRequest,
  { signal }: { signal: AbortSignal },
): Promise<ProcessResult> {
  const started = performance.now();
  let transport: ProcessResult['transport'] = 'finished';
  let diagnostic: string | null = null;
  let exitCode: number | null = null;
  let exitSignal: string | null = null;
  const chunks: Buffer[][] = [[], []];
  let bytes = 0;
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let stopping: Promise<void> | undefined;
  const secrets = [...(request.secrets ?? [])];
  let streamsWithheld = false;
  const redact = (value: string) =>
    secrets
      .filter(Boolean)
      .reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), value);
  const killGroup = (sig: NodeJS.Signals | 0) => {
    if (!child) return false;
    try {
      process.kill(-child.pid, sig);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      return false;
    }
  };
  const cleanup = () =>
    (stopping ??= (async () => {
      if (!killGroup('SIGTERM')) return;
      const end = performance.now() + GRACE_MS;
      while (performance.now() < end) {
        await delay(20);
        if (!killGroup(0)) return;
      }
      killGroup('SIGKILL');
    })());
  const stop = (status: ProcessResult['transport'], reason: string) => {
    if (transport === 'finished') {
      transport = status;
      diagnostic = reason;
    }
    void cleanup();
  };
  const abort = () => stop('cancelled', 'cancelled');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (signal.aborted) {
      transport = 'cancelled';
      diagnostic = 'cancelled';
    } else {
      if (process.platform !== 'linux')
        throw new Error('Linux process groups are required');
      const executable =
        request.argv[0] &&
        Bun.which(request.argv[0], {
          cwd: request.cwd,
          PATH: request.env.PATH ?? '',
        });
      const setsid = Bun.which('setsid', { PATH: '/usr/bin:/bin' });
      if (!executable || !setsid)
        throw new Error('executable or setsid unavailable');
      child = Bun.spawn([setsid, executable, ...request.argv.slice(1)], {
        cwd: request.cwd,
        env: request.env,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      timer = setTimeout(
        () => stop('timeout', 'deadline_exceeded'),
        request.timeoutMs,
      );
      const drain = async (
        stream: ReadableStream<Uint8Array>,
        index: number,
      ) => {
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const remaining = OUTPUT_LIMIT_BYTES - bytes;
            if (remaining > 0) {
              const chunk = Buffer.from(value.subarray(0, remaining));
              chunks[index]!.push(chunk);
              bytes += chunk.byteLength;
            }
            if (value.byteLength >= remaining)
              stop('infra_error', 'output_limit');
          }
        } finally {
          reader.releaseLock();
        }
      };
      await Promise.all([
        drain(child.stdout as ReadableStream<Uint8Array>, 0),
        drain(child.stderr as ReadableStream<Uint8Array>, 1),
        (async () => {
          exitCode = await child!.exited;
          exitSignal = child!.signalCode ?? null;
          await cleanup();
        })(),
      ]);
    }
  } catch (error) {
    transport = 'infra_error';
    diagnostic = redact(`spawn_or_collection: ${String(error)}`);
    await cleanup();
    if (child) {
      exitCode = await child.exited;
      exitSignal = child.signalCode ?? null;
    }
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    await cleanup();
  }
  try {
    secrets.push(...((await request.collectSecrets?.()) ?? []));
  } catch {
    transport = 'infra_error';
    diagnostic = 'credential_collection_failed; streams withheld';
    streamsWithheld = true;
  }
  const stdout = streamsWithheld
    ? ''
    : redact(Buffer.concat(chunks[0]!).toString('utf8'));
  const stderr = streamsWithheld
    ? ''
    : redact(Buffer.concat(chunks[1]!).toString('utf8'));
  const durationMs = performance.now() - started;
  await mkdir(request.evidenceDir, { recursive: true });
  const evidence = ['stdout.log', 'stderr.log', 'process.json'].map((name) =>
    join(request.evidenceDir, name),
  );
  await writeFile(evidence[0]!, stdout);
  await writeFile(evidence[1]!, stderr);
  await writeFile(
    evidence[2]!,
    JSON.stringify(
      {
        argv: streamsWithheld
          ? ['[WITHHELD: credential collection failed]']
          : request.argv.map(redact),
        cwd: request.cwd,
        transport,
        exitCode,
        signal: exitSignal,
        durationMs,
        diagnostic,
        outputBytes: bytes,
        streamsWithheld,
        redacted:
          stdout !== Buffer.concat(chunks[0]!).toString('utf8') ||
          stderr !== Buffer.concat(chunks[1]!).toString('utf8'),
      },
      null,
      2,
    ) + '\n',
  );
  return {
    transport,
    exitCode,
    signal: exitSignal,
    stdout,
    stderr,
    durationMs,
    evidence,
    diagnostic,
  };
}
