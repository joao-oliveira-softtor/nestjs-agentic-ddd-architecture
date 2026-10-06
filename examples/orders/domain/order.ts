import { AggregateRoot, DomainError } from '@agentic-ddd/core';
import { AgentEntity, AgentMethod, Invariant } from '@agentic-ddd/decorators';
import { OrderCancelled, OrderConfirmed, OrderCreated } from './order.events';

export type OrderStatus = 'pending' | 'confirmed' | 'cancelled';

export interface OrderItem {
  readonly sku: string;
  readonly quantity: number;
  readonly unitPrice: number;
}

export interface CreateOrderProps {
  readonly id: string;
  readonly customerId: string;
  readonly items: readonly OrderItem[];
}

@AgentEntity({
  description:
    'Pedido de compra de um cliente, com itens e ciclo de vida pendente, confirmado ou cancelado.',
  states: ['pending', 'confirmed', 'cancelled'],
})
@Invariant({
  id: 'ao-menos-um-item',
  text: 'Um pedido precisa ter ao menos um item.',
})
@Invariant({
  id: 'total-nao-negativo',
  text: 'O total do pedido (soma de quantidade × preço unitário) nunca pode ser negativo.',
})
export class Order extends AggregateRoot<string> {
  #status: OrderStatus;

  private constructor(
    id: string,
    readonly customerId: string,
    readonly items: readonly OrderItem[],
    status: OrderStatus,
  ) {
    super(id);
    this.#status = status;
  }

  get status(): OrderStatus {
    return this.#status;
  }

  get total(): number {
    return this.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0,
    );
  }

  @AgentMethod({
    description: 'Cria um pedido pendente para um cliente.',
    emits: [OrderCreated],
  })
  static create(props: CreateOrderProps): Order {
    if (props.items.length === 0) {
      throw new DomainError(
        'ORDER_WITHOUT_ITEMS',
        'Um pedido precisa ter ao menos um item.',
      );
    }
    const order = new Order(
      props.id,
      props.customerId,
      [...props.items],
      'pending',
    );
    if (order.total < 0) {
      throw new DomainError(
        'ORDER_NEGATIVE_TOTAL',
        'O total do pedido não pode ser negativo.',
      );
    }
    order.record(
      new OrderCreated({
        orderId: order.id,
        customerId: order.customerId,
        total: order.total,
      }),
    );
    return order;
  }

  @AgentMethod({
    description: 'Confirma um pedido pendente.',
    transition: { from: ['pending'], to: 'confirmed' },
    emits: [OrderConfirmed],
  })
  confirm(): void {
    this.#ensureStatus(['pending'], 'confirmar');
    this.#status = 'confirmed';
    this.record(new OrderConfirmed({ orderId: this.id }));
  }

  @AgentMethod({
    description: 'Cancela um pedido pendente ou confirmado.',
    transition: { from: ['pending', 'confirmed'], to: 'cancelled' },
    emits: [OrderCancelled],
  })
  cancel(): void {
    this.#ensureStatus(['pending', 'confirmed'], 'cancelar');
    this.#status = 'cancelled';
    this.record(new OrderCancelled({ orderId: this.id }));
  }

  #ensureStatus(allowed: readonly OrderStatus[], action: string): void {
    if (!allowed.includes(this.#status)) {
      throw new DomainError(
        'ORDER_INVALID_TRANSITION',
        `Não é possível ${action} um pedido com status ${this.#status}.`,
      );
    }
  }
}
