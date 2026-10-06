import { z } from 'zod';
import { DomainEvent } from '@agentic-ddd/core';
import { AgentEvent } from '@agentic-ddd/decorators';

export interface OrderCreatedPayload {
  readonly orderId: string;
  readonly customerId: string;
  readonly total: number;
}

@AgentEvent({
  description: 'Um pedido foi criado e está pendente.',
  payload: z.object({
    orderId: z.string(),
    customerId: z.string(),
    total: z.number(),
  }),
})
export class OrderCreated extends DomainEvent<OrderCreatedPayload> {}

@AgentEvent({
  description: 'Um pedido pendente foi confirmado.',
  payload: z.object({ orderId: z.string() }),
})
export class OrderConfirmed extends DomainEvent<{ readonly orderId: string }> {}

@AgentEvent({
  description: 'Um pedido foi cancelado.',
  payload: z.object({ orderId: z.string() }),
})
export class OrderCancelled extends DomainEvent<{ readonly orderId: string }> {}
