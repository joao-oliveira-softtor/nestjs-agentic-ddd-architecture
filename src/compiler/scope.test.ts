import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { AggregateRoot, ValueObject } from '@agentic-ddd/core';
import {
  AgentAdapter,
  AgentEntity,
  AgentPort,
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

describe('escopo com ports', () => {
  function twoPorts() {
    const registry = createRegistry();
    withRegistry(registry, () => {
      @AgentEntity({ description: 'Conta.' })
      class Conta extends AggregateRoot<string> {}
      @AgentPort({ description: 'Dentro.', root: () => Conta, methods: {} })
      abstract class Dentro {}
      @AgentPort({ description: 'Fora.', root: () => Conta, methods: {} })
      abstract class Fora {}
      void [Dentro, Fora];
    });
    (registry.ports[1]!.source as { file: string }).file = resolve(
      ROOT,
      'src/outro/x.ts',
    );
    return registry;
  }

  test('registrySizes conta ports', () => {
    expect(registrySizes(twoPorts()).ports).toBe(2);
  });

  test('scopeRegistry mantém o port do arquivo importado e descarta o de fora', () => {
    const registry = twoPorts();
    const scoped = scopeRegistry(registry, [registry.ports[0]!.source.file], {
      ...registrySizes(registry),
      ports: 2,
    });
    expect(scoped.ports.map((p) => p.target.name)).toEqual(['Dentro']);
  });

  test('declarationsInModules mantém o port do módulo e descarta o de fora', () => {
    const scoped = declarationsInModules(twoPorts(), ROOT, [
      { name: 'compiler', path: 'src/compiler' },
    ]);
    expect(scoped.ports.map((p) => p.target.name)).toEqual(['Dentro']);
  });
});

describe('escopo com adapters', () => {
  function twoAdapters() {
    const registry = createRegistry();
    withRegistry(registry, () => {
      @AgentEntity({ description: 'Conta.' })
      class Conta extends AggregateRoot<string> {}
      @AgentPort({ description: 'R.', root: () => Conta, methods: {} })
      abstract class Repo {}
      @AgentAdapter({ description: 'Dentro.', implements: () => Repo })
      class Dentro extends Repo {}
      @AgentAdapter({ description: 'Fora.', implements: () => Repo })
      class Fora extends Repo {}
      void [Dentro, Fora];
    });
    (registry.adapters[1]!.source as { file: string }).file = resolve(
      ROOT,
      'src/outro/x.ts',
    );
    return registry;
  }

  test('registrySizes conta adapters', () => {
    expect(registrySizes(twoAdapters()).adapters).toBe(2);
  });

  test('scopeRegistry mantém o adapter do arquivo importado e descarta o de fora', () => {
    const registry = twoAdapters();
    const scoped = scopeRegistry(
      registry,
      [registry.adapters[0]!.source.file],
      { ...registrySizes(registry), adapters: 2 },
    );
    expect(scoped.adapters.map((a) => a.target.name)).toEqual(['Dentro']);
  });

  test('declarationsInModules mantém o adapter do módulo e descarta o de fora', () => {
    const scoped = declarationsInModules(twoAdapters(), ROOT, [
      { name: 'compiler', path: 'src/compiler' },
    ]);
    expect(scoped.adapters.map((a) => a.target.name)).toEqual(['Dentro']);
  });
});
