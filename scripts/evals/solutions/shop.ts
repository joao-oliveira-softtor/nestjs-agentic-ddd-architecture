import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Test-only solutions for the `shop` fixture of the bundle rehearsal (#122): what a scripted executor
 * writes for each item of the applied skeleton. `edits` replace exact skeleton text in `file`.
 */
interface Edit {
  from: string;
  to: string;
}
interface ShopSolution {
  file: string;
  edits: Edit[];
  test: string;
}

const ORDER = 'src/shop/domain/order.ts';
const withBody = (signature: string, body: string): Edit => ({
  from: `${signature} {\n    return notImplemented();\n  }`,
  to: `${signature} {\n${body}\n  }`,
});

const testFile = (item: string) =>
  `src/shop/${item.replaceAll(/[:.]/g, '-')}.test.ts`;

// The fixture Delta declares no way to create an order, and the inherited constructor is protected.
const header = (
  covered: string,
  title: string,
) => `import { expect, test } from 'bun:test';
import { covers } from '@agentic-ddd/testing';
import { Order } from './domain/order';
// @ts-expect-error protected constructor
const open = (id: string): Order => new Order(id);
test(covers([${covered}], '${title}'), () => {`;

export const SHOP_SOLUTIONS: Record<string, ShopSolution> = {
  'entity:Order': {
    file: ORDER,
    edits: [
      {
        from: "import { AggregateRoot, notImplemented } from '@agentic-ddd/core';",
        to: "import { AggregateRoot, DomainError, notImplemented } from '@agentic-ddd/core';",
      },
      {
        from: 'export class Order extends AggregateRoot<string> {\n',
        to: "export class Order extends AggregateRoot<string> {\n  #status: 'open' | 'paid' = 'open';\n  #paid = false;\n\n  get status(): 'open' | 'paid' {\n    return this.#status;\n  }\n\n  // paid-once: a refund reopens the order, but it can never be paid a second time. A setter, because a\n  // protected helper counts as a public method without @AgentMethod and the entity item must test the\n  // invariant before the pay item exists.\n  set status(next: 'open' | 'paid') {\n    if (next === 'paid' && this.#paid) throw new DomainError('ORDER_ALREADY_PAID', 'Order was already paid.');\n    this.#paid ||= next === 'paid';\n    this.#status = next;\n  }\n\n",
      },
    ],
    test: `${header("'invariant:Order/paid-once'", 'a new order is open and a second payment is refused')}
  const order = open('o1');
  expect(order.status).toBe('open');
  expect(order.pullEvents()).toEqual([]);
  order.status = 'paid';
  order.status = 'open';
  expect(() => {
    order.status = 'paid';
  }).toThrow('Order was already paid.');
});
`,
  },
  'method:Order.pay': {
    file: ORDER,
    edits: [
      withBody(
        '  pay(): void',
        "    this.status = 'paid';\n    this.record(new OrderPaid({}));",
      ),
    ],
    test: `${header("'method:Order.pay'", 'pays an open order, records the event and refuses a second payment')}
  const order = open('o1');
  order.pay();
  expect(order.status).toBe('paid');
  expect(order.pullEvents().map((e) => e.name)).toEqual(['OrderPaid']);
  expect(() => order.pay()).toThrow('Order was already paid.');
});
`,
  },
  'method:Order.refund': {
    file: ORDER,
    edits: [
      withBody(
        '  refund(reason?: string): void',
        "    if (this.#status !== 'paid') throw new DomainError('ORDER_NOT_PAID', 'Order is not paid.');\n    this.#status = 'open';\n    this.record(new OrderRefunded({ orderId: this.id }));",
      ),
    ],
    test: `${header("'method:Order.refund', 'invariant:Order/refund-needs-paid'", 'refunds a paid order, refuses an open one and never lets a refunded order be paid again')}
  const order = open('o1');
  expect(() => order.refund()).toThrow('Order is not paid.');
  order.pay();
  order.pullEvents();
  order.refund();
  expect(order.status).toBe('open');
  expect(() => order.pay()).toThrow('Order was already paid.');
  expect(order.pullEvents().map((e) => [e.name, e.payload])).toEqual([['OrderRefunded', { orderId: 'o1' }]]);
});
`,
  },
  'usecase:pay_order': {
    file: 'src/shop/application/pay-order.ts',
    edits: [
      {
        from: "import { OrderPaid, OrderRefunded } from '../domain/order.events';",
        to: "import { Order } from '../domain/order';\nimport { OrderPaid, OrderRefunded } from '../domain/order.events';",
      },
      withBody(
        '  async execute(_input: PayOrderInput, _ctx: UseCaseContext): Promise<PayOrderOutput>',
        "    // @ts-expect-error protected constructor\n    const order = new Order('order-1');\n    order.pay();\n    order.refund();\n    await _ctx.publish(order.pullEvents());\n    return {};",
      ),
    ],
    test: `import { expect, test } from 'bun:test';
import { covers, createTestContext } from '@agentic-ddd/testing';
import { PayOrder } from './application/pay-order';
test(covers(['usecase:pay_order'], 'pays and refunds an order and publishes both events'), async () => {
  const ctx = createTestContext();
  expect(await new PayOrder().execute({}, ctx)).toEqual({});
  expect(ctx.published.map((e) => e.name)).toEqual(['OrderPaid', 'OrderRefunded']);
});
`,
  },
};

/** Writes the solution of `item` into the applied project at `root`. */
export async function implementShopItem(root: string, item: string) {
  const solution = SHOP_SOLUTIONS[item];
  if (!solution) throw new Error(`No shop solution: ${item}`);
  const path = join(root, solution.file);
  let source = await readFile(path, 'utf8');
  for (const { from, to } of solution.edits) {
    if (!source.includes(from))
      throw new Error(`Skeleton text not found for ${item}: ${from}`);
    source = source.replace(from, to);
  }
  await writeFile(path, source);
  await writeFile(join(root, testFile(item)), solution.test);
}
