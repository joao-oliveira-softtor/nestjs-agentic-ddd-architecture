import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AgenticError } from '../ir';

export const DEFAULT_TIMEOUT_MS = 120_000;

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

async function run(
  cmd: readonly string[],
  cwd: string,
  options: { timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<Run> {
  const child = Bun.spawn([...cmd], {
    cwd,
    env: options.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let timedOut = false;
  const timer =
    options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          child.kill();
        }, options.timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(timer);
  return { code: timedOut ? null : code, stdout, stderr, timedOut };
}

/** Client text in a message: JSON-quoted (control characters escaped) and cut short. */
export const quote = (s: string, max = 80): string =>
  JSON.stringify(s.length > max ? `${s.slice(0, max)}...` : s);

const git = (cwd: string, ...args: string[]) => run(['git', ...args], cwd);

/** The full commit id of `ref`, or `bundle.base-unknown`. A ref that looks like an option is refused. */
export async function resolveBase(root: string, ref: string): Promise<string> {
  const unknown = () =>
    new AgenticError(
      'bundle.base-unknown',
      `base ref ${quote(ref)} is not a commit of the base repository`,
    );
  if (ref === '' || ref.startsWith('-')) throw unknown();
  const out = await git(
    root,
    'rev-parse',
    '--verify',
    '--quiet',
    '--end-of-options',
    `${ref}^{commit}`,
  );
  if (out.code !== 0) throw unknown();
  return out.stdout.trim();
}

/**
 * Runs `use` on a detached worktree of `sha`, created under `workRoot` (inside the base project by
 * default, so the base `node_modules` resolves). The worktree is removed on every path.
 */
export async function withWorktree<T>(
  root: string,
  workRoot: string,
  sha: string,
  use: (dir: string) => Promise<T>,
): Promise<T> {
  await mkdir(workRoot, { recursive: true });
  const dir = await mkdtemp(join(workRoot, 'bundle-'));
  try {
    const added = await git(root, 'worktree', 'add', '--detach', dir, sha);
    if (added.code !== 0)
      throw new AgenticError(
        'bundle.base-unknown',
        `cannot check out the base commit: ${quote(added.stderr.trim(), 300)}`,
      );
    return await use(dir);
  } finally {
    await git(root, 'worktree', 'remove', '--force', dir);
    await rm(dir, { recursive: true, force: true });
    await git(root, 'worktree', 'prune');
  }
}

const ENV_ALLOWED = [
  'PATH',
  'Path',
  'SystemRoot',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'LOCALAPPDATA',
  'APPDATA',
];

/** The CLI entry next to this module: the TypeScript source in a checkout, the build in the package. */
export function defaultCliEntry(): string {
  const base = join(import.meta.dir, '../../cli/main');
  return existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.js`;
}

/**
 * Runs `compile` on the candidate tree in a child process that is killed on timeout. The child has
 * a scrubbed environment (no secrets) and `--no-install`: nothing is fetched.
 */
export async function runCompile(
  dir: string,
  configPath: string,
  cliEntry: string,
  timeoutMs: number,
): Promise<void> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWED) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  const result = await run(
    [
      process.execPath,
      '--no-install',
      cliEntry,
      'compile',
      '--config',
      configPath,
    ],
    dir,
    { timeoutMs, env },
  );
  if (result.timedOut)
    throw new AgenticError(
      'bundle.compile-timeout',
      `compile of the candidate tree exceeded ${timeoutMs} ms and was stopped`,
    );
  if (result.code !== 0)
    throw new AgenticError(
      'bundle.compile-failed',
      `compile of the candidate tree exited with ${result.code}: ${quote(
        result.stderr.replaceAll(dir, '<candidate>').trim(),
        2000,
      )}`,
    );
}
