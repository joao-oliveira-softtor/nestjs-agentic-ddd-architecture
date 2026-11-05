import { afterAll, expect, test as bunTest } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createScriptedAdapter } from '../scripts/evals/adapters/scripted';
import {
  implementationReplySchema,
  type PreparedSource,
} from '../scripts/evals/contracts';
import {
  bundleRunSchema,
  offlineEnv,
  summarizeBundleRun,
  type BundleItemRun,
  type BundleRun,
} from '../scripts/evals/bundle-rehearsal';
import { parseFinalReport } from '../scripts/evals/final-verification';
import {
  createAttemptWorkspace,
  fingerprintOrigin,
} from '../scripts/evals/isolation';
import { implementShopItem } from '../scripts/evals/solutions/shop';
import { PROPOSAL, applyFixture, cloneAt } from './helpers/apply-fixture';

/**
 * Offline rehearsal of the bundle measurement (#122, ADR-0007 D14): propose, apply, implement with the
 * scripted adapter, verify. No model is called. What it checks about isolation: the `agentic` children get
 * `offlineEnv`, and the sandboxed executor process has an empty environment and loopback only. What it does
 * not check: each item's code is written by the adapter's `before` callback here in the test process (full
 * environment, network, outside the sandbox) from a fixed solution, not from the packet, and the harness's own
 * git and tar helpers inherit this process's environment.
 */
const ROOT = resolve(import.meta.dir, '..');
const CLI = join(ROOT, 'src/cli/main.ts');
const SECRETS = {
  ANTHROPIC_API_KEY: 'sk-ant-offline-sentinel',
  CLAUDE_CODE_OAUTH_TOKEN: 'oauth-offline-sentinel',
  OPENAI_API_KEY: 'sk-openai-offline-sentinel',
};
// What the Delta of the fixture adds and changes: `verify NNNN` refuses a proposal that declares less.
const EMPTY_DELTA = 'delta:\n  added: []\n  modified: []\n  removed: []';
const DELTA = [
  'delta:',
  '  added:',
  '    - event:OrderRefunded',
  '    - invariant:Order/paid-once',
  '    - invariant:Order/refund-needs-paid',
  '    - method:Order.refund',
  '  modified:',
  '    - usecase:pay_order',
  '  removed: []',
].join('\n');
// The scripted adapter sandboxes its child with bubblewrap, which only exists on Linux.
const sandboxed = process.platform === 'linux' && Boolean(Bun.which('bwrap'));
const cleanup: string[] = [];
afterAll(async () => {
  for (const d of cleanup) await rm(d, { recursive: true, force: true });
});

