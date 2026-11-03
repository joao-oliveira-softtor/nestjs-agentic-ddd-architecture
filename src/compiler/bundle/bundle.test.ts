import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { analyzeProject, compile } from '../compile';
import { serializeLock } from '../lock';
import { DEFAULT_CONVENTIONS } from '../conventions';
import { additionDelta, baseDelta } from '../delta/additions-fixture';
import { renderDelta } from '../delta/render';
import { compileBundle } from './index';

const ROOT = resolve(import.meta.dir, '../../..');
const dirs: string[] = [];

function git(cwd: string, ...args: string[]): string {
  const run = Bun.spawnSync(
    [
      'git',
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.autocrlf=false',
      ...args,
    ],
    {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      // A fixed date makes the base commit id, and so the bundle hash, the same on every run.
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
        GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
      },
    },
  );
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  return run.stdout.toString().trim();
}

/** A committed shop project: the base Delta rendered, compiled (lock and skills) and committed. */
async function shopRepo(
  mutateAfterCompile?: (root: string) => Promise<void>,
): Promise<{ root: string; ref: string; work: string }> {
  await mkdir(join(ROOT, '.tmp'), { recursive: true });
  const root = await mkdtemp(join(ROOT, '.tmp', 'bundle-base-'));
  dirs.push(root);
  const rendered = renderDelta(baseDelta(), {
    conventions: DEFAULT_CONVENTIONS,
    existingFiles: [],
  });
  if (!rendered.ok) throw new Error(JSON.stringify(rendered.errors));
  for (const f of rendered.files) {
    const target = join(root, 'src/shop', f.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, f.content);
  }
  // Bun reads decorator settings from the project tsconfig; the fixture borrows the repository one.
  await writeFile(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      extends: join(ROOT, 'tsconfig.json').replaceAll('\\', '/'),
    }),
  );
  const configPath = join(root, 'agentic.config.ts');
  await writeFile(
    configPath,
    `import { defineConfig } from '@agentic-ddd/compiler';
export default defineConfig({ mirrors: [], modules: [{ name: 'shop', path: 'src/shop' }] });
`,
  );
  // A first compile with a domain and no proposal writes no lock, so the base lock is written here.
  const { ir } = await analyzeProject({ configPath });
  await mkdir(join(root, '.agentic'), { recursive: true });
  await writeFile(
    join(root, '.agentic/domain.lock.json'),
    serializeLock({ lockVersion: 1, ir, changes: [] }),
  );
  const first = await compile({ configPath, mode: 'write' });
  if (!first.ok) throw new Error(JSON.stringify(first.errors));
  await mutateAfterCompile?.(root);
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  return {
    root,
    ref: git(root, 'rev-parse', 'HEAD'),
    work: join(root, '.tmp'),
  };
}

/** The code of the error a call is refused with. */
const refusal = (call: Promise<unknown>): Promise<unknown> =>
  call.then(
    () => 'resolved',
    (error: { code?: string }) => error.code,
  );

