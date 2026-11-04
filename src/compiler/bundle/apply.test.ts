import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyFixture,
  bundleWith,
  cloneAt,
  monorepoFixture,
  rewriteBundle,
  snapshot,
} from '../../../test/helpers/apply-fixture';
import { git } from '../../../test/helpers/shop-repo';
import { applyBundle } from './apply';

const failure = (call: Promise<unknown>) =>
  call.then(
    () => ({ code: 'resolved', message: '' }),
    (error: { code?: string; message?: string }) => ({
      code: error.code,
      message: error.message ?? '',
    }),
  );

let fx: Awaited<ReturnType<typeof applyFixture>>;
const cleanup: string[] = [];
beforeAll(async () => {
  fx = await applyFixture();
  cleanup.push(fx.repo.root, fx.dir);
}, 240_000);
afterAll(async () => {
  for (const d of cleanup) await rm(d, { recursive: true, force: true });
});

const fresh = async () => {
  const t = await cloneAt(fx.repo.root, fx.ref);
  cleanup.push(t);
  return t;
};
const apply = (projectRoot: string, extra = {}) =>
  applyBundle({ bundleDir: fx.dir, projectRoot, yes: true, ...extra });

/** A bundle directory built by `make`, removed with the other temp dirs. */
const bundleDir = async (make: Promise<string>) => {
  const dir = await make;
  cleanup.push(dir);
  return dir;
};

/** Asserts the apply is refused with `code` and that the project is byte-identical afterwards. */
const refused = async (
  t: string,
  code: string,
  extra: Record<string, unknown> = {},
) => {
  const before = await snapshot(t);
  const result = await failure(apply(t, extra));
  expect(result.code).toBe(code);
  expect(await snapshot(t)).toEqual(before);
  return result;
};
const noTemp = async (t: string) =>
  expect(await readdir(join(t, '.tmp')).catch(() => [])).toEqual([]);

