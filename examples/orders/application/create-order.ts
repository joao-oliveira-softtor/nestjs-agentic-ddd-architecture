import { z } from 'zod';
import {
  DomainError,
  type UseCase,
  type UseCaseContext,
} from '@agentic-ddd/core';
import { AgentUseCase } from '@agentic-ddd/decorators';
import { Order } from '../domain/order';
import { OrderCreated } from '../domain/order.events';
import type { OrderRepository } from '../domain/order.repository';

export const createOrderInput = z.object({
  order_id: z.string().min(1).describe('Id do novo pedido'),
  customer_id: z.string().min(1).describe('Id do cliente'),
  items: z
    .array(
      z.object({
        sku: z.string().min(1).describe('Código do produto'),
        quantity: z.number().int().positive().describe('Quantidade'),
        unit_price: z
          .number()
          .nonnegative()
          .describe('Preço unitário em reais'),
      }),
    )
    .min(1)
    .describe('Itens do pedido'),
});
export const createOrderOutput = z.object({
  order_id: z.string(),
  status: z.literal('pending'),
  total: z.number(),
});
export type CreateOrderInput = z.infer<typeof createOrderInput>;
export type CreateOrderOutput = z.infer<typeof createOrderOutput>;

@AgentUseCase({
  name: 'create_order',
  description:
    'Cria um pedido pendente para um cliente com os itens informados.',
  whenToUse: 'Quando o cliente quer abrir um novo pedido.',
  whenNotToUse: 'Para alterar itens de um pedido que já existe.',
  input: createOrderInput,
  output: createOrderOutput,
  uses: ['method:Order.create'],
  emits: [OrderCreated],
})
export class CreateOrder implements UseCase<
  CreateOrderInput,
  CreateOrderOutput
> {
  constructor(private readonly orders: OrderRepository) {}

  async execute(
    input: CreateOrderInput,
    ctx: UseCaseContext,
  ): Promise<CreateOrderOutput> {
    if (await this.orders.findById(input.order_id)) {
      throw new DomainError(
        'ORDER_ALREADY_EXISTS',
        `Já existe um pedido com id ${input.order_id}.`,
      );
    }
    const order = Order.create({
      id: input.order_id,
      customerId: input.customer_id,
      items: input.items.map((i) => ({
        sku: i.sku,
        quantity: i.quantity,
        unitPrice: i.unit_price,
      })),
    });
    await this.orders.save(order);
    await ctx.publish(order.pullEvents());
    return { order_id: order.id, status: 'pending', total: order.total };
  }
}
