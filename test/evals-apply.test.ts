import { afterAll, beforeAll, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { applyBundle } from '../src/compiler/bundle/apply';
import { applyFixture, cloneAt } from './helpers/apply-fixture';

const CLI = resolve(import.meta.dir, '../src/cli/main.ts');
const cleanup: string[] = [];
afterAll(async () => {
  for (const d of cleanup) await rm(d, { recursive: true, force: true });
});

let fx: Awaited<ReturnType<typeof applyFixture>>;
beforeAll(async () => {
  fx = await applyFixture();
  cleanup.push(fx.repo.root, fx.dir);
}, 240_000);

const agentic = (cwd: string, ...args: string[]) => {
  const run = Bun.spawnSync([process.execPath, '--no-install', CLI, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    code: run.exitCode,
    out: run.stdout.toString(),
    err: run.stderr.toString(),
  };
};

test('after apply, packet and verify --item work on every new item with the bundled specHash', async () => {
  const target = await cloneAt(fx.repo.root, fx.ref);
  cleanup.push(target);
  await applyBundle({ bundleDir: fx.dir, projectRoot: target });
  // `verify` needs at least one test to collect a JUnit report.
  await Bun.write(
    join(target, 'src/shop/smoke.test.ts'),
    ["import { test } from 'bun:test';", "test('smoke', () => {});", ''].join(
      '\n',
    ),
  );
  const { items } = fx.bundle.manifest.layers.target;
  expect(items.length).toBeGreaterThan(0);
  for (const item of items) {
    const packet = agentic(target, 'packet', item.id);
    expect(packet.code).toBe(0);
    expect(packet.out).toContain(`- specHash: \`${item.specHash}\``);
    const verified = agentic(
      target,
      'verify',
      '--item',
      item.id,
      '--spec-hash',
      item.specHash,
      '--json',
    );
    // The skeleton is not implemented yet, so the status is not `done`; the hash was accepted.
    expect(JSON.parse(verified.out).item).toBe(item.id);
    expect(verified.err).not.toContain('spec-hash');
  }
}, 300_000);

test('agentic apply <bundle-dir> applies the bundle from the CLI', async () => {
  const target = await cloneAt(fx.repo.root, fx.ref);
  cleanup.push(target);
  const run = agentic(target, 'apply', fx.dir);
  expect(run.err).toBe('');
  expect(run.code).toBe(0);
  expect(run.out).toContain('0001-refund-paid-order');
}, 120_000);
