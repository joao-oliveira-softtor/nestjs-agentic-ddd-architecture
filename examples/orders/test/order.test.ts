import { describe, expect, test } from 'bun:test';
import { DomainError } from '@agentic-ddd/core';
import { covers } from '@agentic-ddd/testing';
import { Order } from '../domain/order';

const item = { sku: 'SKU-1', quantity: 2, unitPrice: 10 };

function newOrder(): Order {
  const order = Order.create({ id: 'o1', customerId: 'c1', items: [item] });
  order.pullEvents();
  return order;
}

function expectDomainError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`esperava DomainError ${code}`);
}

describe('Order', () => {
  test(
    covers(
      ['method:Order.create'],
      'cria pedido pendente e emite OrderCreated',
    ),
    () => {
      const order = Order.create({ id: 'o1', customerId: 'c1', items: [item] });
      expect(order.status).toBe('pending');
      expect(order.total).toBe(20);
      const events = order.pullEvents();
      expect(events.map((e) => e.name)).toEqual(['OrderCreated']);
      expect(events[0]!.payload).toEqual({
        orderId: 'o1',
        customerId: 'c1',
        total: 20,
      });
    },
  );

  test(
    covers(['invariant:Order/ao-menos-um-item'], 'rejeita pedido sem itens'),
    () => {
      expectDomainError(
        () => Order.create({ id: 'o1', customerId: 'c1', items: [] }),
        'ORDER_WITHOUT_ITEMS',
      );
    },
  );

  test(
    covers(
      ['invariant:Order/total-nao-negativo'],
      'rejeita pedido com total negativo',
    ),
    () => {
      expectDomainError(
        () =>
          Order.create({
            id: 'o1',
            customerId: 'c1',
            items: [{ sku: 'X', quantity: 1, unitPrice: -5 }],
          }),
        'ORDER_NEGATIVE_TOTAL',
      );
    },
  );

  test(
    covers(
      ['method:Order.confirm'],
      'confirma pedido pendente e emite OrderConfirmed',
    ),
    () => {
      const order = newOrder();
      order.confirm();
      expect(order.status).toBe('confirmed');
      expect(order.pullEvents().map((e) => e.name)).toEqual(['OrderConfirmed']);
    },
  );

  test(
    covers(['method:Order.confirm'], 'não confirma pedido cancelado'),
    () => {
      const order = newOrder();
      order.cancel();
      expectDomainError(() => order.confirm(), 'ORDER_INVALID_TRANSITION');
    },
  );

  test(
    covers(
      ['method:Order.cancel'],
      'cancela pedido pendente ou confirmado e emite OrderCancelled',
    ),
    () => {
      const pending = newOrder();
      pending.cancel();
      expect(pending.status).toBe('cancelled');
      expect(pending.pullEvents().map((e) => e.name)).toEqual([
        'OrderCancelled',
      ]);
      const confirmed = newOrder();
      confirmed.confirm();
      confirmed.cancel();
      expect(confirmed.status).toBe('cancelled');
    },
  );

  test(
    covers(['method:Order.cancel'], 'não cancela pedido já cancelado'),
    () => {
      const order = newOrder();
      order.cancel();
      expectDomainError(() => order.cancel(), 'ORDER_INVALID_TRANSITION');
    },
  );
});
