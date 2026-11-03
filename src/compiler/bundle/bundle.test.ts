import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
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
  workRoot: repo.work,
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
      id: '0001',
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

  test('refuses a Delta that does not render against the base', async () => {
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
    ).toBe('bundle.delta-invalid');
    expect(await leftovers(repo)).toEqual({ dirs: [], worktrees: 1 });
  }, 60_000);

  test('refuses a proposal id that is not NNNN', async () => {
    expect(
      await refusal(
        compileBundle({
          ...input(),
          proposal: { id: '../x', slug: 'ok', markdown: '# x' },
        }),
      ),
    ).toBe('bundle.proposal-invalid');
  }, 60_000);

  test('refuses a proposal slug that is not kebab-case', async () => {
    expect(
      await refusal(
        compileBundle({
          ...input(),
          proposal: { id: '0001', slug: 'Bad Slug', markdown: '# x' },
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
          workRoot: stale.work,
        }),
      ),
    ).toBe('delta.splice-anchor-missing');
    expect(await leftovers(stale)).toEqual({ dirs: [], worktrees: 1 });
  }, 120_000);
});