describe('applyBundle', () => {
  test('refuses a tampered bundle file with apply.hash-mismatch and writes nothing', async () => {
    const skeleton = fx.bundle.manifest.layers.target.skeleton[0]!;
    const path = join(fx.dir, 'target/skeleton', skeleton);
    const original = await readFile(path, 'utf8');
    await writeFile(path, `${original}\n// tampered\n`);
    try {
      const t = await fresh();
      const before = await snapshot(t);
      expect((await failure(apply(t))).code).toBe('apply.hash-mismatch');
      expect(await snapshot(t)).toEqual(before);
    } finally {
      await writeFile(path, original);
    }
  }, 60_000);

  test('refuses an extra file in the bundle with apply.hash-mismatch', async () => {
    const extra = join(fx.dir, 'target/extra.txt');
    await writeFile(extra, 'x');
    try {
      expect((await failure(apply(await fresh()))).code).toBe(
        'apply.hash-mismatch',
      );
    } finally {
      await rm(extra);
    }
  }, 60_000);

  test('refuses a missing file in the bundle with apply.hash-mismatch', async () => {
    const path = join(
      fx.dir,
      `target/${fx.bundle.manifest.layers.target.items[0]!.packet.slice('target/'.length)}`,
    );
    const original = await readFile(path, 'utf8');
    await rm(path);
    try {
      expect((await failure(apply(await fresh()))).code).toBe(
        'apply.hash-mismatch',
      );
    } finally {
      await writeFile(path, original);
    }
  }, 60_000);

  test('refuses a project whose lock is another base with apply.base-mismatch and writes nothing', async () => {
    const t = await fresh();
    const lock = join(t, '.agentic/domain.lock.json');
    await writeFile(lock, `${await readFile(lock, 'utf8')} `);
    git(t, 'commit', '-q', '-am', 'other lock');
    const before = await snapshot(t);
    expect((await failure(apply(t))).code).toBe('apply.base-mismatch');
    expect(await snapshot(t)).toEqual(before);
  }, 60_000);

  test('refuses a locally modified target file with apply.base-mismatch, naming it', async () => {
    const t = await fresh();
    const rel = fx.bundle.manifest.layers.target.skeleton.find(
      (p) =>
        Bun.spawnSync(['git', 'cat-file', '-e', `${fx.ref}:${p}`], { cwd: t })
          .exitCode === 0,
    )!;
    expect(rel).toBeDefined();
    await writeFile(
      join(t, rel),
      `${await readFile(join(t, rel), 'utf8')}// local\n`,
    );
    const before = await snapshot(t);
    const result = await failure(apply(t));
    expect(result.code).toBe('apply.base-mismatch');
    expect(result.message).toContain(rel);
    expect(await snapshot(t)).toEqual(before);
  }, 60_000);

  test('refuses when the change directory already exists with apply.change-exists', async () => {
    const t = await fresh();
    await mkdir(join(t, 'changes/0001-other'), { recursive: true });
    await writeFile(join(t, 'changes/0001-other/x.md'), 'x');
    expect((await failure(apply(t))).code).toBe('apply.change-exists');
  }, 60_000);

  test('leaves the tree byte-identical when a write fails half-way', async () => {
    const t = await fresh();
    const before = await snapshot(t);
    let moved = 0;
    const result = await failure(
      apply(t, {
        beforeMove: () => {
          if (++moved === 3) throw new Error('disk full');
        },
      }),
    );
    expect(moved).toBe(3);
    expect(result.code).toBe('apply.write-failed');
    expect(await snapshot(t)).toEqual(before);
    await noTemp(t);
  }, 60_000);

  test('rolls everything back when the compile fails', async () => {
    const t = await fresh();
    const before = await snapshot(t);
    const script = join(t, '.tmp-fail-cli.ts');
    await writeFile(script, 'console.error("boom");\nprocess.exit(1);\n');
    try {
      expect((await failure(apply(t, { cliEntry: script }))).code).toBe(
        'apply.compile-failed',
      );
    } finally {
      await rm(script);
    }
    expect(await snapshot(t)).toEqual(before);
    await noTemp(t);
  }, 60_000);

  test('writes the skeleton, the proposal and examples.json, then compiles; no bundle-only files', async () => {
    const t = await fresh();
    const result = await apply(t);
    expect(result.change).toBe('0001-refund-paid-order');
    const after = await snapshot(t);
    for (const p of fx.bundle.manifest.layers.target.skeleton)
      expect(after.has(p)).toBe(true);
    const change = 'changes/0001-refund-paid-order';
    expect(after.get(`${change}/proposal.md`)).toBe(
      fx.bundle.files.find((f) => f.path === `target/${change}/proposal.md`)!
        .content,
    );
    const examples = after.get(`${change}/examples.json`)!;
    expect(JSON.parse(examples)).toEqual(fx.bundle.manifest.examples);
    expect(examples).not.toContain('\r');
    expect(
      [...after.keys()].some((k) =>
        /BUNDLE\.md|bundle\.json|packets\//.test(k),
      ),
    ).toBe(false);
    // the neutral layer is in the bundle but never written into the project
    expect(fx.bundle.files.some((f) => f.path.startsWith('neutral/'))).toBe(
      true,
    );
    expect([...after.keys()].some((k) => k.includes('neutral'))).toBe(false);
    // compile ran: the module dev skill now describes the new skeleton
    const skill = '.agents/skills/shop-dev/SKILL.md';
    expect(after.get(skill)).not.toBe(
      await readFile(join(fx.repo.root, skill), 'latin1'),
    );
    await noTemp(t);
  }, 120_000);
});

