import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { toPosix } from '../contracts/ir';
import { AggregateRoot, DomainEvent, notImplemented } from '@agentic-ddd/core';
import {
  AgentAdapter,
  AgentEntity,
  AgentEvent,
  AgentMethod,
  AgentPort,
  AgentValueObject,
  Invariant,
  createRegistry,
  defaultRegistry,
  withRegistry,
} from '@agentic-ddd/decorators';

function declareProduct() {
  const registry = createRegistry();
  const classes = withRegistry(registry, () => {
    @AgentEvent({
      description: 'Produto publicado.',
      payload: z.object({ productId: z.string() }),
    })
    class ProductPublished extends DomainEvent<{ productId: string }> {}

    @AgentEntity({
      description: 'Produto do catálogo.',
      states: ['draft', 'published'],
    })
    @Invariant({
      id: 'preco-positivo',
      text: 'O preço é sempre maior que zero.',
    })
    class Product extends AggregateRoot<string> {
      @AgentMethod({ description: 'Cria um rascunho.' })
      static create(): Product {
        return notImplemented();
      }

      @AgentMethod({
        description: 'Publica o produto.',
        transition: { from: ['draft'], to: 'published' },
        emits: [ProductPublished],
      })
      @Invariant({
        id: 'publicacao-exige-estoque',
        text: 'Só publica com estoque.',
      })
      publish(): void {
        notImplemented();
      }
    }

    return { Product, ProductPublished };
  });
  return { registry, ...classes };
}

describe('decorators de domínio', () => {
  test('@AgentEntity registra descrição e estados', () => {
    const { registry, Product } = declareProduct();
    expect(registry.entities).toHaveLength(1);
    expect(registry.entities[0]!.target).toBe(Product);
    expect(registry.entities[0]!.states).toEqual(['draft', 'published']);
  });

  test('@Invariant distingue classe e método', () => {
    const { registry, Product } = declareProduct();
    const byId = Object.fromEntries(registry.invariants.map((i) => [i.id, i]));
    expect(byId['preco-positivo']!.method).toBeNull();
    expect(byId['publicacao-exige-estoque']!.method).toBe('publish');
    expect(registry.invariants.every((i) => i.entity === Product)).toBe(true);
  });

  test('@AgentMethod registra estático, transição, emits e a função', () => {
    const { registry, Product, ProductPublished } = declareProduct();
    const create = registry.methods.find((m) => m.name === 'create')!;
    const publish = registry.methods.find((m) => m.name === 'publish')!;
    expect(create.isStatic).toBe(true);
    expect(create.entity).toBe(Product);
    expect(publish.isStatic).toBe(false);
    expect(publish.entity).toBe(Product);
    expect(publish.transition).toEqual({ from: ['draft'], to: 'published' });
    expect(publish.emits).toEqual([ProductPublished]);
    expect(publish.fn).toBe(Reflect.get(Product.prototype, 'publish'));
  });

  test('@AgentEvent registra o evento', () => {
    const { registry, ProductPublished } = declareProduct();
    expect(registry.events.map((e) => e.target)).toEqual([ProductPublished]);
  });

  test('a fonte aponta para este arquivo de teste', () => {
    const { registry } = declareProduct();
    const publish = registry.methods.find((m) => m.name === 'publish')!;
    expect(
      toPosix(publish.source.file).endsWith('/src/decorators/domain.test.ts'),
    ).toBe(true);
    expect(publish.source.line).toBeGreaterThan(0);
  });

  test('@AgentEntity guarda contains e references como funções, sem chamá-las', () => {
    const registry = createRegistry();
    let calls = 0;
    withRegistry(registry, () => {
      class Filha {}
      class Alvo {}
      @AgentEntity({
        description: 'Dono.',
        contains: () => {
          calls += 1;
          return [Filha];
        },
        references: () => {
          calls += 1;
          return [Alvo];
        },
      })
      class Dono {}
      return Dono;
    });
    expect(calls).toBe(0);
    const record = registry.entities[0]!;
    expect(typeof record.contains).toBe('function');
    expect(typeof record.references).toBe('function');
    expect(record.contains!()).toHaveLength(1);
    expect(record.references!()).toHaveLength(1);
    expect(calls).toBe(2);
  });

  test('@AgentEntity sem contains e references não tem as chaves', () => {
    const registry = createRegistry();
    withRegistry(registry, () => {
      @AgentEntity({ description: 'Solta.' })
      class Solta {}
      return Solta;
    });
    const record = registry.entities[0]!;
    expect('contains' in record).toBe(false);
    expect('references' in record).toBe(false);
  });

  test('decorators dentro de withRegistry não vazam para o registry default', () => {
    const { Product } = declareProduct();
    expect(defaultRegistry.entities.some((e) => e.target === Product)).toBe(
      false,
    );
  });

  test('@AgentValueObject registra descrição, classe e fonte', () => {
    const registry = createRegistry();
    const Money = withRegistry(registry, () => {
      @AgentValueObject({ description: 'Valor em centavos.' })
      class Money {}
      return Money;
    });
    expect(registry.valueObjects).toHaveLength(1);
    expect(registry.valueObjects[0]!.target).toBe(Money);
    expect(registry.valueObjects[0]!.description).toBe('Valor em centavos.');
    expect(
      toPosix(registry.valueObjects[0]!.source.file).endsWith(
        '/src/decorators/domain.test.ts',
      ),
    ).toBe(true);
  });

  test('reset esvazia valueObjects', () => {
    const registry = createRegistry();
    withRegistry(registry, () => {
      @AgentValueObject({ description: 'Valor em centavos.' })
      class Money {}
      return Money;
    });
    expect(registry.valueObjects).toHaveLength(1);
    registry.reset();
    expect(registry.valueObjects).toEqual([]);
  });
});

