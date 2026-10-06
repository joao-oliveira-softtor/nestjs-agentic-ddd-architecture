import { z } from 'zod';
import { AggregateRoot, DomainEvent, notImplemented, type UseCase, type UseCaseContext } from '@agentic-ddd/core';
import {
  AgentEntity,
  AgentEvent,
  AgentMethod,
  AgentUseCase,
  Invariant,
  Operator,
  createRegistry,
  withRegistry,
  type Registry,
} from '@agentic-ddd/decorators';

export const SHOP_MODULE = { name: 'shop', path: 'src/compiler/__fixtures__' } as const;

export function defineShop(): Registry {
  const registry = createRegistry();
  withRegistry(registry, () => {
    @AgentEvent({ description: 'Um produto foi criado como rascunho.', payload: z.object({ productId: z.string() }) })
    class ProductCreated extends DomainEvent<{ productId: string }> {}

    @AgentEvent({ description: 'Um produto foi publicado no catálogo.', payload: z.object({ productId: z.string() }) })
    class ProductPublished extends DomainEvent<{ productId: string }> {}

    @AgentEntity({ description: 'Produto do catálogo da loja.', states: ['draft', 'published'] })
    @Invariant({ id: 'preco-positivo', text: 'O preço de um produto é sempre maior que zero.' })
    class Product extends AggregateRoot<string> {
      @AgentMethod({ description: 'Cria um produto em rascunho.', emits: [ProductCreated] })
      static create(): Product {
        return notImplemented();
      }

      @AgentMethod({
        description: 'Publica o produto no catálogo.',
        transition: { from: ['draft'], to: 'published' },
        emits: [ProductPublished],
      })
      @Invariant({ id: 'publicacao-exige-estoque', text: 'Só é possível publicar um produto com estoque maior que zero.' })
      publish(): void {
        notImplemented();
      }
    }

    const createInput = z.object({
      product_id: z.string().min(1).describe('Id do novo produto'),
      price: z.number().positive().describe('Preço em reais'),
    });
    const createOutput = z.object({ product_id: z.string(), status: z.literal('draft') });

    @AgentUseCase({
      name: 'create_product',
      description: 'Cria um produto em rascunho.',
      whenToUse: 'Quando pedirem para cadastrar um produto novo.',
      input: createInput,
      output: createOutput,
      uses: ['method:Product.create'],
      emits: [ProductCreated],
    })
    class CreateProduct implements UseCase<z.infer<typeof createInput>, z.infer<typeof createOutput>> {
      execute(_input: z.infer<typeof createInput>, _ctx: UseCaseContext): Promise<z.infer<typeof createOutput>> {
        return notImplemented();
      }
    }

    const publishInput = z.object({ product_id: z.string().min(1).describe('Id do produto a publicar') });
    const publishOutput = z.object({ product_id: z.string(), status: z.literal('published') });

    @AgentUseCase({
      name: 'publish_product',
      description: 'Publica um produto em rascunho no catálogo.',
      whenToUse: 'Quando pedirem para disponibilizar um produto para venda.',
      whenNotToUse: 'Para alterar preço ou estoque.',
      input: publishInput,
      output: publishOutput,
      uses: ['method:Product.publish'],
      emits: [ProductPublished],
    })
    class PublishProduct implements UseCase<z.infer<typeof publishInput>, z.infer<typeof publishOutput>> {
      execute(_input: z.infer<typeof publishInput>, _ctx: UseCaseContext): Promise<z.infer<typeof publishOutput>> {
        return notImplemented();
      }
    }

    @Operator({
      name: 'catalog-operator',
      description: 'Opera o catálogo de produtos: cadastrar e publicar. Use quando a conversa for sobre produtos da loja.',
      instructions: 'Você gerencia o catálogo. Use apenas as tools disponíveis e confirme o produto pelo id.',
      useCases: [CreateProduct, PublishProduct],
      requiresApproval: [PublishProduct],
    })
    class CatalogOperator {}

    void Product;
    void CatalogOperator;
  });
  return registry;
}
