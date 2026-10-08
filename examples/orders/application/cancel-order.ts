import { z } from 'zod';
import type { UseCase, UseCaseContext } from '@agentic-ddd/core';
import { AgentUseCase } from '@agentic-ddd/decorators';
import { OrderCancelled } from '../domain/order.events';
import type { OrderRepository } from '../domain/order.repository';
import { loadOrder } from './load-order';

export const cancelOrderInput = z.object({
  order_id: z.string().min(1).describe('Id do pedido a cancelar'),
  reason: z
    .string()
    .min(1)
    .describe('Motivo do cancelamento informado pelo cliente'),
});
export const cancelOrderOutput = z.object({
  order_id: z.string(),
  status: z.literal('cancelled'),
});
export type CancelOrderInput = z.infer<typeof cancelOrderInput>;
export type CancelOrderOutput = z.infer<typeof cancelOrderOutput>;

@AgentUseCase({
  name: 'cancel_order',
  description: 'Cancela um pedido pendente ou confirmado.',
  whenToUse:
    'Quando o cliente desistir de um pedido que ainda não foi cancelado.',
  whenNotToUse: 'Para pedidos já cancelados.',
  input: cancelOrderInput,
  output: cancelOrderOutput,
  uses: ['method:Order.cancel'],
  emits: [OrderCancelled],
})
export class CancelOrder implements UseCase<
  CancelOrderInput,
  CancelOrderOutput
> {
  constructor(private readonly orders: OrderRepository) {}

  async execute(
    input: CancelOrderInput,
    ctx: UseCaseContext,
  ): Promise<CancelOrderOutput> {
    const order = await loadOrder(this.orders, input.order_id);
    order.cancel(input.reason);
    await this.orders.save(order);
    await ctx.publish(order.pullEvents());
    return { order_id: order.id, status: 'cancelled' };
  }
}
