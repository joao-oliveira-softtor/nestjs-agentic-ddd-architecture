import { beforeEach, describe, expect, test } from 'bun:test';
import { DomainError } from '@agentic-ddd/core';
import { covers, createTestContext } from '@agentic-ddd/testing';
import { CancelOrder } from '../application/cancel-order';
import { ConfirmOrder } from '../application/confirm-order';
import { CreateOrder } from '../application/create-order';
import { InMemoryOrderRepository } from '../infrastructure/in-memory-order.repository';

const input = {
  order_id: 'o1',
  customer_id: 'c1',
  items: [{ sku: 'SKU-1', quantity: 2, unit_price: 10 }],
};

let orders: InMemoryOrderRepository;

beforeEach(() => {
  orders = new InMemoryOrderRepository();
});

async function rejectsWith(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
}

describe('use-cases de orders', () => {
  test(
    covers(
      ['usecase:create_order'],
      'cria, persiste e publica OrderCreated carimbado',
    ),
    async () => {
      const ctx = createTestContext({
        correlationId: 'run-1',
        causationId: 'step-1',
      });
      const output = await new CreateOrder(orders).execute(input, ctx);
      expect(output).toEqual({ order_id: 'o1', status: 'pending', total: 20 });
      expect((await orders.findById('o1'))?.status).toBe('pending');
      expect(ctx.published.map((e) => [e.name, e.correlationId])).toEqual([
        ['OrderCreated', 'run-1'],
      ]);
    },
  );

  test(
    covers(['usecase:create_order'], 'recusa id de pedido já existente'),
    async () => {
      await new CreateOrder(orders).execute(input, createTestContext());
      await rejectsWith(
        new CreateOrder(orders).execute(input, createTestContext()),
        'ORDER_ALREADY_EXISTS',
      );
    },
  );

  test(
    covers(
      ['usecase:confirm_order'],
      'confirma pedido existente e publica OrderConfirmed',
    ),
    async () => {
      await new CreateOrder(orders).execute(input, createTestContext());
      const ctx = createTestContext();
      expect(
        await new ConfirmOrder(orders).execute({ order_id: 'o1' }, ctx),
      ).toEqual({ order_id: 'o1', status: 'confirmed' });
      expect(ctx.published.map((e) => e.name)).toEqual(['OrderConfirmed']);
    },
  );

  test(
    covers(
      ['usecase:confirm_order'],
      'falha com ORDER_NOT_FOUND para pedido inexistente',
    ),
    async () => {
      await rejectsWith(
        new ConfirmOrder(orders).execute(
          { order_id: 'nada' },
          createTestContext(),
        ),
        'ORDER_NOT_FOUND',
      );
    },
  );

  test(
    covers(['usecase:cancel_order'], 'cancela pedido e publica OrderCancelled'),
    async () => {
      await new CreateOrder(orders).execute(input, createTestContext());
      const ctx = createTestContext();
      expect(
        await new CancelOrder(orders).execute({ order_id: 'o1' }, ctx),
      ).toEqual({ order_id: 'o1', status: 'cancelled' });
      expect(ctx.published.map((e) => e.name)).toEqual(['OrderCancelled']);
    },
  );
});
