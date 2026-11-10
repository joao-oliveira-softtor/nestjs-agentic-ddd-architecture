import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { FakeLlm, InMemoryEventBus } from '@agentic-ddd/testing';
import { treaty } from '@elysiajs/eden';
import {
  ERROR_CODE,
  Elysia,
  InternalServerError,
  InvalidCookieSignature,
  InvalidFileType,
  NotFoundError,
  ParseError,
  ValidationError,
  status,
} from 'elysia';
import { z } from 'zod';
import { DomainEvent, type UseCase } from '@agentic-ddd/core';
import { AgentEvent, AgentUseCase, Operator } from '@agentic-ddd/decorators';
import { AgenticError, OperatorRuntime } from '@agentic-ddd/runtime';
import { agentic } from './index';
import { CreateOrder } from '../../examples/orders/application/create-order';
import { ConfirmOrder } from '../../examples/orders/application/confirm-order';
import { CancelOrder } from '../../examples/orders/application/cancel-order';
import { InMemoryOrderRepository } from '../../examples/orders/infrastructure/in-memory-order.repository';
import { OrderOperator } from '../../examples/orders/operators/order.operator';
import { createOrdersApp, type OrdersApp } from '../../examples/orders/elysia';

// `await expect(...).rejects` trips the await-thenable lint, so settle to the message instead.
const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => 'resolved',
    (error: Error) => error.message,
  );

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
  const eventBus = new InMemoryEventBus({ record: true });
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
  const eventBus = new InMemoryEventBus({ record: true });
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
    await rejection(
      agentic({ ...base, useCases: { criar: new CreateOrder(orders) } }),
    ),
  ).toBe('Use-case key criar must match its @AgentUseCase name create_order');
  expect(
    await rejection(
      agentic({
        ...base,
        useCases: { solto: { execute: async () => ({}) } },
      }),
    ),
  ).toBe('Use-case solto is not an @AgentUseCase of the configured modules');
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
  const response = await (
    await probeApp()
  ).handle(post('/agentic/use-cases/elysia_probe', { n: '2' }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ n: 2 });
});

@AgentEvent({
  description: 'Only in tests.',
  payload: z.object({ id: z.string() }),
})
class ElysiaStrict extends DomainEvent<{ id: unknown }> {}

@AgentUseCase({
  name: 'elysia_strict',
  description: 'Publishes an event whose payload breaks its schema.',
  whenToUse: 'Only in tests.',
  input: z.object({}),
  output: z.object({}),
  uses: [],
  emits: [ElysiaStrict],
})
class Strict implements UseCase<{}, {}> {
  async execute(
    _: {},
    ctx: { publish: (batch: ElysiaStrict[]) => Promise<void> },
  ) {
    await ctx.publish([new ElysiaStrict({ id: 123 })]);
    return {};
  }
}

test('an event payload outside its @AgentEvent schema answers 500 and reaches no subscriber', async () => {
  const eventBus = new InMemoryEventBus({ record: true });
  const app = await agentic({
    root,
    modules: [{ name: 'elysia-test', path: 'src/elysia' }],
    llm: new FakeLlm([]),
    operators: [],
    eventBus,
    useCases: { elysia_strict: new Strict() },
    http: {},
  });
  const response = await app.handle(
    post('/agentic/use-cases/elysia_strict', {}),
  );
  expect(response.status).toBe(500);
  expect(eventBus.events).toEqual([]);
});

@AgentUseCase({
  name: 'elysia_hung',
  description: 'Never finishes.',
  whenToUse: 'Only in tests.',
  input: z.object({}),
  output: z.object({}),
  uses: [],
  emits: [],
})
class Hung implements UseCase<{}, {}> {
  execute(): Promise<{}> {
    return new Promise(() => {});
  }
}

test('with useCaseTimeoutMs a route whose use-case never resolves answers 504 with the code', async () => {
  const app = await agentic({
    root,
    modules: [{ name: 'elysia-test', path: 'src/elysia' }],
    llm: new FakeLlm([]),
    operators: [],
    useCaseTimeoutMs: 20,
    useCases: { elysia_hung: new Hung() },
    http: {},
  });
  const api = treaty(app);
  const response = await api.agentic['use-cases'].elysia_hung.post({});
  expect(response.status).toBe(504);
  const body = response.error?.value;
  expect(body).toMatchObject({ code: 'runtime.use-case-timeout' });
  expect((body as { message: string }).message).toContain('elysia_hung');
});