const agentic = (cwd: string, ...args: string[]) => {
  const run = Bun.spawnSync([process.execPath, '--no-install', CLI, ...args], {
    cwd,
    env: offlineEnv(process.env),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    code: run.exitCode,
    out: run.stdout.toString(),
    err: run.stderr.toString(),
  };
};

/** The JSON a command printed; a command that printed none fails with its stderr. */
const json = (r: { out: string; err: string }) => {
  if (!r.out) throw new Error(`no JSON on stdout; stderr: ${r.err}`);
  return JSON.parse(r.out);
};

const run = (
  item: string,
  outcomes: Array<[string, boolean]>,
): BundleItemRun => ({
  item,
  specHash: 'a'.repeat(64),
  attempts: outcomes.map(([transport, accepted], i) => ({
    number: i + 1,
    transport: transport as 'finished' | 'timeout',
    accepted,
  })),
});
const ORIGIN = 'b'.repeat(64);
const runOf = (
  items: BundleItemRun[],
  over: Partial<BundleRun> = {},
): BundleRun => ({
  configuration: 'b0-rehearsal',
  repetition: 1,
  bundleHash: 'c'.repeat(64),
  baseRef: 'main',
  plannedItems: items.length,
  originBefore: ORIGIN,
  originAfter: ORIGIN,
  items,
  finalVerification: { change: '0001', title: 't', status: 'done', gates: [] },
  ...over,
});

bunTest(
  'summary counts initial and final acceptance, corrections and timeouts like the aggregate',
  () => {
    const items = [
      run('entity:A', [['finished', true]]),
      run('entity:B', [
        ['finished', false],
        ['finished', true],
      ]),
      run('entity:C', [
        ['timeout', false],
        ['timeout', false],
      ]),
    ];
    const s = summarizeBundleRun(runOf(items, { plannedItems: 3 }));
    expect(s.initial).toMatchObject({ numerator: 1, denominator: 3 });
    expect(s.final).toMatchObject({ numerator: 2, denominator: 3 });
    expect([s.corrections, s.timeouts, s.certifiedRuns]).toEqual([2, 2, 0]);
  },
);

bunTest(
  'a run that stops early is counted over the planned items and is never certified',
  () => {
    const s = summarizeBundleRun(
      runOf([run('entity:A', [['finished', true]])], { plannedItems: 4 }),
    );
    expect(s.initial).toMatchObject({ numerator: 1, denominator: 4 });
    expect(s.final).toMatchObject({ numerator: 1, denominator: 4 });
    expect(s.certifiedRuns).toBe(0);
  },
);

bunTest(
  'a run is certified only with every item accepted, verify done and the origin unchanged',
  () => {
    const items = [
      run('entity:A', [['finished', true]]),
      run('entity:B', [
        ['finished', false],
        ['finished', true],
      ]),
    ];
    expect(summarizeBundleRun(runOf(items)).certifiedRuns).toBe(1);
    const failed = runOf(items, {
      finalVerification: {
        ...runOf(items).finalVerification,
        status: 'failed',
      },
    });
    expect(summarizeBundleRun(failed).certifiedRuns).toBe(0);
    const moved = runOf(items, { originAfter: 'd'.repeat(64) });
    expect(summarizeBundleRun(moved).certifiedRuns).toBe(0);
    const unaccepted = runOf([
      ...items,
      run('entity:C', [['finished', false]]),
    ]);
    expect(summarizeBundleRun(unaccepted).certifiedRuns).toBe(0);
  },
);

bunTest(
  'the record has no item state of its own: acceptance comes from the attempts',
  () => {
    const item = run('entity:A', [['finished', false]]);
    expect(
      bundleRunSchema.safeParse(
        runOf([{ ...item, state: 'accepted' } as never]),
      ).success,
    ).toBe(false);
    expect(
      bundleRunSchema.safeParse(runOf([item], { plannedItems: 0 })).success,
    ).toBe(false);
    expect(
      bundleRunSchema.safeParse(runOf([item, item], { plannedItems: 1 }))
        .success,
    ).toBe(false);
  },
);

bunTest(
  'the offline environment drops every credential and keeps the rest',
  () => {
    const env = offlineEnv({
      ...SECRETS,
      PATH: '/usr/bin',
      HOME: '/h',
      GITHUB_TOKEN: 'x',
      MY_API_KEY: 'y',
    });
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/h' });
  },
);

// shortcut: measured 22 to 46 s on the native filesystem of WSL2 (compile, apply, 4 scripted runs, 9
// verifies); 120 s is a margin for CI, and a checkout on a Windows mount took minutes. Bun 1.4.4 ignores
// `[test] timeout` in bunfig.toml, so the 5 s default is overridden here.
bunTest.skipIf(!sandboxed)(
  'a bundle goes from propose to done with scripted executors, offline',
  async () => {
    const saved = { ...process.env };
    Object.assign(process.env, SECRETS);
    try {
      const fx = await applyFixture({
        slug: PROPOSAL.slug,
        markdown: PROPOSAL.markdown.replace(EMPTY_DELTA, DELTA),
      });
      const target = await cloneAt(fx.repo.root, fx.ref);
      const sandboxRoot = await mkdtemp(join(ROOT, '.tmp', 'rehearsal-'));
      cleanup.push(fx.repo.root, fx.dir, target, sandboxRoot);

      const applied = agentic(target, 'apply', fx.dir, '--yes');
      expect(applied.err).toBe('');
      expect(applied.code).toBe(0);
      // The fixture project has no package.json, so it gets the typecheck the tutorials use: the framework's
      // tsc over the module only. It has no lint command, so G5 has no lint to run (a real project has both).
      const tsconfig = JSON.parse(
        await Bun.file(join(target, 'tsconfig.json')).text(),
      );
      Object.assign(tsconfig.compilerOptions, {
        module: 'preserve',
        moduleResolution: 'bundler',
        target: 'ES2023',
        strict: true,
        strictPropertyInitialization: false,
        skipLibCheck: true,
        noEmit: true,
        types: ['bun'],
      });
      tsconfig.include = ['src/shop'];
      await Bun.write(join(target, 'tsconfig.json'), JSON.stringify(tsconfig));
      await Bun.write(
        join(target, 'agentic.config.ts'),
        `import { defineConfig } from '@agentic-ddd/compiler';
export default defineConfig({ mirrors: [], modules: [{ name: 'shop', path: 'src/shop' }], verify: { test: ['bun', 'test'], commands: { typecheck: ['bun', ${JSON.stringify(join(ROOT, 'node_modules/typescript/bin/tsc'))}, '--noEmit', '--project', 'tsconfig.json'] } } });
`,
      );

      // The executors work on a copy of the applied project, as the harness gives them.
      const originBefore = await fingerprintOrigin(target);
      const workspace = await createAttemptWorkspace(
        {
          originRoot: target,
          commit: fx.ref,
          runnerCommit: fx.ref,
          fingerprint: originBefore,
          root: sandboxRoot,
          snapshotRoot: target,
          frameworkRoot: ROOT,
        } satisfies PreparedSource,
        target,
        'implementation',
      );
      const waves = json(agentic(workspace.root, 'next', '--json'))
        .waves as string[][];
      const order = waves.flat();
      // The wave order is the bundle's, plus the base item the new use-case depends on.
      expect(order).toEqual([
        'entity:Order',
        'method:Order.pay',
        'method:Order.refund',
        'usecase:pay_order',
      ]);

      const probe = `console.log(JSON.stringify({ env: Object.keys(process.env), nics: Object.keys(require('node:os').networkInterfaces()) }))`;
      const adapter = createScriptedAdapter([
        { argv: [process.execPath, '-e', probe] },
        ...order.map(() => ({
          finalText: '{"status":"done","summary":"scripted"}',
          // The solution is fixed per item; the prompt is the packet and is not what drives the edit.
          before: async (r: { cwd: string; id: string }) =>
            implementShopItem(r.cwd, r.id),
        })),
      ]);
      const signal = new AbortController().signal;
      const request = async (id: string, prompt: string) => {
        const evidenceDir = join(
          sandboxRoot,
          'evidence',
          id.replaceAll(/\W/g, '-'),
        );
        await mkdir(evidenceDir, { recursive: true });
        return {
          id,
          mode: 'implementation' as const,
          cwd: workspace.root,
          prompt,
          timeoutMs: 60_000,
          evidenceDir,
        };
      };

      // No network and no credential reaches the executor: its process has loopback only and an empty env.
      const sandbox = JSON.parse(
        (await adapter.run(await request('probe', ''), { signal })).finalText!,
      );
      expect(
        sandbox.env.filter((k: string) => /KEY|TOKEN|SECRET/i.test(k)),
      ).toEqual([]);
      expect(sandbox.nics.filter((n: string) => n !== 'lo')).toEqual([]);

      const bundled = new Map(
        fx.bundle.manifest.layers.target.items.map((i) => [i.id, i.specHash]),
      );
      const items: BundleItemRun[] = [];
      for (const id of order) {
        const packet = agentic(workspace.root, 'packet', id);
        expect(packet.code).toBe(0);
        const specHash = /specHash: `([a-f0-9]{64})`/.exec(packet.out)![1]!;
        if (bundled.has(id)) expect(specHash).toBe(bundled.get(id)!);
        const verify = (): 'done' | 'failed' => {
          const r = agentic(
            workspace.root,
            'verify',
            '--item',
            id,
            '--spec-hash',
            specHash,
            '--json',
          );
          // With no test file at all, verify cannot collect a JUnit report and prints no JSON.
          if (!r.out && r.err.includes('[verify.collection-error]'))
            return 'failed';
          return json(r).status;
        };
        // The skeleton must not already pass: otherwise `done` would prove nothing.
        expect(verify()).toBe('failed');
        const result = await adapter.run(await request(id, packet.out), {
          signal,
        });
        implementationReplySchema.parse(JSON.parse(result.finalText!));
        const accepted = verify() === 'done';
        items.push({
          item: id,
          specHash,
          attempts: [
            { number: 1, transport: result.transport as 'finished', accepted },
          ],
        });
      }

      // The generated files (the module dev skill carries source lines) follow the new bodies.
      expect(agentic(workspace.root, 'compile').code).toBe(0);
      const final = agentic(workspace.root, 'verify', '0001', '--json');
      if (final.code !== 0)
        throw new Error(`verify 0001 exited ${final.code}:\n${final.err}`);
      const finalVerification = json(final);
      expect(parseFinalReport(finalVerification)?.status).toBe('done');

      const record = bundleRunSchema.parse({
        configuration: 'b0-rehearsal',
        repetition: 1,
        bundleHash: fx.bundle.manifest.hash,
        baseRef: fx.ref,
        plannedItems: order.length,
        originBefore,
        originAfter: await fingerprintOrigin(target),
        items,
        finalVerification,
      });
      expect(record.items.map((i) => i.item)).toEqual(order);
      const summary = summarizeBundleRun(record);
      expect(summary.initial).toMatchObject({ numerator: 4, denominator: 4 });
      expect(summary.final).toMatchObject({ numerator: 4, denominator: 4 });
      expect([
        summary.corrections,
        summary.certifiedRuns,
        summary.timeouts,
      ]).toEqual([0, 1, 0]);
      expect(JSON.stringify(record)).not.toContain('sentinel');
    } finally {
      for (const k of Object.keys(SECRETS)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  },
  120_000,
);
