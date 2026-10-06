import { z } from 'zod';
import type { UseCase, UseCaseContext } from '@agentic-ddd/core';
import { AgentUseCase } from '@agentic-ddd/decorators';
import { OrderConfirmed } from '../domain/order.events.js';
import type { OrderRepository } from '../domain/order.repository.js';
import { loadOrder } from './load-order.js';

export const confirmOrderInput = z.object({
  order_id: z.string().min(1).describe('Id do pedido a confirmar'),
});
export const confirmOrderOutput = z.object({
  order_id: z.string(),
  status: z.literal('confirmed'),
});
export type ConfirmOrderInput = z.infer<typeof confirmOrderInput>;
export type ConfirmOrderOutput = z.infer<typeof confirmOrderOutput>;

@AgentUseCase({
  name: 'confirm_order',
  description: 'Confirma um pedido pendente.',
  whenToUse: 'Quando o cliente ou o atendente confirmar um pedido pendente.',
  whenNotToUse: 'Para pedidos já confirmados ou cancelados.',
  input: confirmOrderInput,
  output: confirmOrderOutput,
  uses: ['method:Order.confirm'],
  emits: [OrderConfirmed],
})
export class ConfirmOrder implements UseCase<
  ConfirmOrderInput,
  ConfirmOrderOutput
> {
  constructor(private readonly orders: OrderRepository) {}

  async execute(
    input: ConfirmOrderInput,
    ctx: UseCaseContext,
  ): Promise<ConfirmOrderOutput> {
    const order = await loadOrder(this.orders, input.order_id);
    order.confirm();
    await this.orders.save(order);
    await ctx.publish(order.pullEvents());
    return { order_id: order.id, status: 'confirmed' };
  }
}
