import { VERIFY_ENV } from './test-run';

export interface CommandRun {
  readonly exitCode: number;
  readonly stderrTail: string;
  readonly timedOut: boolean;
}

const STDERR_LINES = 20;
export const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

/** Runs a verify command; keeps the last stderr lines and kills it after `timeoutMs`. */
export async function runCommand(
  command: readonly string[],
  cwd: string,
  timeoutMs = COMMAND_TIMEOUT_MS,
): Promise<CommandRun> {
  const proc = Bun.spawn([...command], {
    cwd,
    env: { ...process.env, [VERIFY_ENV]: '1' },
    stdout: 'ignore',
    stderr: 'pipe',
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  try {
    const [stderr, exitCode] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const stderrTail = stderr
      .trimEnd()
      .split('\n')
      .slice(-STDERR_LINES)
      .join('\n');
    return { exitCode, stderrTail, timedOut };
  } finally {
    clearTimeout(timer);
  }
}
