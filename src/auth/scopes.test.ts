import { describe, expect, test } from 'bun:test';
import { grants, moduleAccess } from './scopes';

const CAP = 'domain:read';

describe('moduleAccess', () => {
  const cases: [string, string[], 'all' | string[] | undefined][] = [
    ['empty input', [], undefined],
    ['no match', ['other', 'domain:write:orders'], undefined],
    ['the bare capability', [CAP], 'all'],
    ['one module', [`${CAP}:orders`], ['orders']],
    ['two modules', [`${CAP}:orders`, `${CAP}:billing`], ['orders', 'billing']],
    ['bare plus a module: the bare scope wins', [`${CAP}:orders`, CAP], 'all'],
    ['unrelated scopes around a module', ['x', `${CAP}:orders`], ['orders']],
    ['a longer capability name', [`${CAP}x`], undefined],
    ['an empty module', [`${CAP}:`], undefined],
    ['a nested module', [`${CAP}:a:b`], undefined],
    ['a prefixed capability', [`x${CAP}`, `other:${CAP}`], undefined],
    [
      'a malformed scope beside a valid one',
      [`${CAP}:a:b`, `${CAP}:ok`],
      ['ok'],
    ],
  ];

  test.each(cases)('%s', (_title, scopes, expected) => {
    const access = moduleAccess(scopes, CAP);
    if (expected === undefined || expected === 'all') {
      expect(access).toBe(expected);
    } else {
      expect(access).toEqual(new Set(expected));
    }
  });

  test('grants is true exactly when the access is defined', () => {
    expect(grants([CAP], CAP)).toBe(true);
    expect(grants([`${CAP}:orders`], CAP)).toBe(true);
    expect(grants([`${CAP}:`], CAP)).toBe(false);
    expect(grants([], CAP)).toBe(false);
  });
});
