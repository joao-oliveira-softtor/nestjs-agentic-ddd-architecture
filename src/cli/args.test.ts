import { describe, expect, test } from 'bun:test';
import { parseArgs } from './args';

const spec = { booleans: ['--check'], values: ['--config'], positionals: 1 };

describe('parseArgs', () => {
  test('separates flags, values and positionals', () => {
    const parsed = parseArgs(['0002', '--check', '--config', 'x.ts'], spec);
    expect(typeof parsed).toBe('object');
    if (typeof parsed === 'string') return;
    expect([...parsed.flags]).toEqual(['--check']);
    expect(parsed.values.get('--config')).toBe('x.ts');
    expect(parsed.positionals).toEqual(['0002']);
  });

  test('usage errors become messages with a code', () => {
    expect(parseArgs(['0002', '--nada'], spec)).toBe(
      'unknown option: --nada [cli.option-unknown]',
    );
    expect(parseArgs(['0002', '--config'], spec)).toBe(
      '--config requires a value [cli.option-value-required]',
    );
    expect(parseArgs([], spec)).toBe(
      'expected 1 argument(s), received 0 [cli.argument-count]',
    );
    expect(parseArgs(['a', 'b'], spec)).toBe(
      'expected 1 argument(s), received 2 [cli.argument-count]',
    );
  });
});
