import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess, OUTPUT_LIMIT_BYTES } from '../scripts/evals/process';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function run(
  code: string,
  timeoutMs = 3000,
  signal = new AbortController().signal,
) {
  const root = await mkdtemp(join(tmpdir(), 'eval-process-'));
  roots.push(root);
  return runProcess(
    {
      argv: [process.execPath, '-e', code],
      cwd: root,
      env: { PATH: process.env.PATH ?? '' },
      timeoutMs,
      evidenceDir: join(root, 'evidence'),
      secrets: ['test-secret-value'],
    },
    { signal },
  );
}
test('supervisor preserves successful and nonzero completion with redacted evidence', async () => {
  const success = await run(
    'console.log("test-secret-value"); console.error("diagnostic")',
  );
  expect(success.transport).toBe('finished');
  expect(success.exitCode).toBe(0);
  expect(success.stdout).toBe('[REDACTED]\n');
  expect(success.stderr).toBe('diagnostic\n');
  expect(await readFile(success.evidence[0]!, 'utf8')).toBe(success.stdout);
  const failed = await run('process.exit(1)');
  expect(failed.transport).toBe('finished');
  expect(failed.exitCode).toBe(1);
});
test('missing executable is infrastructure and leaves evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-missing-'));
  roots.push(root);
  const result = await runProcess(
    {
      argv: ['/missing-eval-executable'],
      cwd: root,
      env: {},
      timeoutMs: 100,
      evidenceDir: join(root, 'evidence'),
    },
    { signal: new AbortController().signal },
  );
  expect(result.transport).toBe('infra_error');
  expect(result.diagnostic).toContain('spawn');
  expect(result.evidence.length).toBe(3);
});

test('late credential collection precedes evidence persistence on success, timeout and cancellation; failure withholds streams and argv', async () => {
  for (const mode of [
    'success',
    'timeout',
    'cancelled',
    'collector-error',
  ] as const) {
    const root = await mkdtemp(join(tmpdir(), 'eval-late-secret-'));
    roots.push(root);
    const secret = 'offline-late-rotated-credential';
    const controller = new AbortController();
    let calls = 0;
    const timer =
      mode === 'cancelled'
        ? setTimeout(() => controller.abort(), 100)
        : undefined;
    try {
      const result = await runProcess(
        {
          argv: [
            process.execPath,
            '-e',
            `console.error('${secret}');${mode === 'timeout' || mode === 'cancelled' ? 'setInterval(()=>{},1000)' : ''}`,
          ],
          cwd: root,
          env: {},
          timeoutMs: mode === 'timeout' ? 100 : 3000,
          evidenceDir: join(root, 'evidence'),
          collectSecrets: async () => {
            calls++;
            if (mode === 'collector-error')
              throw Error('private auth unavailable');
            return [secret];
          },
        },
        { signal: controller.signal },
      );
      expect(calls).toBe(1);
      expect(result.transport).toBe(
        mode === 'success'
          ? 'finished'
          : mode === 'collector-error'
            ? 'infra_error'
            : mode,
      );
      for (const path of result.evidence)
        expect(await readFile(path, 'utf8')).not.toContain(secret);
      if (mode === 'collector-error') {
        expect(result.stderr).toBe('');
        expect(result.diagnostic).toContain('streams withheld');
      } else expect(result.stderr).toContain('[REDACTED]');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
});
test('timeout and cancellation terminate resistant descendant processes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-descendants-'));
  roots.push(root);
  const pidFile = join(root, 'pid');
  const childCode = 'process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)';
  const parent = `const p=Bun.spawn([process.execPath,'-e',${JSON.stringify(childCode)}],{stdout:'inherit',stderr:'inherit'}); await Bun.write(${JSON.stringify(pidFile)},String(p.pid)); setInterval(()=>{},1000)`;
  const result = await run(parent, 300);
  expect(result.transport).toBe('timeout');
  const pid = Number(await readFile(pidFile, 'utf8'));
  // A dead zombie is harmless; an executing descendant is not.
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '');
  expect(stat === '' || stat.split(' ')[2] === 'Z').toBe(true);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  expect(
    (await run('setInterval(()=>{},1000)', 3000, controller.signal)).transport,
  ).toBe('cancelled');
});
test('drains both streams and enforces a combined eight MiB limit', async () => {
  const large = await run(
    'const s="x".repeat(100000); for(let i=0;i<8;i++){process.stdout.write(s);process.stderr.write(s)}',
  );
  expect(large.transport).toBe('finished');
  expect(large.stdout.length + large.stderr.length).toBe(1600000);
  const excessive = await run(
    'const s="x".repeat(100000); for(let i=0;i<100;i++){process.stdout.write(s);process.stderr.write(s)}',
  );
  expect(excessive.transport).toBe('infra_error');
  expect(excessive.diagnostic).toBe('output_limit');
  expect(
    Buffer.byteLength(excessive.stdout) + Buffer.byteLength(excessive.stderr),
  ).toBe(OUTPUT_LIMIT_BYTES);
});
test('successful parent cannot leave a background child holding its pipes', async () => {
  const result = await run(
    'Bun.spawn([process.execPath,"-e","setInterval(()=>{},1000)"],{stdout:"inherit",stderr:"inherit"}); process.exit(0)',
    1000,
  );
  expect(result.transport).toBe('finished');
  expect(result.exitCode).toBe(0);
});

test('reaching the combined output cap is infrastructure; one byte below remains complete', async () => {
  for (const size of [OUTPUT_LIMIT_BYTES - 1, OUTPUT_LIMIT_BYTES]) {
    const result = await run(
      `await Bun.write(Bun.stdout, Buffer.alloc(${Math.floor(size / 2)}, 120)); await Bun.write(Bun.stderr, Buffer.alloc(${size - Math.floor(size / 2)}, 121));`,
    );
    expect(
      Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr),
    ).toBe(size);
    expect(result.transport).toBe(
      size === OUTPUT_LIMIT_BYTES ? 'infra_error' : 'finished',
    );
    expect(result.diagnostic).toBe(
      size === OUTPUT_LIMIT_BYTES ? 'output_limit' : null,
    );
  }
});
