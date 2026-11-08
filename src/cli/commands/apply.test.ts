import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { applyCommand, applyRequest } from './apply';

describe('applyCommand', () => {
  afterEach(() => mock.restore());

  test('applies the request and reports the change and the file count with exit 0', async () => {
    const log = spyOn(console, 'log').mockImplementation(() => {});
    const calls: unknown[] = [];
    const code = await applyCommand(['./bundle', '--yes'], async (options) => {
      calls.push(options);
      return { change: '0001-x', written: ['a', 'b'] };
    });
    expect(code).toBe(0);
    expect(calls).toEqual([
      { bundleDir: './bundle', projectRoot: process.cwd(), yes: true },
    ]);
    expect(log).toHaveBeenCalledWith(
      'agentic-ddd: bundle applied as change 0001-x, 2 file(s) written and compiled',
    );
  });

  test('wrong arguments print the message and the usage on stderr, exit 2 and apply nothing', async () => {
    const error = spyOn(console, 'error').mockImplementation(() => {});
    let applied = false;
    const code = await applyCommand([], async () => {
      applied = true;
      return { change: '', written: [] };
    });
    expect(code).toBe(2);
    expect(applied).toBe(false);
    expect(error.mock.calls[0]![0]).toContain('[cli.argument-count]');
  });
});

describe('applyRequest', () => {
  test('takes the bundle directory and defaults the project to the current directory, without confirmation', () => {
    expect(applyRequest(['./bundle'], '/work')).toEqual({
      bundleDir: './bundle',
      projectRoot: '/work',
      yes: false,
    });
  });

  test('--yes confirms and --root names the project', () => {
    expect(
      applyRequest(['--yes', './bundle', '--root', '/other'], '/work'),
    ).toEqual({ bundleDir: './bundle', projectRoot: '/other', yes: true });
  });

  test.each([
    [[], 'cli.argument-count'],
    [['a', 'b'], 'cli.argument-count'],
    [['a', '--force'], 'cli.option-unknown'],
    [['a', '--root'], 'cli.option-value-required'],
  ])('answers %p with the coded message and the usage', (args, code) => {
    const message = applyRequest(args, '/work');
    expect(message).toBeString();
    expect(message).toContain(`[${code}]`);
    expect(message).toContain('usage:');
    expect(message).toContain('agentic-ddd apply <bundle-dir>');
  });
});
