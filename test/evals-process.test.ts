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
