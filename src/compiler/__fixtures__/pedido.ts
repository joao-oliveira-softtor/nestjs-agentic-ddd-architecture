import {
  AggregateRoot,
  Entity,
  ValueObject,
  notImplemented,
} from '@agentic-ddd/core';
import {
  AgentEntity,
  AgentMethod,
  AgentValueObject,
  createRegistry,
  withRegistry,
  type Registry,
} from '@agentic-ddd/decorators';

export const ORDERING_MODULE = {
  name: 'pedido',
  path: 'src/compiler/__fixtures__',
} as const;

export function defineOrdering(): Registry {
  const registry = createRegistry();
  withRegistry(registry, () => {
    @AgentValueObject({ description: 'Valor monetário.' })
    class Dinheiro extends ValueObject<{ centavos: number }> {}

    @AgentValueObject({ description: 'Quantidade de unidades.' })
    class Quantidade extends ValueObject<{ valor: number }> {}

    @AgentEntity({
      description: 'Item de um pedido.',
      contains: () => [Quantidade, Dinheiro],
    })
    class ItemDoPedido extends Entity<string> {}

    @AgentEntity({
      description: 'Pedido de compra.',
      contains: () => [ItemDoPedido, Dinheiro],
    })
    class Pedido extends AggregateRoot<string> {
      @AgentMethod({ description: 'Adiciona um item ao pedido.' })
      adicionarItem(): void {
        notImplemented();
      }
    }

    void Pedido;
  });
  return registry;
}
