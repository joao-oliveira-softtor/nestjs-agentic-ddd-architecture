import { DomainError } from '@agentic-ddd/core';
import type { Order } from '../domain/order.js';
import type { OrderRepository } from '../domain/order.repository.js';

export async function loadOrder(
  orders: OrderRepository,
  id: string,
): Promise<Order> {
  const order = await orders.findById(id);
  if (!order)
    throw new DomainError('ORDER_NOT_FOUND', `Pedido ${id} não encontrado.`);
  return order;
}
