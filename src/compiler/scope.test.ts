import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { ValueObject } from '@agentic-ddd/core';
import {
  AgentValueObject,
  createRegistry,
  withRegistry,
} from '@agentic-ddd/decorators';
import { declarationsInModules } from '../contracts/scope';
import { registrySizes, scopeRegistry } from './scope';

const ROOT = resolve(import.meta.dir, '../..');

function twoVos() {
  const registry = createRegistry();
  withRegistry(registry, () => {
    @AgentValueObject({ description: 'Dentro.' })
    class Dentro extends ValueObject<{ v: number }> {}
    @AgentValueObject({ description: 'Fora.' })
    class Fora extends ValueObject<{ v: number }> {}
    void Dentro;
    void Fora;
  });
  // simula um VO declarado em outro diretório
  (registry.valueObjects[1]!.source as { file: string }).file = resolve(
    ROOT,
    'src/outro/x.ts',
  );
  return registry;
}

describe('escopo com value objects', () => {
  test('registrySizes conta VOs', () => {
    expect(registrySizes(twoVos()).valueObjects).toBe(2);
  });

  test('scopeRegistry mantém o VO do arquivo importado e descarta o de fora', () => {
    const registry = twoVos();
    const scoped = scopeRegistry(
      registry,
      [registry.valueObjects[0]!.source.file],
      {
        ...registrySizes(registry),
        valueObjects: 2,
      },
    );
    expect(scoped.valueObjects.map((v) => v.target.name)).toEqual(['Dentro']);
  });

  test('declarationsInModules mantém o VO do módulo e descarta o de fora', () => {
    const scoped = declarationsInModules(twoVos(), ROOT, [
      { name: 'compiler', path: 'src/compiler' },
    ]);
    expect(scoped.valueObjects.map((v) => v.target.name)).toEqual(['Dentro']);
  });
});
