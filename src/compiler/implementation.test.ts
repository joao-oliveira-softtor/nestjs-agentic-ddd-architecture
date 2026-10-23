import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { defineShop, SHOP_MODULE } from './__fixtures__/shop';
import { analyze } from './analyze';
import { implementation } from './implementation';
import { renderAll, DEFAULT_OUT } from './render';
import { contentHash, elementsOf } from './diff';
import { AggregateRoot, ValueObject, notImplemented } from '@agentic-ddd/core';
import {
  AgentAdapter,
  AgentEntity,
  AgentPort,
  AgentValueObject,
  Invariant,
  createRegistry,
  withRegistry,
} from '@agentic-ddd/decorators';

test('detecta funções individuais sem contaminar IR e gerados ao implementar corpos', () => {
  const registry = defineShop();
  const options = {
    root: resolve(import.meta.dir, '../..'),
    modules: [SHOP_MODULE],
  };
  const before = analyze(registry, options).ir;
  expect(Object.fromEntries(implementation(before, registry))).toEqual({
    'entity:Product': false,
    'method:Product.publish': false,
    'usecase:create_product': false,
    'usecase:publish_product': false,
    'operator:catalog-operator': true,
  });
  registry.methods.forEach((m, i) => {
    registry.methods[i] = { ...m, fn: function () {} };
  });
  for (const u of registry.useCases)
    Object.defineProperty(u.target.prototype, 'execute', {
      value: function () {},
    });
  const after = analyze(registry, options).ir;
  expect([...implementation(after, registry).values()]).toEqual([
    true,
    true,
    true,
    true,
    true,
  ]);
  expect(after).toEqual(before);
  expect(renderAll(after, DEFAULT_OUT)).toEqual(renderAll(before, DEFAULT_OUT));
  expect([...elementsOf(after).values()].map(contentHash)).toEqual(
    [...elementsOf(before).values()].map(contentHash),
  );
});

test('entidade sem fábrica usa obrigações; várias fábricas exigem todos os corpos', () => {
  const registry = defineShop();
  const options = {
    root: resolve(import.meta.dir, '../..'),
    modules: [SHOP_MODULE],
  };
  const factory = registry.methods.find((m) => m.isStatic)!;
  registry.methods.push({ ...factory, name: 'other', fn: function () {} });
  expect(
    implementation(analyze(registry, options).ir, registry).get(
      'entity:Product',
    ),
  ).toBe(false);
  registry.methods.splice(
    0,
    registry.methods.length,
    ...registry.methods.filter((m) => !m.isStatic),
  );
  expect(
    implementation(analyze(registry, options).ir, registry).get(
      'entity:Product',
    ),
  ).toBe(true);
});

const VO_MODULE = { name: 'vo', path: 'src/compiler' } as const;
const voOptions = {
  root: resolve(import.meta.dir, '../..'),
  modules: [VO_MODULE],
};
const voImplemented = (
  build: (r: ReturnType<typeof createRegistry>) => void,
) => {
  const registry = createRegistry();
  withRegistry(registry, () => build(registry));
  return implementation(analyze(registry, voOptions).ir, registry).get(
    'valueobject:Dinheiro',
  );
};

test('value object com notImplemented() no construtor, em #privado ou em método não está implementado', () => {
  expect(
    voImplemented(() => {
      @AgentValueObject({ description: 'Valor monetário.' })
      @Invariant({ id: 'nao-negativo', text: 'Dinheiro nunca é negativo.' })
      class Dinheiro extends ValueObject<{ v: number }> {
        private constructor(p: { v: number }) {
          super(p);
        }
        #check() {}
        soma() {
          return this.#check();
        }
      }
      void Dinheiro;
    }),
  ).toBe(true);
  expect(
    voImplemented(() => {
      @AgentValueObject({ description: 'Valor monetário.' })
      @Invariant({ id: 'nao-negativo', text: 'Dinheiro nunca é negativo.' })
      class Dinheiro extends ValueObject<{ v: number }> {
        private constructor(p: { v: number }) {
          super(p);
          notImplemented();
        }
        #check() {}
        soma() {
          return this.#check();
        }
      }
      void Dinheiro;
    }),
  ).toBe(false);
  expect(
    voImplemented(() => {
      @AgentValueObject({ description: 'Valor monetário.' })
      @Invariant({ id: 'nao-negativo', text: 'Dinheiro nunca é negativo.' })
      class Dinheiro extends ValueObject<{ v: number }> {
        private constructor(p: { v: number }) {
          super(p);
        }
        #check() {
          notImplemented();
        }
        soma() {
          return this.#check();
        }
      }
      void Dinheiro;
    }),
  ).toBe(false);
  expect(
    voImplemented(() => {
      @AgentValueObject({ description: 'Valor monetário.' })
      @Invariant({ id: 'nao-negativo', text: 'Dinheiro nunca é negativo.' })
      class Dinheiro extends ValueObject<{ v: number }> {
        private constructor(p: { v: number }) {
          super(p);
        }
        #check() {}
        soma() {
          notImplemented();
          return this.#check();
        }
      }
      void Dinheiro;
    }),
  ).toBe(false);
});

test('adapter com notImplemented() não está implementado', () => {
  const adapterImplemented = (stub: boolean) => {
    const registry = createRegistry();
    withRegistry(registry, () => {
      @AgentEntity({ description: 'Raiz.' })
      class Raiz extends AggregateRoot<string> {}
      @AgentPort({
        description: 'Persistência.',
        root: () => Raiz,
        methods: { salvar: 'Grava.' },
      })
      abstract class Repo {}
      if (stub) {
        @AgentAdapter({ description: 'Em memória.', implements: () => Repo })
        class MemoryRepo extends Repo {
          constructor() {
            super();
            notImplemented();
          }
        }
        void MemoryRepo;
      } else {
        @AgentAdapter({ description: 'Em memória.', implements: () => Repo })
        class MemoryRepo extends Repo {}
        void MemoryRepo;
      }
    });
    return implementation(analyze(registry, voOptions).ir, registry).get(
      'adapter:MemoryRepo',
    );
  };
  expect(adapterImplemented(true)).toBe(false);
  expect(adapterImplemented(false)).toBe(true);
});
