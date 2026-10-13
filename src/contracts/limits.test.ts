import { describe, expect, test } from 'bun:test';
import { limitsError } from './limits';

describe('limitsError', () => {
  test('aceita maxSteps inteiro positivo e timeoutMs finito positivo', () => {
    expect(limitsError({ maxSteps: 1, timeoutMs: 1 })).toBeNull();
    expect(limitsError({ maxSteps: 10, timeoutMs: 30_000.5 })).toBeNull();
  });

  test('rejeita maxSteps zero, negativo, fracionário ou não finito', () => {
    for (const maxSteps of [0, -1, 1.5, Number.NaN, Infinity]) {
      expect(limitsError({ maxSteps, timeoutMs: 1000 })).toContain('maxSteps');
    }
  });

  test('rejeita timeoutMs zero, negativo ou não finito', () => {
    for (const timeoutMs of [0, -1, Number.NaN, Infinity]) {
      expect(limitsError({ maxSteps: 3, timeoutMs })).toContain('timeoutMs');
    }
  });
});
