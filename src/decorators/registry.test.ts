import { describe, expect, test } from 'bun:test';
import {
  activeRegistry,
  captureSource,
  createRegistry,
  defaultRegistry,
  parseFrame,
  withRegistry,
} from '@agentic-ddd/decorators';
import { located } from '../../test/fixtures/located.js';

describe('captureSource', () => {
  test('aponta o arquivo e a linha de quem chamou', () => {
    expect(located.file.endsWith('/test/fixtures/located.ts')).toBe(true);
    expect(located.line).toBe(3);
  });

  test('chama captureSource direto dentro de registry.test.ts', () => {
    const loc = captureSource();
    expect(loc.file.endsWith('/src/decorators/registry.test.ts')).toBe(true);
    expect(loc.line).toBeGreaterThan(0);
  });
});

describe('parseFrame', () => {
  test('reconhece formato com parêntese: at <qualquer> (PATH:L:C)', () => {
    const result = parseFrame('    at foo (/home/user/proj/a.ts:3:20)');
    expect(result).not.toBeNull();
    expect(result?.file).toBe('/home/user/proj/a.ts');
    expect(result?.line).toBe(3);
  });

  test('reconhece formato direto: at PATH:L:C', () => {
    const result = parseFrame('    at /home/user/proj/a.ts:3:20');
    expect(result).not.toBeNull();
    expect(result?.file).toBe('/home/user/proj/a.ts');
    expect(result?.line).toBe(3);
  });

  test('extrai corretamente caminho com espaço', () => {
    const result = parseFrame('    at foo (/home/my user/proj/a.ts:3:20)');
    expect(result).not.toBeNull();
    expect(result?.file).toBe('/home/my user/proj/a.ts');
    expect(result?.line).toBe(3);
  });

  test('extrai corretamente caminho com parêntese', () => {
    const result = parseFrame('    at foo (/home/u/pro(j)/a.ts:3:20)');
    expect(result).not.toBeNull();
    expect(result?.file).toBe('/home/u/pro(j)/a.ts');
    expect(result?.line).toBe(3);
  });

  test('reconhece URL file://', () => {
    const result = parseFrame('    at foo (file:///home/user/proj/a.ts:3:20)');
    expect(result).not.toBeNull();
    expect(result?.file).toBe('/home/user/proj/a.ts');
    expect(result?.line).toBe(3);
  });

  test('retorna null para linha sem frame', () => {
    const result = parseFrame('    invalid line without frame');
    expect(result).toBeNull();
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
    const source = { file: '/x.ts', line: 1 };
    registry.entities.push({
      target: class X {},
      description: 'x',
      states: [],
      source,
    });
    registry.invariants.push({
      entity: class X {},
      method: null,
      id: 'inv1',
      text: 'invariant',
      source,
    });
    registry.methods.push({
      entity: class X {},
      name: 'method',
      isStatic: false,
      description: 'desc',
      emits: [],
      transition: null,
      fn: () => {},
      source,
    });
    registry.events.push({
      target: class X {},
      description: 'event',
      payload: {} as any,
      source,
    });
    registry.useCases.push({
      target: class X {},
      name: 'uc',
      description: 'use case',
      whenToUse: 'when',
      whenNotToUse: null,
      input: {} as any,
      output: {} as any,
      uses: [],
      emits: [],
      source,
    });
    registry.operators.push({
      target: class X {},
      name: 'op',
      description: 'operator',
      instructions: 'instr',
      useCases: [],
      requiresApproval: [],
      limits: { maxSteps: 10, timeoutMs: 1000 },
      model: 'gpt',
      source,
    });

    expect(registry.entities.length).toBe(1);
    expect(registry.invariants.length).toBe(1);
    expect(registry.methods.length).toBe(1);
    expect(registry.events.length).toBe(1);
    expect(registry.useCases.length).toBe(1);
    expect(registry.operators.length).toBe(1);

    registry.reset();

    expect(registry.entities).toEqual([]);
    expect(registry.invariants).toEqual([]);
    expect(registry.methods).toEqual([]);
    expect(registry.events).toEqual([]);
    expect(registry.useCases).toEqual([]);
    expect(registry.operators).toEqual([]);
  });
});
