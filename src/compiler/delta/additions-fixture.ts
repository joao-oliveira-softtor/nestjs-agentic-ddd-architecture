import { DEFAULT_CONVENTIONS } from '../conventions';
import type { IR } from '../ir';
import { renderDelta, type RenderedFile } from './render';
import type { Delta } from './schema';
import { splice, type Fragment } from './splice';

// eslint-disable-next-line unicorn/no-thenable
const ex = () => [{ given: 'g', when: 'w', then: 't' }];

/** A module with one entity, one event and one use-case, to be extended by `additionDelta`. */
export function baseDelta(): Delta {
  return {
    module: 'shop',
    entities: [
      {
        name: 'Order',
        description: 'An order.',
        states: ['open', 'paid'],
        invariants: [],
        methods: [
          {
            name: 'pay',
            description: 'Pays the order.',
            params: [],
            returns: 'void',
            transition: { from: ['open'], to: 'paid' },
            emits: ['OrderPaid'],
          },
        ],
      },
    ],
    valueObjects: [],
    ports: [],
    events: [
      { name: 'OrderPaid', entity: 'Order', description: 'Paid.', payload: [] },
    ],
    useCases: [
      {
        name: 'pay_order',
        description: 'Pays an order.',
        whenToUse: 'When paying.',
        input: [],
        output: [],
        uses: ['method:Order.pay'],
        emits: ['OrderPaid'],
      },
    ],
  };
}

export const BASE_FILES = [
  'domain/order.ts',
  'domain/order.events.ts',
  'application/pay-order.ts',
];

/** The IR a compile of `baseDelta` would produce, as far as the Delta validator and renderer read it. */
export function baseIR(): IR {
  const src = (p: string) => `src/shop/${p}:3`;
  return {
    irVersion: 1,
    modules: [{ name: 'shop', path: 'src/shop' }],
    entities: [
      {
        id: 'entity:Order',
        name: 'Order',
        module: 'shop',
        description: 'x',
        states: ['open', 'paid'],
        invariants: [],
        methods: [
          {
            id: 'method:Order.pay',
            name: 'pay',
            static: false,
            description: 'x',
            transition: null,
            emits: ['event:OrderPaid'],
            source: src('domain/order.ts'),
          },
        ],
        contains: [],
        source: src('domain/order.ts'),
      },
    ],
    valueObjects: [],
    events: [
      {
        id: 'event:OrderPaid',
        name: 'OrderPaid',
        module: 'shop',
        description: 'x',
        payloadSchema: {},
        source: src('domain/order.events.ts'),
      },
    ],
    ports: [],
    adapters: [],
    useCases: [
      {
        id: 'usecase:pay_order',
        name: 'pay_order',
        module: 'shop',
        description: 'x',
        whenToUse: 'x',
        whenNotToUse: null,
        inputSchema: {},
        outputSchema: {},
        uses: ['method:Order.pay'],
        emits: ['event:OrderPaid'],
        source: src('application/pay-order.ts'),
      },
    ],
    operators: [],
  };
}

export const HOSTILE = "'); process.exit(); ('${1+1}`\u2028\u202e";

export function additionDelta(text = 'Refunds a paid order.'): Delta {
  return {
    module: 'shop',
    entityAdditions: [
      {
        entity: 'Order',
        invariants: [
          {
            id: 'paid-once',
            text,
            // eslint-disable-next-line unicorn/no-thenable
            examples: [{ given: text, when: text, then: text }],
          },
        ],
        methods: [
          {
            name: 'refund',
            description: text,
            params: [{ name: 'reason?', type: 'string' }],
            returns: 'void',
            transition: { from: ['paid'], to: 'open' },
            emits: ['OrderRefunded'],
            invariants: [
              { id: 'refund-needs-paid', text, examples: [...ex()] },
            ],
          },
        ],
      },
    ],
    useCaseAdditions: [
      {
        useCase: 'pay_order',
        uses: ['method:Order.refund'],
        emits: ['OrderRefunded'],
      },
    ],
    entities: [],
    valueObjects: [],
    ports: [],
    events: [
      {
        name: 'OrderRefunded',
        entity: 'Order',
        description: text,
        payload: [{ name: 'orderId', type: 'string' }],
      },
    ],
    useCases: [],
  };
}

/** Renders the base, then the additions, and splices every fragment into the base files. */
export function spliceScenario(delta: Delta = additionDelta()): {
  readonly base: readonly RenderedFile[];
  readonly fragments: readonly Fragment[];
  readonly spliced: RenderedFile[];
} {
  const conventions = DEFAULT_CONVENTIONS;
  const first = renderDelta(baseDelta(), { conventions, existingFiles: [] });
  if (!first.ok) throw new Error(JSON.stringify(first.errors));
  const next = renderDelta(delta, {
    conventions,
    base: baseIR(),
    existingFiles: BASE_FILES,
  });
  if (!next.ok) throw new Error(JSON.stringify(next.errors));
  const spliced = first.files.map((f): RenderedFile => {
    let content = f.content;
    for (const frag of next.fragments.filter((x) => x.path === f.path)) {
      const r = splice(content, frag);
      if (!r.ok) throw new Error(JSON.stringify(r.error));
      content = r.source;
    }
    return { path: f.path, content };
  });
  return { base: first.files, fragments: next.fragments, spliced };
}
