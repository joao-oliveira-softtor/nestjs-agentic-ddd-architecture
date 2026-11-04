import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../../../test/helpers/shop-repo';
import { minimalEnv, pruneStale, quote, resolveBase, run, runCandidateCli, withWorktree } from './candidate';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

/** A git repository with one empty commit, and the directory for its worktrees. */
async function repo(): Promise<{ root: string; work: string; sha: string }> {
  const root = await mkdtemp(join(tmpdir(), 'candidate-'));
  dirs.push(root);
  git(root, 'init', '-q');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'base');
  const work = join(root, 'work');
  await mkdir(work);
  return { root, work, sha: git(root, 'rev-parse', 'HEAD') };
}

const refusal = (call: Promise<unknown>): Promise<unknown> =>
  call.then(
    () => 'resolved',
    (error: { code?: string }) => error.code,
  );

describe('quote', () => {
  test('keeps a text up to the limit and cuts a longer one with an ellipsis', () => {
    expect(quote('a'.repeat(80))).toBe(`"${'a'.repeat(80)}"`);
    expect(quote('a'.repeat(81))).toBe(`"${'a'.repeat(80)}..."`);
    expect(quote('ab', 1)).toBe('"a..."');
  });

  test('escapes control characters', () => {
    expect(quote('x\n\u001b')).toBe('"x\\n\\u001b"');
  });
});

describe('resolveBase', () => {
  test('resolves a ref to the full commit id', async () => {
    const { root, sha } = await repo();
    expect(await resolveBase(root, 'HEAD')).toBe(sha);
  });

  test('refuses an unknown ref, an empty one and one that looks like an option', async () => {
    const { root } = await repo();
    for (const ref of ['nope', '', '-x', '--version'])
      expect(await refusal(resolveBase(root, ref))).toBe('bundle.base-unknown');
  });
});

describe('pruneStale', () => {
  test('removes an old bundle directory that git does not know, and keeps young and unrelated ones', async () => {
    const { root, work } = await repo();
    const old = new Date(Date.now() - 24 * 3600_000);
    for (const name of ['bundle-orphan', 'keep-me']) {
      await mkdir(join(work, name));
      await writeFile(join(work, name, 'file'), 'x');
      await utimes(join(work, name), old, old);
    }
    await mkdir(join(work, 'bundle-young'));
    await pruneStale(root, work, 3600_000);
    expect((await readdir(work)).sort()).toEqual(['bundle-young', 'keep-me']);
  });
});

describe('withWorktree', () => {
  test('removes the directory even when git cannot remove the worktree', async () => {
    const { root, work, sha } = await repo();
    let seen = '';
    await withWorktree(root, work, sha, 1000, async (dir) => {
      seen = dir;
      // A locked worktree survives `git worktree remove --force`.
      git(root, 'worktree', 'lock', dir);
      await writeFile(join(dir, 'untracked'), 'x');
    });
    expect(seen).not.toBe('');
    expect(existsSync(seen)).toBe(false);
  });
});

describe('runCandidateCli', () => {
  test('runs the child with a scrubbed environment: the allowed variables only', async () => {
    const { root } = await repo();
    const script = join(root, 'env.ts');
    await writeFile(
      script,
      'console.log(JSON.stringify(Object.keys(process.env)));\n',
    );
    process.env.AGENTIC_TEST_SECRET = 'x';
    let out: string;
    try {
      out = await runCandidateCli(root, script, [], 30_000, 'probe');
    } finally {
      delete process.env.AGENTIC_TEST_SECRET;
    }
    const keys = (JSON.parse(out) as string[]).map((k) => k.toUpperCase());
    expect(keys).not.toContain('AGENTIC_TEST_SECRET');
    expect(keys).toContain('PATH');
  });
});

describe('minimalEnv', () => {
  test('keeps PATH and the platform variables that are set, and nothing else', () => {
    process.env.AGENTIC_TEST_SECRET = 'x';
    process.env.BUN_INSTALL = '/bun';
    try {
      const env = minimalEnv();
      expect(env.BUN_INSTALL).toBe('/bun');
      expect(Object.keys(env)).not.toContain('AGENTIC_TEST_SECRET');
      expect(Object.keys(env).some((k) => k.toUpperCase() === 'PATH')).toBe(true);
      for (const [key, value] of Object.entries(env)) expect(value).toBe(process.env[key]!);
    } finally {
      delete process.env.AGENTIC_TEST_SECRET;
      delete process.env.BUN_INSTALL;
    }
  });

  test('leaves out a variable that is not set', () => {
    const saved = process.env.BUN_INSTALL;
    delete process.env.BUN_INSTALL;
    try {
      expect(Object.keys(minimalEnv())).not.toContain('BUN_INSTALL');
    } finally {
      if (saved !== undefined) process.env.BUN_INSTALL = saved;
    }
  });
});

describe('run', () => {
  test('an aborted signal kills the child before its own time is up', async () => {
    const abort = new AbortController();
    const started = Date.now();
    setTimeout(() => abort.abort(), 200);
    const result = await run(
      [process.execPath, '-e', 'setTimeout(() => {}, 60000)'],
      tmpdir(),
      { signal: abort.signal },
    );
    expect(result.code).not.toBe(0);
    expect(result.timedOut).toBe(false);
    expect(Date.now() - started).toBeLessThan(30_000);
  });
});
