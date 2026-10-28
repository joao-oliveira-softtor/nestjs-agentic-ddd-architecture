import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { FakeLlm, InMemoryEventBus } from '@agentic-ddd/testing';
import { treaty } from '@elysiajs/eden';
import { Elysia } from 'elysia';
import { z } from 'zod';
import type { UseCase } from '@agentic-ddd/core';
import { AgentUseCase } from '@agentic-ddd/decorators';
import { OperatorRuntime } from '@agentic-ddd/runtime';
import { agentic } from './index';
import { CreateOrder } from '../../examples/orders/application/create-order';
import { ConfirmOrder } from '../../examples/orders/application/confirm-order';
import { CancelOrder } from '../../examples/orders/application/cancel-order';
import { InMemoryOrderRepository } from '../../examples/orders/infrastructure/in-memory-order.repository';
import { OrderOperator } from '../../examples/orders/operators/order.operator';
import {
  createOrdersApp,
  type OrdersApp,
} from '../../examples/orders/elysia';

const root = resolve(import.meta.dir, '../..');
const modules = [{ name: 'orders', path: 'examples/orders' }];
const items = [{ sku: 'sku', quantity: 1, unit_price: 10 }];
const post = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('the decorated runtime runs the operator, which gets no HTTP route (ADR-0007 D5)', async () => {
  const llm = new FakeLlm([
    {
      content: [
        {
          type: 'tool_call',
          id: 'create',
          name: 'create_order',
          input: { order_id: 'ely-1', customer_id: 'c', items },
        },
      ],
      stopReason: 'tool_calls',
    },
    { content: [{ type: 'text', text: 'Criado.' }], stopReason: 'end' },
  ]);
  const eventBus = new InMemoryEventBus();
  const { app, orders } = await createOrdersApp({ root, llm, eventBus });
  const result = await app.decorator.agentic.run('order-operator', {
    message: 'Crie o pedido',
  });
  expect(result.status).toBe('completed');
  expect(result.events.map((e) => e.name)).toEqual(['OrderCreated']);
  expect(eventBus.events.map((e) => e.name)).toEqual(['OrderCreated']);
  expect((await orders.findById('ely-1'))?.total).toBe(10);
  expect(
    (
      await app.handle(
        post('/agentic/operators/order-operator/runs', { message: 'x' }),
      )
    ).status,
  ).toBe(404);
});

test('use-case route through Eden: typed, publishes the event and maps DomainError', async () => {
  const eventBus = new InMemoryEventBus();
  const { app } = await createOrdersApp({
    root,
    llm: new FakeLlm([]),
    eventBus,
  });
  const api = treaty<OrdersApp>(app);
  const created = await api.agentic['use-cases'].create_order.post({
    order_id: 'eden-1',
    customer_id: 'c',
    items,
  });
  expect(created.status).toBe(200);
  const data: { order_id: string; status: 'pending'; total: number } | null =
    created.data;
  expect(data).toEqual({ order_id: 'eden-1', status: 'pending', total: 10 });
  expect(eventBus.events.map((e) => e.name)).toEqual(['OrderCreated']);

  const duplicate = await api.agentic['use-cases'].create_order.post({
    order_id: 'eden-1',
    customer_id: 'c',
    items,
  });
  expect(duplicate.status).toBe(422);
  const domain = duplicate.error?.value;
  if (!domain || !('code' in domain)) throw new Error('expected a DomainError');
  expect(domain.code).toBe('ORDER_ALREADY_EXISTS');

  const invalid = await api.agentic['use-cases'].create_order.post({
    order_id: '',
    customer_id: 'c',
    // @ts-expect-error quantity must be a number: the body type comes from the use-case's UseCase<I, O> generics
    items: [{ sku: 'sku', quantity: '1', unit_price: 10 }],
  });
  expect(invalid.status).toBe(422);
  const validation = invalid.error?.value;
  if (!validation || 'code' in validation)
    throw new Error('expected a validation error');
  expect(validation.type).toBe('validation');
  expect(validation.on).toBe('body');
  expect(eventBus.events).toHaveLength(1);
});

test('mounting fails when the key is not the @AgentUseCase name or the value is not decorated', async () => {
  const orders = new InMemoryOrderRepository();
  const base = { root, modules, llm: new FakeLlm([]), operators: [] };
  expect(
    agentic({ ...base, useCases: { criar: new CreateOrder(orders) } }),
  ).rejects.toThrow(
    'Use-case key criar must match its @AgentUseCase name create_order',
  );
  expect(
    agentic({
      ...base,
      useCases: { solto: { execute: async () => ({}) } },
    }),
  ).rejects.toThrow(
    'Use-case solto is not an @AgentUseCase of the configured modules',
  );
});

