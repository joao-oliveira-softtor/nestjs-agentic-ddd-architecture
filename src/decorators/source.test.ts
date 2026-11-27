import { describe, expect, test } from 'bun:test';
import { CANONICAL_LIMIT, remember } from './source';

describe('remember', () => {
  test('clears the cache once it passes the limit', () => {
    const cache = new Map<string, string>();
    for (let i = 0; i <= CANONICAL_LIMIT; i++) remember(cache, `k${i}`, 'v');
    expect(cache.size).toBe(1);
    expect(cache.get(`k${CANONICAL_LIMIT}`)).toBe('v');
  });
});
