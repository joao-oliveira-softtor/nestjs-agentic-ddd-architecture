import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shopRepo } from '../../../test/helpers/shop-repo';
import { bundleAnalysisArgs, bundleAnalysisCommand } from './bundleAnalysis';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

describe('bundleAnalysisCommand', () => {
  test('prints the analysis as JSON and exits 0', async () => {
    const repo = await shopRepo(undefined, 'analysis-cmd-');
    dirs.push(repo.root);
    const scratch = await mkdtemp(join(tmpdir(), 'analysis-cmd-base-'));
    dirs.push(scratch);
    const lock = join(scratch, 'base.json');
    await cp(join(repo.root, '.agentic/domain.lock.json'), lock);
    const write = spyOn(process.stdout, 'write').mockImplementation(() => true);
    let code: number;
    let printed: string;
    try {
      code = await bundleAnalysisCommand([
        '--config',
        join(repo.root, 'agentic.config.ts'),
        '--base-lock',
        lock,
      ]);
    } finally {
      printed = write.mock.calls.map((c) => String(c[0])).join('');
      write.mockRestore();
    }
    expect(code).toBe(0);
    // The candidate equals the base, so nothing is listed.
    expect(printed).toBe('{"waves":[],"items":[]}');
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
  test('takes the config and the base lock', () => {
    expect(
      bundleAnalysisArgs(['--config', 'a.config.ts', '--base-lock', 'b.json']),
    ).toEqual({ config: 'a.config.ts', baseLock: 'b.json' });
  });

  test('the config defaults to agentic.config.ts', () => {
    expect(bundleAnalysisArgs(['--base-lock', 'b.json'])).toEqual({
      config: 'agentic.config.ts',
      baseLock: 'b.json',
    });
  });

  test('refuses a call without the base lock', () => {
    expect(bundleAnalysisArgs(['--config', 'a.config.ts'])).toEqual({
      error: 'missing --base-lock',
    });
  });

  test('refuses what the argument parser refuses, with its coded message', () => {
    expect(bundleAnalysisArgs(['--base-lock'])).toEqual({
      error: '--base-lock requires a value [cli.option-value-required]',
    });
    expect(bundleAnalysisArgs(['--base-lock', 'b.json', '--x'])).toEqual({
      error: 'unknown option: --x [cli.option-unknown]',
    });
    expect(bundleAnalysisArgs(['--base-lock', 'b.json', 'extra'])).toEqual({
      error: 'expected 0 argument(s), received 1 [cli.argument-count]',
    });
  });
});
