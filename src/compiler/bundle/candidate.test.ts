import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, statSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../../../test/helpers/shop-repo';
import {
  minimalEnv,
  pruneStale,
  quote,
  redact,
  resolveBase,
  run,
  runCandidateCli,
  withWorktree,
} from './candidate';

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

describe('redact', () => {
  test('hides a path in both slash forms, whatever its case', () => {
    const text = String.raw`at C:\Srv\app\x and c:/srv/APP/y and /srv/app/z`;
    expect(redact(text, [['C:/Srv/app', '<base>']])).toBe(
      String.raw`at <base>\x and <base>/y and /srv/app/z`,
    );
    expect(redact('/srv/app/z', [['/srv/app', '<base>']])).toBe('<base>/z');
  });

  test('replaces the longer path first, so a nested one is not left half hidden', () => {
    expect(
      redact('/srv/app/.tmp/bundle-1/f', [
        ['/srv/app/.tmp/bundle-1', '<candidate>'],
        ['/srv/app', '<base>'],
      ]),
    ).toBe('<candidate>/f');
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

describe('withWorktree after a timeout', () => {
  test('rejects with the timeout, not with a cleanup error, and removes the directory', async () => {
    const { root, work, sha } = await repo();
    const script = join(root, 'hang.ts');
    await writeFile(script, 'await Bun.sleep(60_000);\n');
    let seen = '';
    const error = await withWorktree(root, work, sha, 1000, async (dir) => {
      seen = dir;
      return runCandidateCli(dir, script, [], 500, 'probe');
    }).catch((e: Error) => e);
    expect(error).toMatchObject({ code: 'bundle.compile-timeout' });
    expect(existsSync(seen)).toBe(false);
  }, 30_000);
});

describe('runCandidateCli', () => {
  test('hides the base path and the candidate path in the failure message', async () => {
    const { root } = await repo();
    const script = join(root, 'fail.ts');
    await writeFile(
      script,
      'console.error("cwd " + process.cwd() + " arg " + process.argv[2]);\nprocess.exit(1);\n',
    );
    const secret = join(tmpdir(), 'agentic-secret');
    const error = await runCandidateCli(
      root,
      script,
      [join(secret, 'x').replaceAll('\\', '/')],
      30_000,
      'probe',
      [secret],
    ).catch((e: Error) => e);
    expect(error).toMatchObject({ code: 'bundle.compile-failed' });
    expect((error as Error).message).toContain('cwd <candidate>');
    expect((error as Error).message).toContain('arg <base>/x');
  });

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
      expect(Object.keys(env).some((k) => k.toUpperCase() === 'PATH')).toBe(
        true,
      );
      for (const [key, value] of Object.entries(env))
        expect(value).toBe(process.env[key]!);
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

  test('a signal that is already aborted stops the child before it can do anything', async () => {
    const started = Date.now();
    const result = await run(
      [process.execPath, '-e', 'setTimeout(() => {}, 60000)'],
      tmpdir(),
      { signal: AbortSignal.abort() },
    );
    expect(result.code).not.toBe(0);
    expect(result.timedOut).toBe(false);
    expect(Date.now() - started).toBeLessThan(30_000);
  });

  test('a timeout kills the descendants of the command, not only the command (#205)', async () => {
    const { dir, parent } = await descendants();
    const beat = join(dir, 'beat');
    const result = await run([process.execPath, parent, beat], dir, {
      timeoutMs: 3000,
    });
    expect(result.timedOut).toBe(true);
    await expectStopped(beat);
  }, 20_000);

  test('an abort kills the descendants of the command too (#205)', async () => {
    const { dir, parent } = await descendants();
    const beat = join(dir, 'beat');
    const abort = new AbortController();
    const running = run([process.execPath, parent, beat], dir, {
      signal: abort.signal,
    });
    await until(() => size(beat) > 0);
    abort.abort();
    await running;
    await expectStopped(beat);
  }, 20_000);

  describe.skipIf(process.platform === 'win32')(
    'a signal to the process that runs the commands (#205)',
    () => {
      test.each(['SIGINT', 'SIGHUP', 'SIGTERM'] as const)(
        '%s stops both running commands and their descendants, then the process by that signal',
        async (signal) => {
          const { runner, pids } = await signalled('none');
          runner.kill(signal);
          await runner.exited;
          expect(runner.signalCode).toBe(signal);
          for (const pid of pids) await until(() => !alive(pid));
        },
        30_000,
      );

      test('an app listener of its own still decides how the process ends', async () => {
        const { runner, pids, dir } = await signalled('once');
        runner.kill('SIGINT');
        expect(await runner.exited).toBe(0);
        expect(existsSync(join(dir, 'foreign'))).toBe(true);
        for (const pid of pids) await until(() => !alive(pid));
      }, 30_000);
    },
  );
});

/** A command (`parent`) whose child appends to the file named by its argument every 100 ms, while the command sleeps. */
async function descendants(): Promise<{ dir: string; parent: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'run-tree-'));
  dirs.push(dir);
  const beat = join(dir, 'heartbeat.ts');
  await writeFile(
    beat,
    "import { appendFileSync } from 'node:fs';\nsetInterval(() => appendFileSync(process.argv[2]!, 'x'), 100);\n",
  );
  const parent = join(dir, 'parent.ts');
  await writeFile(
    parent,
    [
      "import { writeFileSync } from 'node:fs';",
      `const child = Bun.spawn([process.execPath, ${JSON.stringify(beat)}, process.argv[2]!], { stdout: 'inherit', stderr: 'inherit' });`,
      "writeFileSync(`${process.argv[2]}.pid`, String(child.pid));",
      'await Bun.sleep(60_000);',
      '',
    ].join('\n'),
  );
  return { dir, parent };
}

/** A process that runs two commands through `run` at once; `once` adds an app SIGINT listener of its own first. */
async function signalled(mode: 'none' | 'once') {
  const { dir, parent } = await descendants();
  const runner = join(dir, 'runner.ts');
  await writeFile(
    runner,
    [
      "import { writeFileSync } from 'node:fs';",
      `const { run } = await import(${JSON.stringify(join(import.meta.dir, 'candidate.ts'))});`,
      `if (${JSON.stringify(mode)} === 'once') process.once('SIGINT', () => { writeFileSync(${JSON.stringify(join(dir, 'foreign'))}, 'x'); process.exit(0); });`,
      `await Promise.all(['a', 'b'].map((n) => run([process.execPath, ${JSON.stringify(parent)}, ${JSON.stringify(dir)} + '/' + n], ${JSON.stringify(dir)})));`,
      '',
    ].join('\n'),
  );
  const proc = Bun.spawn([process.execPath, runner], {
    stdout: 'ignore',
    stderr: 'inherit',
  });
  const pids: number[] = [];
  for (const n of ['a', 'b']) {
    const file = join(dir, `${n}.pid`);
    await until(() => existsSync(file) && size(join(dir, n)) > 0);
    pids.push(Number(await Bun.file(file).text()));
  }
  return { runner: proc, pids, dir };
}

const size = (file: string): number =>
  existsSync(file) ? statSync(file).size : 0;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(done: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await Bun.sleep(50);
  }
}

/** The heartbeat ran, and it no longer grows: the descendant is gone. */
async function expectStopped(beat: string): Promise<void> {
  const before = size(beat);
  expect(before).toBeGreaterThan(0);
  await Bun.sleep(600);
  expect(size(beat)).toBe(before);
}
