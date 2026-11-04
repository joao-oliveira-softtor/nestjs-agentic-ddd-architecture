import { describe, expect, spyOn, test } from 'bun:test';
import { bundleAnalysisArgs, bundleAnalysisCommand } from './bundleAnalysis';

describe('bundleAnalysisCommand', () => {
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