describe('applyBundle write rules', () => {
  const HOSTILE = [
    '.git/hooks/pre-commit',
    '.github/workflows/x.yml',
    'bunfig.toml',
    '.npmrc',
    'package.json',
    'src/evil.ts',
    'src/shop-evil/x.ts',
    '.GIT/hooks/x',
    'node_modules/x/index.js',
    '.tmp/x',
    'src/shop/node_modules/x.js',
  ];

  test('refuses a path outside the module and change directory with apply.path-forbidden, naming it', async () => {
    const t = await fresh();
    for (const path of HOSTILE) {
      const dir = await bundleDir(
        bundleWith(fx, { [`target/skeleton/${path}`]: 'x' }),
      );
      const result = await refused(t, 'apply.path-forbidden', {
        bundleDir: dir,
      });
      expect(result.message).toContain(path);
    }
  }, 120_000);

  test('refuses a write through a link that leaves the repo or the module with apply.path-forbidden', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'apply-outside-'));
    cleanup.push(outside);
    const t = await fresh();
    await symlink(outside, join(t, 'src/shop/linked'), 'junction');
    await symlink(join(t, '.agentic'), join(t, 'src/shop/state'), 'junction');
    for (const via of ['linked', 'state']) {
      const dir = await bundleDir(
        bundleWith(fx, { [`target/skeleton/src/shop/${via}/evil.ts`]: 'x' }),
      );
      await refused(t, 'apply.path-forbidden', { bundleDir: dir });
    }
    expect(await readdir(outside)).toEqual([]);
    expect(await readdir(join(t, '.agentic'))).not.toContain('evil.ts');
  }, 120_000);

  test('refuses a bundle with more than one change directory with apply.change-invalid', async () => {
    const dir = await bundleDir(
      bundleWith(fx, { 'target/changes/0002-other/proposal.md': 'x' }),
    );
    await refused(await fresh(), 'apply.change-invalid', { bundleDir: dir });
  }, 60_000);

  test('refuses a change directory that is not NNNN-slug, or none at all, with apply.change-invalid', async () => {
    const t = await fresh();
    const renamed = await bundleDir(
      rewriteBundle(fx, (files) =>
        files.map((f) => ({
          ...f,
          path: f.path.replace('0001-refund-paid-order', 'Bad_Name'),
        })),
      ),
    );
    await refused(t, 'apply.change-invalid', { bundleDir: renamed });
    const none = await bundleDir(
      rewriteBundle(fx, (files) =>
        files.filter((f) => !f.path.startsWith('target/changes/')),
      ),
    );
    await refused(t, 'apply.change-invalid', { bundleDir: none });
  }, 60_000);
});

describe('applyBundle confirmation', () => {
  test('without yes, lists the files and the hash, writes nothing and asks for confirmation', async () => {
    const t = await fresh();
    const overwritten = fx.bundle.manifest.layers.target.skeleton.find(
      (p) =>
        Bun.spawnSync(['git', 'cat-file', '-e', `${fx.ref}:${p}`], { cwd: t })
          .exitCode === 0,
    )!;
    const { message } = await refused(t, 'apply.confirmation-required', {
      yes: false,
    });
    expect(message).toContain(`overwrite ${overwritten}`);
    expect(message).toContain('new changes/0001-refund-paid-order/proposal.md');
    expect(message).toContain(fx.bundle.manifest.hash);
    expect(message).toContain(
      'Integrity check only: the hash proves the bundle is unchanged, not who made it. Compare the hash with the sender before passing --yes.',
    );
    await noTemp(t);
  }, 60_000);
});

describe('applyBundle lock', () => {
  test('refuses while another apply holds the lock with apply.locked, and keeps its lock file', async () => {
    const t = await fresh();
    await mkdir(join(t, '.tmp'), { recursive: true });
    const lock = join(t, '.tmp/apply.lock');
    await writeFile(lock, 'held');
    const { message } = await refused(t, 'apply.locked');
    expect(message).toContain('apply.lock');
    expect(message).toContain('no apply is running');
    expect(await readFile(lock, 'utf8')).toBe('held');
  }, 60_000);
});

