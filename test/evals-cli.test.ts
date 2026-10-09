import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createRunControl } from '../scripts/evals/run';
import { main } from '../scripts/evals/main';
import { evalManifest } from './helpers/evals';
test('session reservation is consumed before failed spawn and stops new work only when a new reservation is denied', () => {
  const control = createRunControl(
    { ...evalManifest.budget, maxInvocations: 1 },
    new AbortController().signal,
  );
  try {
    expect(control.reserveInvocation()).toBe(true);
    expect(control.invocations).toBe(1);
    expect(control.stopReason()).toBeNull();
    expect(control.reserveInvocation()).toBe(false);
    expect(control.stopReason()).toBe('budget_exhausted');
    expect(control.signal.aborted).toBe(true);
  } finally {
    control.dispose();
  }
});
test('total deadline and external cancellation propagate to active work', async () => {
  const timer = createRunControl(
    { ...evalManifest.budget, totalTimeoutMs: 10 },
    new AbortController().signal,
  );
  await Bun.sleep(20);
  expect(timer.stopReason()).toBe('budget_exhausted');
  timer.dispose();
  const abort = new AbortController();
  const cancelled = createRunControl(evalManifest.budget, abort.signal);
  abort.abort();
  expect(cancelled.stopReason()).toBe('cancelled');
  expect(cancelled.signal.aborted).toBe(true);
  cancelled.dispose();
});

test('SIGINT aborts active CLI work, returns 130 and removes handlers', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const root = await mkdtemp(join(tmpdir(), 'eval-signal-'));
  const config = join(root, 'manifest.json');
  const listeners = process.listenerCount('SIGINT');
  await writeFile(config, JSON.stringify(evalManifest));
  try {
    const code = await main(['--config', config, '--out', join(root, 'out')], {
      run: async (_manifest, options) => {
        queueMicrotask(() => process.emit('SIGINT'));
        await new Promise<void>((resolve) =>
          options.signal.addEventListener('abort', () => resolve(), {
            once: true,
          }),
        );
        expect(options.signal.aborted).toBe(true);
        throw Error('offline interrupted');
      },
    });
    expect(code).toBe(130);
    expect(process.listenerCount('SIGINT')).toBe(listeners);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('CLI rejects invalid args, missing budget and real profiles without opt-in before any native execution', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const root = await mkdtemp(join(tmpdir(), 'eval-cli-'));
  try {
    expect(await main([])).toBe(2);
    const config = join(root, 'config.json');
    await writeFile(
      config,
      JSON.stringify({ ...evalManifest, budget: undefined }),
    );
    expect(
      await main(['--config', config, '--out', join(root, 'report')]),
    ).toBe(2);
    await writeFile(
      config,
      JSON.stringify({
        ...evalManifest,
        configurations: [
          { ...evalManifest.configurations[0]!, adapter: 'codex-cli' },
        ],
      }),
    );
    expect(
      await main(['--config', config, '--out', join(root, 'report')]),
    ).toBe(2);
    let dispatched = 0;
    expect(
      await main(
        ['--config', config, '--out', join(root, 'report'), '--real'],
        {
          run: async () => {
            dispatched++;
            throw Error('must not dispatch');
          },
        },
      ),
    ).toBe(2);
    expect(dispatched).toBe(0);
    const { runEvaluation } = await import('../scripts/evals/run');
    const rejected = await runEvaluation(
      JSON.parse(await Bun.file(config).text()),
      {
        real: true,
        outDir: join(root, 'report'),
        signal: new AbortController().signal,
      },
    ).catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(Error);
    expect(String(rejected)).toContain('trusted');
    expect(
      await main(
        [
          '--config',
          config,
          '--out',
          join(root, 'report'),
          '--real',
          '--trusted-source',
        ],
        {
          run: async (_manifest, options) => {
            expect(options.trustedSource).toBe(true);
            dispatched++;
            throw Error('offline dispatch seam');
          },
        },
      ),
    ).toBe(1);
    expect(dispatched).toBe(1);
    expect(await Bun.file(join(root, 'report/report.json')).exists()).toBe(
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('offline integrated run stops after one reservation, preserves evidence and original hashes, and leaves origin unchanged', async () => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { frozenSource } = await import('./helpers/evals');
  const { runEvaluation } = await import('../scripts/evals/run');
  const { createScriptedAdapter } =
    await import('../scripts/evals/adapters/scripted');
  const { fingerprintOrigin } = await import('../scripts/evals/isolation');
  const fixture = await frozenSource();
  const root = await mkdtemp(join(tmpdir(), 'eval-integrated-'));
  const sourceRoot = fixture.source.originRoot;
  const before = await fingerprintOrigin(sourceRoot);
  try {
    const report = await runEvaluation(
      {
        ...evalManifest,
        budget: { ...evalManifest.budget, maxInvocations: 1 },
      },
      {
        sourceRoot,
        outDir: join(root, 'run'),
        real: false,
        signal: new AbortController().signal,
        adapters: new Map([
          [
            'scripted',
            createScriptedAdapter([
              { finalText: '{"type":"exact","value":"wrong"}' },
            ]),
          ],
        ]),
      },
    );
    expect(report.status).toBe('budget_exhausted');
    expect(report.invocations).toBe(1);
    expect(report.cases.map((c) => c.verdict)).toEqual([
      'incorrect',
      'not_run',
      'not_run',
      'not_run',
      'not_run',
    ]);
    expect(
      report.benchmarks[0]?.items.every(
        (i) => i.specHash?.length === 64 && i.state === 'not_run',
      ),
    ).toBe(true);
    expect(
      report.cases[0]?.execution?.evidence.every((p) => !p.startsWith('/')),
    ).toBe(true);
    expect(await fingerprintOrigin(sourceRoot)).toBe(before);
    expect(report.provenance.originAfter.status).toBe('available');
    expect(
      JSON.parse(await readFile(join(root, 'run/report.json'), 'utf8')).metrics
        .skills[0].accuracy.denominator,
    ).toBe(1);
  } finally {
    await fixture.cleanup();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
