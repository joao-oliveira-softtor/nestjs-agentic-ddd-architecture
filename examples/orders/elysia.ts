import { agentic } from '@agentic-ddd/elysia';
import type { ApprovalPort, EventBus, LlmPort } from '@agentic-ddd/runtime';
import { Elysia } from 'elysia';
import { CancelOrder } from './application/cancel-order';
import { ConfirmOrder } from './application/confirm-order';
import { CreateOrder } from './application/create-order';
import { InMemoryOrderRepository } from './infrastructure/in-memory-order.repository';
import { OrderOperator } from './operators/order.operator';

export interface OrdersAppOptions {
  llm: LlmPort;
  approval?: ApprovalPort;
  eventBus?: EventBus;
  root?: string;
}

/** The same decorated domain as OrdersModule, mounted on Elysia. */
export async function createOrdersApp(options: OrdersAppOptions) {
  const orders = new InMemoryOrderRepository();
  const app = new Elysia().use(
    await agentic({
      ...options,
      modules: [{ name: 'orders', path: 'examples/orders' }],
      operators: [OrderOperator],
      useCases: {
        create_order: new CreateOrder(orders),
        confirm_order: new ConfirmOrder(orders),
        cancel_order: new CancelOrder(orders),
      },
      http: {},
    }),
  );
  return { app, orders };
}

export type OrdersApp = Awaited<ReturnType<typeof createOrdersApp>>['app'];