test('without http it only decorates the runtime, with an in-memory bus', async () => {
  const orders = new InMemoryOrderRepository();
  const plugin = await agentic({
    root,
    modules,
    llm: new FakeLlm([]),
    operators: [OrderOperator],
    useCases: {
      create_order: new CreateOrder(orders),
      confirm_order: new ConfirmOrder(orders),
      cancel_order: new CancelOrder(orders),
    },
  });
  const runtime = plugin.decorator.agentic;
  expect(runtime).toBeInstanceOf(OperatorRuntime);
  expect(runtime.eventBus).toBeInstanceOf(InMemoryEventBus);
  expect(
    (
      await plugin.handle(
        post('/agentic/use-cases/create_order', {
          order_id: 'x',
          customer_id: 'c',
          items,
        }),
      )
    ).status,
  ).toBe(404);
});

@AgentUseCase({
  name: 'elysia_probe',
  description: 'Converts n from text to a number.',
  whenToUse: 'Only in tests.',
  input: z.object({ n: z.string().transform(Number) }),
  output: z.object({ n: z.number() }),
  uses: [],
  emits: [],
})
class Probe implements UseCase<{ n: number }, { n: number }> {
  async execute(input: { n: number }) {
    return { n: input.n };
  }
}

const probeApp = () =>
  agentic({
    root,
    modules: [{ name: 'elysia-test', path: 'src/elysia' }],
    llm: new FakeLlm([]),
    operators: [],
    useCases: { elysia_probe: new Probe() },
    http: {},
  });

test('transformed input: the route answers with the converted value', async () => {
  const response = await (await probeApp()).handle(
    post('/agentic/use-cases/elysia_probe', { n: '2' }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ n: 2 });
});

test('output outside its schema answers 500', async () => {
  // Number('x') is NaN, which the output schema rejects.
  const response = await (await probeApp()).handle(
    post('/agentic/use-cases/elysia_probe', { n: 'x' }),
  );
  expect(response.status).toBe(500);
});

@AgentUseCase({
  name: 'elysia_leaky',
  description: 'Always fails with an internal detail.',
  whenToUse: 'Only in tests.',
  input: z.object({}),
  output: z.object({}),
  uses: [],
  emits: [],
})
class Leaky implements UseCase<{}, {}> {
  async execute(): Promise<{}> {
    throw new Error('secret detail');
  }
}

test('an unexpected error answers a generic 500 and the app onError still sees the original', async () => {
  const seen: unknown[] = [];
  const plugin = await agentic({
    root,
    modules: [{ name: 'elysia-test', path: 'src/elysia' }],
    llm: new FakeLlm([]),
    operators: [],
    useCases: { elysia_leaky: new Leaky() },
    http: {},
  });
  const app = new Elysia()
    .onError(({ error }) => {
      seen.push(error);
    })
    .use(plugin);
  const response = await app.handle(
    post('/agentic/use-cases/elysia_leaky', {}),
  );
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('secret detail');
  expect((seen[0] as Error).cause).toMatchObject({ message: 'secret detail' });
});

test('a subclass of a declared use-case mounts under the declared name', async () => {
  class LoggingCreateOrder extends CreateOrder {}
  const plugin = await agentic({
    root,
    modules,
    llm: new FakeLlm([]),
    operators: [OrderOperator],
    useCases: {
      create_order: new LoggingCreateOrder(new InMemoryOrderRepository()),
      confirm_order: new ConfirmOrder(new InMemoryOrderRepository()),
      cancel_order: new CancelOrder(new InMemoryOrderRepository()),
    },
    http: {},
  });
  const body = { order_id: 'sub-1', customer_id: 'c', items };
  expect(
    (await plugin.handle(post('/agentic/use-cases/create_order', body))).status,
  ).toBe(200);
});

test("prefix '/' means no prefix", async () => {
  const plugin = await agentic({
    root,
    modules,
    llm: new FakeLlm([]),
    operators: [],
    useCases: { create_order: new CreateOrder(new InMemoryOrderRepository()) },
    http: { prefix: '/' },
  });
  const body = { order_id: 'root-1', customer_id: 'c', items };
  expect(
    (await plugin.handle(post('/use-cases/create_order', body))).status,
  ).toBe(200);
  // The Eden path follows the runtime path: no prefix segment.
  const created = await treaty(plugin)['use-cases'].create_order.post(body);
  expect(created.status).toBe(422);
});

test('an http option typed as possibly undefined type-checks', async () => {
  const cond = Math.random() > 2;
  const plugin = await agentic({
    root,
    modules,
    llm: new FakeLlm([]),
    operators: [],
    useCases: { create_order: new CreateOrder(new InMemoryOrderRepository()) },
    http: cond ? {} : undefined,
  });
  expect(plugin.decorator.agentic).toBeInstanceOf(OperatorRuntime);
});

test('two plugins with different prefixes on one app both answer', async () => {
  const mount = (prefix: string) =>
    agentic({
      root,
      modules,
      llm: new FakeLlm([]),
      operators: [],
      useCases: {
        create_order: new CreateOrder(new InMemoryOrderRepository()),
      },
      http: { prefix },
    });
  const app = new Elysia().use(await mount('/a')).use(await mount('/b'));
  const body = { order_id: 'p-1', customer_id: 'c', items };
  expect(
    (await app.handle(post('/a/use-cases/create_order', body))).status,
  ).toBe(200);
  expect(
    (await app.handle(post('/b/use-cases/create_order', body))).status,
  ).toBe(200);
});
