import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configInRepo, inside, nextChangeId, parseAcceptance } from './index';

describe('nextChangeId', () => {
  test('the first change is 0001', () => {
    expect(nextChangeId([])).toBe('0001');
  });

  test('is one past the highest of the change ids and the changes/ entries', () => {
    expect(nextChangeId(['0001', '0003-earlier', '0002-x'])).toBe('0004');
    expect(nextChangeId(['0009'])).toBe('0010');
  });

  test('a bare NNNN counts; names that are not NNNN or NNNN-slug do not', () => {
    expect(nextChangeId(['0007'])).toBe('0008');
    const others = ['0007x', '12345-big', 'draft', '007-short', '.gitkeep'];
    expect(nextChangeId(others)).toBe('0001');
  });
});

describe('parseAcceptance', () => {
  const proposal = (delta = '  added: []', acceptance = 'acceptance: []') =>
    [
      '---',
      'id: "0007"',
      'title: Close a cart',
      'status: proposed',
      'origin: proposal-first',
      'delta:',
      delta,
      acceptance,
      '---',
      '',
      '## Motivo',
      '',
      'Shoppers close carts.',
      '',
    ].join('\n');
  const refusalOf = (markdown: string) => {
    try {
      parseAcceptance('0007', 'close-cart', markdown);
    } catch (error) {
      return error as { code?: string; message: string };
    }
    return undefined;
  };

  test('returns the acceptance criteria of the proposal', () => {
    const acceptance = [
      'acceptance:',
      '  - id: cart-closes',
      '    covers: ["entity:Cart"]',
      '    given: an open cart',
      '    when: the shopper closes it',
      '    then: it is closed',
    ].join('\n');
    expect(
      parseAcceptance('0007', 'close-cart', proposal(undefined, acceptance)),
    ).toEqual([
      {
        id: 'cart-closes',
        covers: ['entity:Cart'],
        given: 'an open cart',
        when: 'the shopper closes it',
        // eslint-disable-next-line unicorn/no-thenable
        then: 'it is closed',
        manual: false,
      },
    ]);
  });

  test('reads the proposal strictly: an unknown delta key is refused with its text', () => {
    const error = refusalOf(proposal('  added: []\n  renamed: []'));
    expect(error?.code).toBe('bundle.proposal-invalid');
    expect(error?.message).toContain('delta: unknown key');
    expect(error?.message).toContain('renamed');
  });

  test('refuses a delta that is not an object', () => {
    expect(refusalOf(proposal(' []'))?.code).toBe('bundle.proposal-invalid');
  });
});

describe('inside', () => {
  const base = join(tmpdir(), 'bundle-inside');
  const code = (rel: string): string | undefined => {
    try {
      inside(base, rel);
    } catch (error) {
      return (error as { code?: string }).code;
    }
  };

  test('resolves a path below the base', () => {
    expect(inside(base, 'a/b.ts')).toBe(join(base, 'a', 'b.ts'));
  });

  test('refuses the base itself and every way out of it', () => {
    for (const rel of ['', '.', '../x', 'a/../../x', join(tmpdir(), 'other')])
      expect(code(rel)).toBe('bundle.path-escape');
  });
});

describe('configInRepo', () => {
  const top = tmpdir();
  const code = (call: () => string): string | undefined => {
    try {
      call();
    } catch (error) {
      return (error as { code?: string }).code;
    }
  };

  test('maps the config of a project below the repository top, as in the worktree', () => {
    expect(configInRepo(top, join(top, 'apps', 'api'))).toBe(
      'apps/api/agentic.config.ts',
    );
    expect(configInRepo(top, top)).toBe('agentic.config.ts');
  });

  test('honors a config path, absolute or relative to the project', () => {
    const api = join(top, 'apps', 'api');
    expect(configInRepo(top, api, 'conf/x.config.ts')).toBe(
      'apps/api/conf/x.config.ts',
    );
    expect(configInRepo(top, api, join(api, 'y.config.ts'))).toBe(
      'apps/api/y.config.ts',
    );
  });

  test('refuses a config outside the repository', () => {
    expect(code(() => configInRepo(join(top, 'a'), join(top, 'b')))).toBe(
      'bundle.config-missing',
    );
  });
});
