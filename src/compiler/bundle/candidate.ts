import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
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
  const finished = Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]).then(([stdout, stderr, code]) => ({
    code,
    stdout,
    stderr,
    timedOut: false,
  }));
  if (options.timeoutMs === undefined) return finished;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The timer is raced against the whole read, not only the exit: a grandchild that keeps the
  // pipes open after the kill cannot hold the await.
  const expired = new Promise<Run>((resolve) => {
    timer = setTimeout(() => {
      child.kill();
      // Resolved once the process is gone: the caller removes the directory it runs in next.
      void child.exited.then(() =>
        resolve({ code: null, stdout: '', stderr: '', timedOut: true }),
      );
    }, options.timeoutMs);
  });
  try {
    return await Promise.race([finished, expired]);
  } finally {
    clearTimeout(timer);
  }
}

const escapeRegExp = (s: string): string =>
  s.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);

const resolved = (path: string): string => {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
};

/**
 * Hides server paths in text that reaches a client: each path as given and resolved, in both slash
 * forms, whatever its case (Windows). Earlier entries go first, so list the longer path first.
 */
export function redact(
  text: string,
  paths: readonly (readonly [path: string, label: string])[],
): string {
  let out = text;
  for (const [path, label] of paths) {
    const forms = new Set(
      [path, resolved(path)].flatMap((p) => [
        p,
        p.replaceAll('\\', '/'),
        p.replaceAll('/', '\\'),
      ]),
    );
    for (const form of forms)
      out = out.replaceAll(new RegExp(escapeRegExp(form), 'gi'), label);
  }
  return out;
}

/** Client text in a message: JSON-quoted (control characters escaped) and cut short. */
export const quote = (s: string, max = 80): string =>
  JSON.stringify(s.length > max ? `${s.slice(0, max)}...` : s);

const git = (cwd: string, ...args: string[]) => run(['git', ...args], cwd);

/** The top level of the git repository that holds `root`, or `bundle.base-unknown`. */
export async function repoTop(root: string): Promise<string> {
  const out = await git(root, 'rev-parse', '--show-toplevel');
  if (out.code !== 0)
    throw new AgenticError(
      'bundle.base-unknown',
      'the base root is not inside a git repository',
    );
  return out.stdout.trim();
}

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
 * Orphans of a crashed server: unregistered worktree entries, and `bundle-*` directories older than
 * `staleMs`. Younger ones may belong to a call in flight in another server process: never touched.
 */
export async function pruneStale(
  root: string,
  workRoot: string,
  staleMs: number,
): Promise<void> {
  const registered = (await git(root, 'worktree', 'list', '--porcelain')).stdout
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => resolve(l.slice('worktree '.length)));
  const names = new Set([
    ...(await readdir(workRoot).catch(() => [])),
    ...registered
      .filter((p) => samePath(dirname(p), workRoot))
      .map((p) => basename(p)),
  ]);
  for (const name of names) {
    if (!name.startsWith('bundle-')) continue;
    const dir = join(workRoot, name);
    const info = await stat(dir).catch(() => null);
    // A registered entry whose directory is gone has no age: it is an orphan.
    if (info && Date.now() - info.mtimeMs < staleMs) continue;
    await removeWorktree(root, dir);
  }
}

const samePath = (a: string, b: string): boolean =>
  resolve(a).toLowerCase() === resolve(b).toLowerCase();

/**
 * Runs `use` on a detached worktree of `sha`, created under `workRoot` (inside the base project by
 * default, so the base `node_modules` resolves). The worktree is removed on every path.
 */
export async function withWorktree<T>(
  root: string,
  workRoot: string,
  sha: string,
  staleMs: number,
  use: (dir: string) => Promise<T>,
): Promise<T> {
  await mkdir(workRoot, { recursive: true });
  await pruneStale(root, workRoot, staleMs);
  const dir = await mkdtemp(join(workRoot, 'bundle-'));
  try {
    const added = await git(root, 'worktree', 'add', '--detach', dir, sha);
    if (added.code !== 0)
      throw new AgenticError(
        'bundle.base-unknown',
        `cannot check out the base commit: ${quote(
          redact(added.stderr.trim(), [
            [dir, '<candidate>'],
            [root, '<base>'],
          ]),
          300,
        )}`,
      );
    return await use(dir);
  } finally {
    await removeWorktree(root, dir);
  }
}

/**
 * Removes only our own worktree (no global `git worktree prune`, which would also drop the entries
 * of the user's worktrees that are momentarily unreachable). A failure here never replaces the
 * result of the call: a leftover is swept by `pruneStale` on a later call.
 */
async function removeWorktree(root: string, dir: string): Promise<void> {
  await git(root, 'worktree', 'remove', '--force', dir).catch(() => {});
  await rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  }).catch(() => {});
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
 * Runs one CLI command on the candidate tree in a child process that is killed on timeout. Candidate
 * code is imported only there: scrubbed environment (no secrets), argv-only spawn, `--no-install`
 * (nothing is fetched). `cwd` is the candidate root, so the config is passed relative to it.
 */
export async function runCandidateCli(
  dir: string,
  cliEntry: string,
  args: readonly string[],
  timeoutMs: number,
  what: string,
  hide: readonly string[] = [],
): Promise<string> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWED) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  const result = await run(
    [process.execPath, '--no-install', cliEntry, ...args],
    dir,
    { timeoutMs, env },
  );
  if (result.timedOut)
    throw new AgenticError(
      'bundle.compile-timeout',
      `${what} of the candidate tree exceeded its time limit and was stopped`,
    );
  if (result.code !== 0)
    throw new AgenticError(
      'bundle.compile-failed',
      `${what} of the candidate tree exited with ${result.code}: ${quote(
        redact(result.stderr, [
          [dir, '<candidate>'],
          ...hide.map((p): [string, string] => [p, '<base>']),
        ]).trim(),
        2000,
      )}`,
    );
  return result.stdout;
}
