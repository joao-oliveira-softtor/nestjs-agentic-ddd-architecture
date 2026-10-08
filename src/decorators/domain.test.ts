import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { AggregateRoot, DomainEvent, notImplemented } from '@agentic-ddd/core';
import {
  AgentEntity,
  AgentEvent,
  AgentMethod,
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
    expect(publish.source.file.endsWith('/src/decorators/domain.test.ts')).toBe(
      true,
    );
    expect(publish.source.line).toBeGreaterThan(0);
  });

  test('decorators dentro de withRegistry não vazam para o registry default', () => {
    const { Product } = declareProduct();
    expect(defaultRegistry.entities.some((e) => e.target === Product)).toBe(
      false,
    );
  });
});
