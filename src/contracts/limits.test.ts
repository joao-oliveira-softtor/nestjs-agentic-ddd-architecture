import { describe, expect, test } from 'bun:test';
import { limitsError, timeoutError } from './limits';

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

  test('rejects timeoutMs above the setTimeout maximum and names it', () => {
    expect(limitsError({ maxSteps: 3, timeoutMs: 2_147_483_647 })).toBeNull();
    expect(limitsError({ maxSteps: 3, timeoutMs: 2_147_483_648 })).toContain(
      '2147483647',
    );
  });

  test('keeps its timeoutMs messages word for word', () => {
    expect(limitsError({ maxSteps: 3, timeoutMs: 0 })).toBe(
      'timeoutMs must be a finite positive number',
    );
    expect(limitsError({ maxSteps: 3, timeoutMs: 2_147_483_648 })).toBe(
      'timeoutMs must not exceed 2147483647 (the setTimeout maximum)',
    );
  });
});

describe('timeoutError', () => {
  test('applies the timeoutMs rule under the given name', () => {
    expect(timeoutError('useCaseTimeoutMs', 1)).toBeNull();
    expect(timeoutError('useCaseTimeoutMs', 2_147_483_647)).toBeNull();
    for (const ms of [0, -1, Number.NaN, Infinity])
      expect(timeoutError('useCaseTimeoutMs', ms)).toBe(
        'useCaseTimeoutMs must be a finite positive number',
      );
    expect(timeoutError('useCaseTimeoutMs', 2_147_483_648)).toBe(
      'useCaseTimeoutMs must not exceed 2147483647 (the setTimeout maximum)',
    );
  });
});