@AgentUseCase({
  name: 'elysia_nested_timeout',
  description: 'Throws the timeout of a nested use-case.',
  whenToUse: 'Only in tests.',
  input: z.object({}),
  output: z.object({}),
  uses: [],
  emits: [],
})
class NestedTimeout implements UseCase<{}, {}> {
  execute(): Promise<{}> {
    return Promise.reject(
      new AgenticError(
        'runtime.use-case-timeout',
        'Use-case inner_secret did not finish within useCaseTimeoutMs (5 ms)',
      ),
    );
  }
}

test('a timeout error thrown by the use-case itself answers 504 with the route name, not the foreign message', async () => {
  const app = await agentic({
    root,
    modules: [{ name: 'elysia-test', path: 'src/elysia' }],
    llm: new FakeLlm([]),
    operators: [],
    useCaseTimeoutMs: 1_000,
    useCases: { elysia_nested_timeout: new NestedTimeout() },
    http: {},
  });
  const api = treaty(app);
  const response = await api.agentic['use-cases'].elysia_nested_timeout.post(
    {},
  );
  expect(response.status).toBe(504);
  const body = response.error?.value as { code: string; message: string };
  expect(body.code).toBe('runtime.use-case-timeout');
  expect(body.message).toContain('elysia_nested_timeout');
  expect(body.message).not.toContain('inner_secret');
});

