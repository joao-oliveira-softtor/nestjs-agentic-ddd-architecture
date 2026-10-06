import { describe, expect, test } from 'bun:test';
import { activeRegistry, createRegistry, defaultRegistry, withRegistry } from '@agentic-ddd/decorators';
import { located } from '../../test/fixtures/located.js';

describe('captureSource', () => {
  test('aponta o arquivo e a linha de quem chamou', () => {
    expect(located.file.endsWith('/test/fixtures/located.ts')).toBe(true);
    expect(located.line).toBe(3);
  });
});

describe('registry', () => {
  test('withRegistry troca o registry ativo e restaura ao final', () => {
    const registry = createRegistry();
    expect(withRegistry(registry, () => activeRegistry())).toBe(registry);
    expect(activeRegistry()).toBe(defaultRegistry);
  });

  test('withRegistry restaura o registry mesmo quando a função lança', () => {
    const registry = createRegistry();
    expect(() =>
      withRegistry(registry, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(activeRegistry()).toBe(defaultRegistry);
  });

  test('reset esvazia todas as listas', () => {
    const registry = createRegistry();
    registry.entities.push({ target: class X {}, description: 'x', states: [], source: { file: '/x.ts', line: 1 } });
    registry.reset();
    expect(registry.entities).toEqual([]);
  });
});
