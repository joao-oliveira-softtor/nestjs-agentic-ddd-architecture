import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  applyFixture,
  cloneAt,
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
  applyBundle({ bundleDir: fx.dir, projectRoot, ...extra });
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
    // compile ran: the module dev skill now describes the new skeleton
    const skill = '.agents/skills/shop-dev/SKILL.md';
    expect(after.get(skill)).not.toBe(
      await readFile(join(fx.repo.root, skill), 'latin1'),
    );
    await noTemp(t);
  }, 120_000);
});