test('output outside its schema answers 500', async () => {
  // Number('x') is NaN, which the output schema rejects.
  const response = await (
    await probeApp()
  ).handle(post('/agentic/use-cases/elysia_probe', { n: 'x' }));
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

@AgentUseCase({
  name: 'elysia_failing',
  description: 'Fails with the error the input asks for.',
  whenToUse: 'Only in tests.',
  input: z.object({
    kind: z.enum(['not-found', 'status', 'custom', 'outside']),
  }),
  output: z.object({}),
  uses: [],
  emits: [],
})
class Failing implements UseCase<{ kind: string }, {}> {
  async execute({ kind }: { kind: string }): Promise<{}> {
    if (kind === 'not-found') throw new NotFoundError('gone');
    if (kind === 'status') throw status(418, 'teapot');
    if (kind === 'custom') throw new Clash('clash');
    // An outside HTTP client's error (AxiosError, FetchError) also carries a status.
    throw Object.assign(new Error('invalid upstream token for tenant X'), {
      status: 401,
    });
  }
}

class Clash extends Error {
  status = 409;
}

test("the app's own HTTP errors pass through unchanged", async () => {
  const plugin = await agentic({
    root,
    modules: [{ name: 'elysia-test', path: 'src/elysia' }],
    llm: new FakeLlm([]),
    operators: [],
    useCases: { elysia_failing: new Failing() },
    http: {},
  });
  const app = new Elysia().error({ Clash }).use(plugin);
  const call = async (kind: string) => {
    const response = await app.handle(
      post('/agentic/use-cases/elysia_failing', { kind }),
    );
    return [response.status, await response.text()];
  };
  expect(await call('not-found')).toEqual([404, 'gone']);
  expect(await call('status')).toEqual([418, 'teapot']);
  expect((await call('custom'))[0]).toBe(409);
});

test("an outside error's status and message never reach the client", async () => {
  const plugin = await agentic({
    root,
    modules: [{ name: 'elysia-test', path: 'src/elysia' }],
    llm: new FakeLlm([]),
    operators: [],
    useCases: { elysia_failing: new Failing() },
    http: {},
  });
  const response = await plugin.handle(
    post('/agentic/use-cases/elysia_failing', { kind: 'outside' }),
  );
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('upstream token');
});

// What elysia_throwing throws; each test sets it before its call.
let thrown: unknown;

@AgentUseCase({
  name: 'elysia_throwing',
  description: 'Throws the value the test set.',
  whenToUse: 'Only in tests.',
  input: z.object({}),
  output: z.object({}),
  uses: [],
  emits: [],
})
class Throwing implements UseCase<{}, {}> {
  async execute(): Promise<{}> {
    throw thrown;
  }
}

const throwingPlugin = () =>
  agentic({
    root,
    modules: [{ name: 'elysia-test', path: 'src/elysia' }],
    llm: new FakeLlm([]),
    operators: [],
    useCases: { elysia_throwing: new Throwing() },
    http: {},
  });

const answer = async (
  app: { handle(request: Request): Promise<Response> },
  error: unknown,
) => {
  thrown = error;
  const response = await app.handle(
    post('/agentic/use-cases/elysia_throwing', {}),
  );
  return [response.status, await response.text()] as const;
};

test('every error class Elysia exports passes through with its own status', async () => {
  const app = new Elysia().use(await throwingPlugin());
  const generic = await answer(app, new Error('plain'));
  for (const [error, code] of [
    [new InternalServerError('own 500'), 500],
    [new NotFoundError('gone'), 404],
    [new ParseError(), 400],
    [new ValidationError('body', z.object({ a: z.string() }), {}), 422],
    [new InvalidCookieSignature('session'), 400],
    [new InvalidFileType('file', 'image/png'), 422],
    [status(418, 'teapot'), 418],
  ] as const) {
    const [answered, text] = await answer(app, error);
    expect([error.constructor.name, answered]).toEqual([
      error.constructor.name,
      code,
    ]);
    expect(text).not.toBe(generic[1]);
  }
});

class UpstreamError extends Error {
  status = 401;
}
class SubClash extends Clash {}

test('.error() passes only the exact class it registered, never a subclass', async () => {
  // Registering Error marks Error.prototype for the whole process, so undo it.
  try {
    const app = new Elysia()
      .error({ Error, Clash })
      .use(await throwingPlugin());
    const upstream = await answer(
      app,
      new UpstreamError('invalid upstream token for tenant X'),
    );
    expect(upstream[0]).toBe(500);
    expect(upstream[1]).not.toContain('upstream token');
    expect((await answer(app, new Clash('clash')))[0]).toBe(409);
    expect((await answer(app, new SubClash('sub')))[0]).toBe(500);
    const raw = await answer(app, 'raw secret');
    expect(raw[0]).toBe(500);
    expect(raw[1]).not.toContain('raw secret');
    // Registering a base class is the app's choice: that exact class passes with its message.
    const plain = await answer(app, new Error('plain message'));
    expect(plain[1]).toContain('plain message');
  } finally {
    delete (Error.prototype as { [ERROR_CODE]?: string })[ERROR_CODE];
  }
});

test("the generic 500 does not serialize the original error for the app's onError", async () => {
  const seen: unknown[] = [];
  const app = new Elysia()
    .onError(({ error }) => {
      seen.push(error);
    })
    .use(await throwingPlugin());
  const original = Object.assign(new Error('upstream'), {
    config: { headers: { authorization: 'Bearer secret-token' } },
  });
  expect((await answer(app, original))[0]).toBe(500);
  const wrapped = seen[0] as Error;
  expect(wrapped.cause).toBe(original);
  expect(JSON.stringify(wrapped)).not.toContain('secret-token');
  // Spread, Object.assign and loggers copy only own enumerable keys.
  expect(Object.keys(wrapped)).not.toContain('cause');
});

test('the plugin has no parent before it is mounted', async () => {
  const plugin = (await throwingPlugin()) as unknown as {
    getParent(): unknown;
  };
  expect(plugin.getParent()).toBeNull();
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
    http: { routes: ['create_order'] },
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

test('a use-case that requires approval in an operator is mounted only when listed in http.routes', async () => {
  const mount = (http: object) => {
    const orders = new InMemoryOrderRepository();
    return agentic({
      root,
      modules,
      llm: new FakeLlm([]),
      operators: [OrderOperator],
      useCases: {
        create_order: new CreateOrder(orders),
        confirm_order: new ConfirmOrder(orders),
        cancel_order: new CancelOrder(orders),
      },
      http,
    });
  };
  expect(await rejection(mount({}))).toBe(
    'Use-case cancel_order requires approval in operator order-operator; list it in http.routes to expose it',
  );
  const safe = await mount({ routes: ['create_order', 'confirm_order'] });
  const cancel = { order_id: 'nope' };
  expect(
    (await safe.handle(post('/agentic/use-cases/cancel_order', cancel))).status,
  ).toBe(404);
  expect(
    (
      await safe.handle(
        post('/agentic/use-cases/create_order', {
          order_id: 'r-1',
          customer_id: 'c',
          items,
        }),
      )
    ).status,
  ).toBe(200);
  const explicit = await mount({ routes: ['cancel_order'] });
  expect(
    (await explicit.handle(post('/agentic/use-cases/cancel_order', cancel)))
      .status,
  ).not.toBe(404);
});

// Declared here, outside the orders module, so the runtime's scoped registry does not have it.
@Operator({
  name: 'elysia-outsider',
  description: 'Cancels orders from outside the configured modules.',
  instructions: 'Only in tests.',
  useCases: [CancelOrder],
  requiresApproval: [CancelOrder],
})
class Outsider {}

test('an operator outside the configured modules fails as not declared, before any approval check', async () => {
  const mounting = agentic({
    root,
    modules,
    llm: new FakeLlm([]),
    operators: [Outsider],
    useCases: { cancel_order: new CancelOrder(new InMemoryOrderRepository()) },
    http: {},
  });
  expect(await rejection(mounting)).toBe('Operator Outsider is not declared');
});

test('the same operator twice fails the mount, though operators register concurrently', async () => {
  const orders = new InMemoryOrderRepository();
  const mounting = agentic({
    root,
    modules,
    llm: new FakeLlm([]),
    operators: [OrderOperator, OrderOperator],
    useCases: {
      create_order: new CreateOrder(orders),
      confirm_order: new ConfirmOrder(orders),
      cancel_order: new CancelOrder(orders),
    },
  });
  expect(await rejection(mounting)).toBe('Duplicate operator order-operator');
});

test('http.routes naming a use-case that was not passed fails the mount', async () => {
  const mounting =
    // @ts-expect-error routes are keys of useCases
    agentic({
      root,
      modules,
      llm: new FakeLlm([]),
      operators: [],
      useCases: {
        create_order: new CreateOrder(new InMemoryOrderRepository()),
      },
      http: { routes: ['create_ordr'] },
    });
  expect(await rejection(mounting)).toBe(
    'http.routes names create_ordr, which is not in useCases',
  );
});

test('a second agentic() on one app fails the mount instead of shadowing the first runtime', async () => {
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
  const app = new Elysia().use(await mount('/a'));
  const second = await mount('/b');
  expect(() => app.use(second)).toThrow(
    'Mount one agentic() per app: ctx.agentic would keep the first runtime',
  );
});

describe('one agentic() per app across nested mounts', () => {
  const message =
    'Mount one agentic() per app: ctx.agentic would keep the first runtime';
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

  test('two sibling sub-apps with their own agentic() fail on the shared root', async () => {
    const first = new Elysia().use(await mount('/a'));
    const second = new Elysia().use(await mount('/b'));
    const rootApp = new Elysia().use(first);
    expect(() => rootApp.use(second)).toThrow(message);
  });

  test('siblings two levels deep still fail on the shared root', async () => {
    const first = new Elysia().use(new Elysia().use(await mount('/a')));
    const second = new Elysia().use(new Elysia().use(await mount('/b')));
    const rootApp = new Elysia().use(first);
    expect(() => rootApp.use(second)).toThrow(message);
  });

  test('one agentic() reaching the root through two sub-apps is the same runtime, not a second mount', async () => {
    const shared = new Elysia().use(await mount('/a'));
    const v1 = new Elysia({ prefix: '/v1' }).use(shared);
    const v2 = new Elysia({ prefix: '/v2' }).use(shared);
    const rootApp = new Elysia().use(v1);
    expect(() => rootApp.use(v2)).not.toThrow();
  });

  test('a second agentic() inside .group() fails the mount', async () => {
    const app = new Elysia().use(await mount('/a'));
    const second = await mount('/b');
    expect(() => app.group('/g', (group) => group.use(second))).toThrow(
      message,
    );
  });

  test('a second agentic() inside .guard() fails the mount', async () => {
    const app = new Elysia().use(await mount('/a'));
    const second = await mount('/b');
    expect(() => app.guard({}, (guard) => guard.use(second))).toThrow(message);
  });

  test('a second agentic() inside a function plugin fails the mount', async () => {
    const app = new Elysia().use(await mount('/a'));
    const second = await mount('/b');
    expect(() => app.use((inner) => inner.use(second))).toThrow(message);
  });

  test('one agentic() in a sub-app mounted on a root still serves its route', async () => {
    const sub = new Elysia().use(await mount('/a'));
    const response = await new Elysia().use(sub).handle(
      post('/a/use-cases/create_order', {
        order_id: 'nest-1',
        customer_id: 'c',
        items,
      }),
    );
    expect(response.status).toBe(200);
  });
});
