import type { Order } from '../domain/order';
import type { OrderRepository } from '../domain/order.repository';

export class InMemoryOrderRepository implements OrderRepository {
  readonly #orders = new Map<string, Order>();

  async findById(id: string): Promise<Order | null> {
    return this.#orders.get(id) ?? null;
  }

  async save(order: Order): Promise<void> {
    this.#orders.set(order.id, order);
  }
}
