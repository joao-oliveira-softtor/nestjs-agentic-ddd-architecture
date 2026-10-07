import { describe, expect, test } from 'bun:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { z, type ZodType } from 'zod';
import { defaultRegistry } from '@agentic-ddd/decorators';
import { confirmOrderInput } from '../../examples/orders/application/confirm-order';
import { createOrderInput, createOrderOutput } from '../../examples/orders/application/create-order';
import { OrderCreated } from '../../examples/orders/domain/order.events';

const ajv = new Ajv2020({ strict: false });

interface Case {
  readonly name: string;
  readonly schema: ZodType;
  readonly io: 'input' | 'output';
  readonly samples: readonly unknown[];
}

const item = { sku: 'SKU-1', quantity: 2, unit_price: 10 };

const cases: Case[] = [
  {
    name: 'create_order input',
    schema: createOrderInput,
    io: 'input',
    samples: [
      { order_id: 'o1', customer_id: 'c1', items: [item] },
      { order_id: 'o1', customer_id: 'c1', items: [item], extra: true },
      { order_id: '', customer_id: 'c1', items: [item] },
      { order_id: 'o1', customer_id: 'c1', items: [] },
      { order_id: 'o1', customer_id: 'c1', items: [{ ...item, quantity: 0 }] },
      { order_id: 'o1', customer_id: 'c1', items: [{ ...item, quantity: 1.5 }] },
      { order_id: 'o1', customer_id: 'c1', items: [{ ...item, unit_price: -1 }] },
      { order_id: 'o1', items: [item] },
      'texto',
      null,
    ],
  },
  {
    name: 'create_order output',
    schema: createOrderOutput,
    io: 'output',
    samples: [
      { order_id: 'o1', status: 'pending', total: 20 },
      { order_id: 'o1', status: 'confirmed', total: 20 },
      { order_id: 'o1', status: 'pending' },
    ],
  },
  {
    name: 'confirm_order input',
    schema: confirmOrderInput,
    io: 'input',
    samples: [{ order_id: 'o1' }, { order_id: '' }, {}, { order_id: 1 }],
  },
  {
    name: 'OrderCreated payload',
    schema: defaultRegistry.events.find((e) => e.target === OrderCreated)!.payload,
    io: 'output',
    samples: [
      { orderId: 'o1', customerId: 'c1', total: 20 },
      { orderId: 'o1', customerId: 'c1' },
      { orderId: 'o1', customerId: 'c1', total: '20' },
    ],
  },
  {
    name: 'input com default e transform',
    schema: z.object({ a: z.string().default('x'), b: z.string().transform((s) => s.length) }),
    io: 'input',
    samples: [{ b: 'abc' }, { a: 'y', b: 'abc' }, { a: 1, b: 'abc' }, {}],
  },
];

describe('JSON Schema gerado ≡ Zod', () => {
  for (const c of cases) {
    test(`${c.name}: aceita e rejeita as mesmas amostras`, () => {
      const validate = ajv.compile(z.toJSONSchema(c.schema, { io: c.io }));
      const disagreements = c.samples.filter((sample) => validate(sample) !== c.schema.safeParse(sample).success);
      expect(disagreements).toEqual([]);
    });
  }
});
