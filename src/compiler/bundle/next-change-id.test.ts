import { describe, expect, test } from 'bun:test';
import { nextChangeId } from './index';

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
