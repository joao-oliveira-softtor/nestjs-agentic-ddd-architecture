import type { ErrorCode } from '../ir';
import { VERIFY_ENV } from './test-run';

export interface CommandRun {
  readonly exitCode: number;
  readonly outputTail: string;
  readonly timedOut: boolean;
}

const OUTPUT_LINES = 20;
export const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

/** Runs a verify command; keeps the last output lines (stdout then stderr) and kills it after `timeoutMs`. */
export async function runCommand(
  command: readonly string[],
  cwd: string,
  timeoutMs = COMMAND_TIMEOUT_MS,
): Promise<CommandRun> {
  const proc = Bun.spawn([...command], {
    cwd,
    env: { ...process.env, [VERIFY_ENV]: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const outputTail = `${stdout}\n${stderr}`
      .trimEnd()
      .split('\n')
      .slice(-OUTPUT_LINES)
      .join('\n');
    return { exitCode, outputTail, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

export interface CommandOutcome {
  readonly exitCode: number;
  readonly outputTail?: string;
  readonly timedOut?: boolean;
}

/** A timeout always has the coded `verify.command-timeout`; any other failure keeps `failedCode`. */
export const commandCode = <C extends ErrorCode>(
  run: CommandOutcome,
  failedCode: C,
): C | 'verify.command-timeout' =>
  run.timedOut ? 'verify.command-timeout' : failedCode;

export const commandMessage = (name: string, run: CommandOutcome): string =>
  run.timedOut
    ? `${name} did not finish in time and was killed`
    : `${name} exited with ${run.exitCode}${run.outputTail ? `: ${run.outputTail}` : ''}`;
