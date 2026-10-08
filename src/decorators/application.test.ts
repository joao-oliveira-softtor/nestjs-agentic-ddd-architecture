import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { notImplemented } from '@agentic-ddd/core';
import {
  AgentUseCase,
  DEFAULT_LIMITS,
  Operator,
  createRegistry,
  withRegistry,
} from '@agentic-ddd/decorators';

function declareCatalog() {
  const registry = createRegistry();
  const classes = withRegistry(registry, () => {
    @AgentUseCase({
      name: 'publish_product',
      description: 'Publica um produto.',
      whenToUse: 'Quando pedirem para publicar.',
      input: z.object({ product_id: z.string() }),
      output: z.object({ product_id: z.string() }),
      uses: ['method:Product.publish'],
    })
    class PublishProduct {
      execute(): Promise<never> {
        return notImplemented();
      }
    }

    @Operator({
      name: 'catalog-operator',
      description: 'Opera o catálogo.',
      instructions: 'Use só as tools disponíveis.',
      useCases: [PublishProduct],
      requiresApproval: [PublishProduct],
      limits: { maxSteps: 3 },
    })
    class CatalogOperator {}

    return { PublishProduct, CatalogOperator };
  });
  return { registry, ...classes };
}

describe('decorators de aplicação', () => {
  test('@AgentUseCase registra contrato, uses e defaults', () => {
    const { registry, PublishProduct } = declareCatalog();
    const useCase = registry.useCases[0]!;
    expect(useCase.target).toBe(PublishProduct);
    expect(useCase.name).toBe('publish_product');
    expect(useCase.uses).toEqual(['method:Product.publish']);
    expect(useCase.whenNotToUse).toBeNull();
    expect(useCase.emits).toEqual([]);
  });

  test('@Operator registra allowlist, aprovação e mescla limites com o default', () => {
    const { registry, PublishProduct, CatalogOperator } = declareCatalog();
    const operator = registry.operators[0]!;
    expect(operator.target).toBe(CatalogOperator);
    expect(operator.useCases).toEqual([PublishProduct]);
    expect(operator.requiresApproval).toEqual([PublishProduct]);
    expect(operator.limits).toEqual({
      maxSteps: 3,
      timeoutMs: DEFAULT_LIMITS.timeoutMs,
    });
    expect(operator.model).toBe('default');
  });
});