describe('@AgentPort', () => {
  test('grava descrição, raiz, métodos e origem sem chamar root', () => {
    const registry = createRegistry();
    let rootCalls = 0;
    class Product extends AggregateRoot<string> {}
    const ProductRepository = withRegistry(registry, () => {
      @AgentPort({
        description: 'Repositório de produtos.',
        root: () => {
          rootCalls++;
          return Product;
        },
        methods: { save: 'Grava o produto.' },
      })
      abstract class ProductRepositoryPort {
        abstract save(product: Product): Promise<void>;
      }
      return ProductRepositoryPort;
    });
    expect(rootCalls).toBe(0);
    const port = registry.ports[0]!;
    expect(registry.ports).toHaveLength(1);
    expect(port.target).toBe(ProductRepository);
    expect(port.description).toBe('Repositório de produtos.');
    expect(port.methods).toEqual({ save: 'Grava o produto.' });
    expect(port.source.file.endsWith('domain.test.ts')).toBe(true);
    expect(port.root()).toBe(Product);
    registry.reset();
    expect(registry.ports).toEqual([]);
  });
});

describe('@AgentAdapter', () => {
  test('grava descrição, port e origem sem chamar implements', () => {
    const registry = createRegistry();
    let implementsCalls = 0;
    class ProductRepository {}
    const InMemoryProductRepository = withRegistry(registry, () => {
      @AgentAdapter({
        description: 'Repositório de produtos em memória.',
        implements: () => {
          implementsCalls++;
          return ProductRepository;
        },
      })
      class InMemoryProductRepositoryAdapter {}
      return InMemoryProductRepositoryAdapter;
    });
    expect(implementsCalls).toBe(0);
    expect(registry.adapters).toHaveLength(1);
    const adapter = registry.adapters[0]!;
    expect(adapter.target).toBe(InMemoryProductRepository);
    expect(adapter.description).toBe('Repositório de produtos em memória.');
    expect(adapter.implements()).toBe(ProductRepository);
    expect(adapter.source.file.endsWith('domain.test.ts')).toBe(true);
    registry.reset();
    expect(registry.adapters).toEqual([]);
  });
});
