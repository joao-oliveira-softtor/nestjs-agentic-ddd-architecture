import 'reflect-metadata';
import { expect, test } from 'bun:test';
import { Test } from '@nestjs/testing';
import { OperatorRuntime } from '@agentic-ddd/runtime';
import { FakeLlm, FakeApproval, InMemoryEventBus } from '@agentic-ddd/testing';
import { AgenticModule, LLM_PORT, APPROVAL_PORT, EVENT_BUS } from './index';
import {
  OrdersModule,
  ORDER_REPOSITORY,
} from '../../examples/orders/orders.module';
import { InMemoryOrderRepository } from '../../examples/orders/infrastructure/in-memory-order.repository';
import { CreateOrder } from '../../examples/orders/application/create-order';

const root = new URL('../../', import.meta.url).pathname;
const modules = [{ name: 'orders', path: 'examples/orders' }];
test('TestingModule resolves ports, repository, injected use-cases and runtime by name', async () => {
  const llm = new FakeLlm([
    {
      content: [
        {
          type: 'tool_call',
          id: 'create',
          name: 'create_order',
          input: {
            order_id: 'nest-1',
            customer_id: 'c',
            items: [{ sku: 'sku', quantity: 1, unit_price: 10 }],
          },
        },
      ],
      stopReason: 'tool_calls',
    },
    { content: [{ type: 'text', text: 'Criado.' }], stopReason: 'end' },
  ]);
  const approval = new FakeApproval(true);
  const eventBus = new InMemoryEventBus();
  const module = await Test.createTestingModule({
    imports: [
      AgenticModule.forRoot({ root, modules, llm, approval, eventBus }),
      OrdersModule,
    ],
  }).compile();
  try {
    expect(module.get<FakeLlm>(LLM_PORT)).toBe(llm);
    expect(module.get<FakeApproval>(APPROVAL_PORT)).toBe(approval);
    expect(module.get<InMemoryEventBus>(EVENT_BUS)).toBe(eventBus);
    expect(module.get(CreateOrder)).toBeInstanceOf(CreateOrder);
    const runtime = module.get(OperatorRuntime);
    expect(runtime.eventBus).toBe(eventBus);
    const result = await runtime.run('order-operator', {
      message: 'Crie o pedido',
    });
    expect(result.status).toBe('completed');
    const repo = module.get<InMemoryOrderRepository>(ORDER_REPOSITORY);
    expect((await repo.findById('nest-1'))?.total).toBe(10);
    expect(result.events.map((e) => e.name)).toEqual(['OrderCreated']);
  } finally {
    await module.close();
  }
});

test('root defaults to deny approval and an in-memory bus', async () => {
  const module = await Test.createTestingModule({
    imports: [
      AgenticModule.forRoot({ root, modules, llm: new FakeLlm([]) }),
      OrdersModule,
    ],
  }).compile();
  try {
    expect(
      await module
        .get(APPROVAL_PORT)
        .request({ operator: 'x', runId: 'y', useCase: 'z', input: {} }),
    ).toMatchObject({ approved: false });
    expect(module.get<InMemoryEventBus>(EVENT_BUS)).toBeInstanceOf(
      InMemoryEventBus,
    );
  } finally {
    await module.close();
  }
});