const leftovers = async (repo: { root: string; work: string }) => ({
  dirs: (await readdir(repo.work).catch(() => [])).filter((n) =>
    n.startsWith('bundle-'),
  ),
  worktrees: git(repo.root, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((l) => l.startsWith('worktree ')).length,
});

let repo: Awaited<ReturnType<typeof shopRepo>>;
beforeAll(async () => {
  repo = await shopRepo();
}, 60_000);
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

const input = () => ({
  delta: additionDelta(),
  baseRoot: repo.root,
  baseRef: repo.ref,
});

describe('compileBundle on the shop project', () => {
  test('returns the bundle, its manifest and BUNDLE.md as a snapshot', async () => {
    const bundle = await compileBundle(input());
    const file = (p: string) =>
      bundle.files.find((f) => f.path === p)?.content ?? '';
    expect(bundle.manifest.baseRef).toBe(repo.ref);
    expect(bundle.manifest.hash).toBe(bundle.hash);
    expect(file('BUNDLE.md').replaceAll(repo.ref, '<baseRef>')).toMatchSnapshot(
      'BUNDLE.md',
    );
    expect(
      JSON.parse(file('bundle.json').replaceAll(repo.ref, '<baseRef>')),
    ).toMatchSnapshot('bundle.json');
    expect(bundle.files.map((f) => f.path)).toMatchSnapshot('paths');
  }, 120_000);

  test('the same Delta on the same base gives a byte-identical bundle and hash', async () => {
    const a = await compileBundle(input());
    const b = await compileBundle(input());
    expect(b.hash).toBe(a.hash);
    expect(b.files).toEqual(a.files);
  }, 120_000);

  test('a different Delta gives a different hash', async () => {
    const a = await compileBundle(input());
    const b = await compileBundle({
      ...input(),
      delta: additionDelta('Refunds a paid order, with a reason.'),
    });
    expect(b.hash).not.toBe(a.hash);
  }, 120_000);

  test('carries the examples untouched and leaks no temp path or CRLF', async () => {
    const bundle = await compileBundle(input());
    expect(bundle.manifest.examples.map((e) => e.invariant)).toContain(
      'invariant:Order/paid-once',
    );
    for (const f of bundle.files) {
      expect(f.content).not.toContain(repo.work);
      expect(f.content).not.toContain('\r');
    }
  }, 120_000);

  test('hashes are the same whether the checkout has LF or CRLF line endings', async () => {
    git(repo.root, 'config', 'core.autocrlf', 'false');
    const lf = await compileBundle(input());
    // The worktree of the base is checked out with autocrlf, as on a Windows machine.
    git(repo.root, 'config', 'core.autocrlf', 'true');
    let crlf: Awaited<ReturnType<typeof compileBundle>>;
    try {
      crlf = await compileBundle(input());
    } finally {
      git(repo.root, 'config', 'core.autocrlf', 'false');
    }
    expect(crlf.manifest.baseLockHash).toBe(lf.manifest.baseLockHash);
    expect(crlf.manifest.files).toEqual(lf.manifest.files);
    expect(crlf.hash).toBe(lf.hash);
  }, 120_000);

  test('a valid proposal lands in the bundle and is covered by the hash', async () => {
    const proposal = {
      slug: 'refund-paid-order',
      markdown: [
        '---',
        'id: "0001"',
        'title: Refund a paid order',
        'status: proposed',
        'origin: proposal-first',
        'delta:',
        '  added: []',
        '  modified: []',
        '  removed: []',
        'acceptance: []',
        '---',
        '',
        '## Motivo',
        '',
        'Customers ask for refunds.',
        '',
      ].join('\n'),
    };
    const plain = await compileBundle(input());
    const a = await compileBundle({ ...input(), proposal });
    const path = 'target/changes/0001-refund-paid-order/proposal.md';
    expect(a.files.find((f) => f.path === path)?.content).toBe(
      proposal.markdown,
    );
    expect(a.manifest.files.map((f) => f.path)).toContain(path);
    expect(a.hash).not.toBe(plain.hash);
    const b = await compileBundle({
      ...input(),
      proposal: { ...proposal, markdown: `${proposal.markdown}More.\n` },
    });
    expect(b.hash).not.toBe(a.hash);
  }, 240_000);

  test('stores nothing: no worktree or directory is left after success', async () => {
    await compileBundle(input());
    expect(await leftovers(repo)).toEqual({ dirs: [], worktrees: 1 });
  }, 120_000);

  test('stores nothing after a compile failure', async () => {
    const script = join(repo.work, 'fail-cli.ts');
    await writeFile(script, 'console.error("boom");\nprocess.exit(1);\n');
    expect(await refusal(compileBundle({ ...input(), cliEntry: script }))).toBe(
      'bundle.compile-failed',
    );
    expect(await leftovers(repo)).toEqual({ dirs: [], worktrees: 1 });
  }, 120_000);

  test('stops a compile that outlives the timeout and stores nothing', async () => {
    const script = join(repo.work, 'hang-cli.ts');
    await writeFile(script, 'await Bun.sleep(60_000);\n');
    expect(
      await refusal(
        compileBundle({ ...input(), cliEntry: script, timeoutMs: 500 }),
      ),
    ).toBe('bundle.compile-timeout');
    expect(await leftovers(repo)).toEqual({ dirs: [], worktrees: 1 });
  }, 120_000);

  test('refuses an unknown base ref without echoing it raw', async () => {
    const error = await compileBundle({
      ...input(),
      baseRef: 'nope\u001b[31m"\n',
    }).catch((e: Error) => e);
    expect(error).toMatchObject({ code: 'bundle.base-unknown' });
    expect((error as Error).message).not.toContain('\u001b');
    expect((error as Error).message).not.toContain('\n');
    expect(await leftovers(repo)).toEqual({ dirs: [], worktrees: 1 });
  }, 60_000);

  test('refuses a Delta module the project does not configure', async () => {
    expect(
      await refusal(
        compileBundle({
          ...input(),
          delta: { ...additionDelta(), module: 'x' },
        }),
      ),
    ).toBe('bundle.module-unknown');
    expect(await leftovers(repo)).toEqual({ dirs: [], worktrees: 1 });
  }, 60_000);

  test('refuses a Delta that does not validate against the base commit, with the Delta error code', async () => {
    expect(
      await refusal(
        compileBundle({
          ...input(),
          delta: {
            ...additionDelta(),
            useCaseAdditions: [{ useCase: 'missing', uses: [], emits: [] }],
          },
        }),
      ),
    ).toBe('delta.reference-unknown');
    expect(await leftovers(repo)).toEqual({ dirs: [], worktrees: 1 });
  }, 60_000);

  test('refuses a proposal slug that is not kebab-case', async () => {
    expect(
      await refusal(
        compileBundle({
          ...input(),
          proposal: { slug: 'Bad Slug', markdown: '# x' },
        }),
      ),
    ).toBe('bundle.proposal-invalid');
  }, 60_000);

  test('refuses with the splice code when the file to extend lost its anchor', async () => {
    // The committed lock still lists Order, but its file no longer declares it.
    const stale = await shopRepo(async (root) => {
      await writeFile(join(root, 'src/shop/domain/order.ts'), 'export {};\n');
    });
    expect(
      await refusal(
        compileBundle({
          delta: additionDelta(),
          baseRoot: stale.root,
          baseRef: stale.ref,
        }),
      ),
    ).toBe('delta.splice-anchor-missing');
    expect(await leftovers(stale)).toEqual({ dirs: [], worktrees: 1 });
  }, 120_000);
});

const PROPOSAL = (id: string, status = 'proposed') =>
  [
    '---',
    `id: "${id}"`,
    'title: Refund a paid order',
    `status: ${status}`,
    'origin: proposal-first',
    'delta:',
    '  added: []',
    '  modified: []',
    '  removed: []',
    'acceptance: []',
    '---',
    '',
    '## Motivo',
    '',
    'Customers ask for refunds.',
    '',
  ].join('\n');

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('candidate code never runs in the server process', () => {
  test('a candidate module with a top-level side effect runs only in a child', async () => {
    const marks = await mkdtemp(join(tmpdir(), 'bundle-marks-'));
    dirs.push(marks);
    const effect = await shopRepo(async (root) => {
      await writeFile(
        join(root, 'src/shop/domain/side-effect.ts'),
        `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(join(marks, 'pid-'))} + process.pid, '');
export {};
`,
      );
    });
    await compileBundle({
      delta: additionDelta(),
      baseRoot: effect.root,
      baseRef: effect.ref,
    });
    const pids = (await readdir(marks)).map((n) => Number(n.slice(4)));
    expect(pids.length).toBeGreaterThan(0);
    expect(pids).not.toContain(process.pid);
  }, 180_000);

  test('an analysis that hangs is killed at the deadline and nothing is left', async () => {
    const pidFile = join(repo.work, 'analysis-pid');
    const script = join(repo.work, 'hang-analysis-cli.ts');
    await writeFile(
      script,
      `import { writeFileSync } from 'node:fs';
if (process.argv[2] === 'compile') process.exit(0);
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
await Bun.sleep(60_000);
`,
    );
    expect(
      await refusal(
        compileBundle({ ...input(), cliEntry: script, timeoutMs: 3000 }),
      ),
    ).toBe('bundle.compile-timeout');
    const pid = Number(await readFile(pidFile, 'utf8'));
    await Bun.sleep(300);
    expect(alive(pid)).toBe(false);
    expect(await leftovers(repo)).toEqual({ dirs: [], worktrees: 1 });
  }, 60_000);

  test('a child that hands its pipes to a surviving grandchild cannot hold the call', async () => {
    const script = join(repo.work, 'grandchild-cli.ts');
    await writeFile(
      script,
      `Bun.spawn(['bun', '-e', 'await Bun.sleep(20000)'], { stdout: 'inherit', stderr: 'inherit' });
await Bun.sleep(60_000);
`,
    );
    const started = Date.now();
    expect(
      await refusal(
        compileBundle({ ...input(), cliEntry: script, timeoutMs: 1500 }),
      ),
    ).toBe('bundle.compile-timeout');
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 60_000);
});

describe('orphans of a crashed server', () => {
  test('stale bundle directories and worktree entries go; a young one stays', async () => {
    const old = new Date(Date.now() - 24 * 3600_000);
    const stale = join(repo.work, 'bundle-stale');
    git(repo.root, 'worktree', 'add', '--detach', stale, repo.ref);
    await utimes(stale, old, old);
    const gone = join(repo.work, 'bundle-gone');
    git(repo.root, 'worktree', 'add', '--detach', gone, repo.ref);
    await rm(gone, { recursive: true, force: true });
    const young = join(repo.work, 'bundle-young');
    await mkdir(young, { recursive: true });
    try {
      await compileBundle(input());
      expect(await readdir(repo.work)).not.toContain('bundle-stale');
      expect(await readdir(repo.work)).toContain('bundle-young');
      const listed = git(repo.root, 'worktree', 'list', '--porcelain');
      expect(listed).not.toContain('bundle-stale');
      expect(listed).not.toContain('bundle-gone');
    } finally {
      await rm(young, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('the base commit is the single source of truth', () => {
  test('an uncommitted change to the working copy does not touch the bundle', async () => {
    const clean = await compileBundle(input());
    const lock = join(repo.root, '.agentic/domain.lock.json');
    const original = await readFile(lock, 'utf8');
    await writeFile(lock, '{ "lockVersion": 1, "ir": "garbage" }');
    await mkdir(join(repo.root, 'changes/0009-draft'), { recursive: true });
    try {
      const dirty = await compileBundle({
        ...input(),
        proposal: { slug: 'x', markdown: PROPOSAL('0001') },
      });
      expect(dirty.manifest.baseLockHash).toBe(clean.manifest.baseLockHash);
      expect(dirty.files.map((f) => f.path)).toContain(
        'target/changes/0001-x/proposal.md',
      );
    } finally {
      await writeFile(lock, original);
      await rm(join(repo.root, 'changes'), { recursive: true, force: true });
    }
  }, 120_000);

  test('a committed changes/NNNN-* directory missing from the lock is counted', async () => {
    const numbered = await shopRepo(async (root) => {
      await mkdir(join(root, 'changes/0003-earlier'), { recursive: true });
      await writeFile(
        join(root, 'changes/0003-earlier/proposal.md'),
        PROPOSAL('0003'),
      );
    });
    // The open 0003 makes the candidate refuse a second one: the message proves the new number.
    const error = await compileBundle({
      delta: additionDelta(),
      baseRoot: numbered.root,
      baseRef: numbered.ref,
      proposal: { slug: 'next', markdown: PROPOSAL('0004') },
    }).catch((e: Error) => e);
    expect(error).toMatchObject({ code: 'bundle.compile-failed' });
    expect((error as Error).message).toContain('0003, 0004');
  }, 120_000);
});

describe('the bundle matches what apply would produce', () => {
  test('specHash and packet equal those computed on the base with the bundle applied', async () => {
    const bundle = await compileBundle(input());
    const copy = await mkdtemp(join(ROOT, '.tmp', 'bundle-applied-'));
    dirs.push(copy);
    await cp(repo.root, copy, {
      recursive: true,
      filter: (src) =>
        !/^(\.tmp|\.git)([\\/]|$)/.test(relative(repo.root, src)),
    });
    for (const f of bundle.files.filter((f) =>
      f.path.startsWith('target/skeleton/'),
    )) {
      const target = join(copy, f.path.slice('target/skeleton/'.length));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, f.content);
    }
    const { items } = bundle.manifest.layers.target;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      const run = Bun.spawnSync(
        [
          process.execPath,
          join(ROOT, 'src/cli/main.ts'),
          'packet',
          item.id,
          '--static',
        ],
        { cwd: copy, stdout: 'pipe', stderr: 'pipe' },
      );
      expect(run.stderr.toString()).toBe('');
      const text = run.stdout.toString().replaceAll('\r\n', '\n');
      expect(text).toContain(`specHash: \`${item.specHash}\``);
      expect(text).toBe(
        bundle.files.find((f) => f.path === item.packet)!.content,
      );
    }
  }, 180_000);
});

describe('what the bundle lists', () => {
  test('additions to existing items yield items with packets and briefs', async () => {
    const bundle = await compileBundle(input());
    const { items } = bundle.manifest.layers.target;
    expect(items.map((i) => i.id)).toContain('entity:Order');
    const paths = bundle.files.map((f) => f.path);
    for (const item of items) {
      expect(paths).toContain(item.packet);
      expect(paths).toContain(item.brief);
    }
  }, 120_000);

  test('BUNDLE.md lists the items in wave order', async () => {
    const bundle = await compileBundle(input());
    const md = bundle.files.find((f) => f.path === 'BUNDLE.md')!.content;
    const listed = [...md.matchAll(/^- `([^`]+)` \(/gm)].map((m) => m[1]);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed).toEqual(bundle.manifest.layers.target.waves.flat());
  }, 120_000);
});