describe('applyBundle compile child', () => {
  const script = async (body: string) => {
    const dir = await mkdtemp(join(tmpdir(), 'apply-cli-'));
    cleanup.push(dir);
    const path = join(dir, 'cli.ts');
    await writeFile(path, body);
    return { path, dir };
  };

  test('is stopped on timeout with apply.compile-timeout and every write is rolled back', async () => {
    const { path } = await script('await Bun.sleep(60_000);\n');
    const t = await fresh();
    await refused(t, 'apply.compile-timeout', {
      cliEntry: path,
      timeoutMs: 1500,
    });
    await noTemp(t);
  }, 60_000);

  test('runs with PATH and platform variables only, no tokens', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'apply-cli-'));
    cleanup.push(dir);
    const out = join(dir, 'env.json');
    const cli = join(dir, 'cli.ts');
    await writeFile(
      cli,
      `await Bun.write(${JSON.stringify(out)}, JSON.stringify(Object.keys(process.env)));\nprocess.exit(1);\n`,
    );
    const t = await fresh();
    await refused(t, 'apply.compile-failed', { cliEntry: cli });
    const keys: string[] = JSON.parse(await readFile(out, 'utf8'));
    // Bun.spawn hands a child the environment this process started with, so what a child must not
    // see is every start-up variable outside the list (the Windows ones are added by the OS).
    const allowed = new Set(
      'PATH SYSTEMROOT TEMP TMP TMPDIR HOME USERPROFILE LOCALAPPDATA APPDATA BUN_INSTALL HOMEDRIVE HOMEPATH LOGONSERVER SYSTEMDRIVE USERDOMAIN USERNAME WINDIR'.split(
        ' ',
      ),
    );
    const leaked = keys.filter(
      (k) => k in process.env && !allowed.has(k.toUpperCase()),
    );
    expect(leaked).toEqual([]);
    expect(keys.map((k) => k.toUpperCase())).toContain('PATH');
  }, 60_000);

  test('says the bundle files were restored but compile outputs were not, and how to regenerate', async () => {
    const { path } = await script('console.error("boom");\nprocess.exit(1);\n');
    const { message } = await refused(await fresh(), 'apply.compile-failed', {
      cliEntry: path,
    });
    expect(message).not.toContain('nothing was changed');
    expect(message).toContain("bundle's files were restored");
    expect(message).toContain('regenerated by compile were not');
    expect(message).toContain('bun run agentic compile');
    expect(message).toContain('boom');
  }, 60_000);
});

describe('applyBundle signals', () => {
  const listeners = () =>
    (['SIGINT', 'SIGTERM'] as const).map((s) => process.listenerCount(s));

  test('a signal while writing rolls everything back, exits 130 and releases the lock', async () => {
    const t = await fresh();
    const before = await snapshot(t);
    const counts = listeners();
    const exits: number[] = [];
    const result = await failure(
      apply(t, {
        exit: (code: number) => exits.push(code),
        beforeMove: (i: number) => {
          if (i === 2) process.emit('SIGINT');
        },
      }),
    );
    expect(result.code).toBe('apply.write-failed');
    expect(exits).toEqual([130]);
    expect(await snapshot(t)).toEqual(before);
    await noTemp(t);
    expect(listeners()).toEqual(counts);
  }, 60_000);

  test('a signal while compiling stops the child, rolls everything back and exits 130', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'apply-cli-'));
    cleanup.push(dir);
    const marker = join(dir, 'started');
    const cli = join(dir, 'cli.ts');
    await writeFile(
      cli,
      `await Bun.write(${JSON.stringify(marker)}, '1');\nawait Bun.sleep(60_000);\n`,
    );
    const t = await fresh();
    const before = await snapshot(t);
    const exits: number[] = [];
    const running = failure(
      apply(t, { cliEntry: cli, exit: (code: number) => exits.push(code) }),
    );
    while (!(await Bun.file(marker).exists())) await Bun.sleep(50);
    process.emit('SIGTERM');
    expect((await running).code).toBe('apply.compile-failed');
    expect(exits).toEqual([130]);
    expect(await snapshot(t)).toEqual(before);
    await noTemp(t);
  }, 60_000);
});

describe('applyBundle in a monorepo', () => {
  test('reads the base files relative to the project folder when the git root is above it', async () => {
    const mono = await monorepoFixture(fx);
    cleanup.push(mono.root, mono.dir);
    const scratch = await mkdtemp(join(tmpdir(), 'apply-cli-'));
    cleanup.push(scratch);
    const cli = join(scratch, 'cli.ts');
    await writeFile(cli, 'process.exit(0);\n');
    const result = await applyBundle({
      bundleDir: mono.dir,
      projectRoot: mono.project,
      yes: true,
      cliEntry: cli,
    });
    expect(result.change).toBe('0001-refund-paid-order');
    const skeleton = fx.bundle.manifest.layers.target.skeleton[0]!;
    expect(
      (await readFile(join(mono.project, skeleton), 'utf8')).length,
    ).toBeGreaterThan(0);
  }, 120_000);
});
