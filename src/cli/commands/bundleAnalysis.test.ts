import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shopRepo } from '../../../test/helpers/shop-repo';
import { bundleAnalysisArgs, bundleAnalysisCommand } from './bundleAnalysis';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

describe('bundleAnalysisCommand', () => {
  test('writes the analysis as JSON to --out and exits 0, printing nothing', async () => {
    const repo = await shopRepo(undefined, 'analysis-cmd-');
    dirs.push(repo.root);
    const scratch = await mkdtemp(join(tmpdir(), 'analysis-cmd-base-'));
    dirs.push(scratch);
    const lock = join(scratch, 'base.json');
    await cp(join(repo.root, '.agentic/domain.lock.json'), lock);
    const out = join(scratch, 'analysis.json');
    const write = spyOn(process.stdout, 'write').mockImplementation(() => true);
    let code: number;
    let printed: string;
    try {
      code = await bundleAnalysisCommand([
        '--config',
        join(repo.root, 'agentic.config.ts'),
        '--base-lock',
        lock,
        '--module',
        'shop',
        '--out',
        out,
      ]);
    } finally {
      printed = write.mock.calls.map((c) => String(c[0])).join('');
      write.mockRestore();
    }
    expect(code).toBe(0);
    expect(printed).toBe('');
    // The candidate equals the base, so nothing is listed.
    expect(await readFile(out, 'utf8')).toBe('{"waves":[],"items":[]}');
  }, 60_000);

  test('exits 2 with the message and usage when the arguments are refused', async () => {
    const error = spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await bundleAnalysisCommand([])).toBe(2);
      expect(String(error.mock.calls[0]?.[0])).toStartWith(
        'missing --base-lock\n',
      );
    } finally {
      error.mockRestore();
    }
  });
});

describe('bundleAnalysisArgs', () => {
  const required = [
    '--base-lock',
    'b.json',
    '--module',
    'm',
    '--out',
    'o.json',
  ];

  test('takes the config, the base lock, the module and the output file', () => {
    expect(
      bundleAnalysisArgs(['--config', 'a.config.ts', ...required]),
    ).toEqual({
      config: 'a.config.ts',
      baseLock: 'b.json',
      module: 'm',
      out: 'o.json',
    });
  });

  test('the config defaults to agentic.config.ts', () => {
    expect(bundleAnalysisArgs(required)).toMatchObject({
      config: 'agentic.config.ts',
    });
  });

  test.each([
    ['--base-lock', 'missing --base-lock'],
    ['--module', 'missing --module'],
    ['--out', 'missing --out'],
  ])('refuses a call without %s', (flag, error) => {
    const at = required.indexOf(flag);
    expect(
      bundleAnalysisArgs(required.filter((_, i) => i !== at && i !== at + 1)),
    ).toEqual({ error });
  });

  test('refuses what the argument parser refuses, with its coded message', () => {
    expect(bundleAnalysisArgs(['--base-lock'])).toEqual({
      error: '--base-lock requires a value [cli.option-value-required]',
    });
    expect(bundleAnalysisArgs([...required, '--x'])).toEqual({
      error: 'unknown option: --x [cli.option-unknown]',
    });
    expect(bundleAnalysisArgs([...required, 'extra'])).toEqual({
      error: 'expected 0 argument(s), received 1 [cli.argument-count]',
    });
  });
});
