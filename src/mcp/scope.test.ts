import { describe, expect, test } from 'bun:test';
import type { DomainLock } from '../compiler/lock';
import type { Rule } from '../compiler/rules';
import { narrowRulePaths, pathModule, scopeLock } from './scope';

const inv = (id: string, on: string | null = null) => ({
  id,
  text: 'rule',
  on,
  source: 'x.ts:1',
});
const base = (module: string, name: string, prefix: string) => ({
  id: `${prefix}:${name}`,
  name,
  module,
  description: `${name} description`,
  source: 'x.ts:1',
});
const schema = {};

// Two modules: orders (A) and billing (B), with relations crossing both ways.
const lock: DomainLock = {
  lockVersion: 1,
  ir: {
    irVersion: 1,
    modules: [
      { name: 'orders', path: 'examples/orders' },
      { name: 'billing', path: 'examples/billing' },
      { name: 'orders-deep', path: 'examples/orders/deep' },
    ],
    entities: [
      {
        ...base('orders', 'Order', 'entity'),
        states: [],
        invariants: [inv('invariant:Order/a', 'method:Order.pay')],
        methods: [
          {
            id: 'method:Order.pay',
            name: 'pay',
            static: false,
            description: 'pay',
            transition: null,
            emits: ['event:OrderPaid', 'event:InvoiceIssued'],
            source: 'x.ts:1',
          },
        ],
        contains: ['entity:Line', 'entity:Invoice'],
        references: ['entity:Invoice'],
      },
      {
        ...base('orders', 'Line', 'entity'),
        states: [],
        invariants: [],
        methods: [],
      },
      {
        ...base('billing', 'Invoice', 'entity'),
        states: [],
        invariants: [inv('invariant:Invoice/secret')],
        methods: [
          {
            id: 'method:Invoice.issue',
            name: 'issue',
            static: false,
            description: 'issue',
            transition: null,
            emits: ['event:InvoiceIssued'],
            source: 'x.ts:1',
          },
        ],
        contains: ['entity:Order'],
      },
    ],
    valueObjects: [
      {
        ...base('billing', 'Money', 'valueobject'),
        invariants: [inv('invariant:Money/positive')],
      },
    ],
    events: [
      { ...base('orders', 'OrderPaid', 'event'), payloadSchema: schema },
      { ...base('billing', 'InvoiceIssued', 'event'), payloadSchema: schema },
    ],
    ports: [
      {
        ...base('orders', 'OrderRepo', 'port'),
        root: 'entity:Invoice',
        methods: [],
      },
    ],
    adapters: [
      {
        ...base('billing', 'InvoiceRepoImpl', 'adapter'),
        implements: 'port:OrderRepo',
      },
    ],
    useCases: [
      {
        ...base('orders', 'pay_order', 'usecase'),
        whenToUse: 'when',
        whenNotToUse: null,
        inputSchema: schema,
        outputSchema: schema,
        uses: ['method:Order.pay', 'method:Invoice.issue'],
        emits: ['event:OrderPaid', 'event:InvoiceIssued'],
        ports: ['port:OrderRepo', 'port:Missing'],
        invariants: [inv('invariant:pay_order/x')],
      },
      {
        ...base('billing', 'bill', 'usecase'),
        whenToUse: 'when',
        whenNotToUse: null,
        inputSchema: schema,
        outputSchema: schema,
        uses: ['method:Invoice.issue'],
        emits: [],
      },
    ],
    operators: [
      {
        ...base('orders', 'order-operator', 'operator'),
        instructions: 'do',
        useCases: ['usecase:pay_order', 'usecase:bill'],
        requiresApproval: ['usecase:bill'],
        limits: { maxSteps: 1, timeoutMs: 1 },
        model: 'm',
      },
      {
        ...base('billing', 'billing-operator', 'operator'),
        instructions: 'do',
        useCases: ['usecase:bill'],
        requiresApproval: [],
        limits: { maxSteps: 1, timeoutMs: 1 },
        model: 'm',
      },
    ],
  },
  changes: [],
};

const item = (id: string, module: string) => ({
  id,
  kind: 'added' as const,
  classification: 'behavioral' as const,
  module,
});
const change = (id: string, items: ReturnType<typeof item>[]) => ({
  id,
  title: id,
  path: `changes/${id}/proposal.md`,
  summary: 's',
  hash: 'h',
  items,
});

const orders = new Set(['orders']);
const scoped = scopeLock(lock, orders);

describe('scopeLock', () => {
  test("returns the same lock for 'all'", () => {
    expect(scopeLock(lock, 'all')).toBe(lock);
  });

  test('hides the other module from every list', () => {
    expect(scoped.ir.modules.map((m) => m.name)).toEqual(['orders']);
    const { ir } = scoped;
    const ids = [
      ...ir.entities,
      ...(ir.valueObjects ?? []),
      ...ir.events,
      ...(ir.ports ?? []),
      ...(ir.adapters ?? []),
      ...ir.useCases,
      ...ir.operators,
    ].map((x) => x.id);
    expect(ids).toEqual([
      'entity:Order',
      'entity:Line',
      'event:OrderPaid',
      'port:OrderRepo',
      'usecase:pay_order',
      'operator:order-operator',
    ]);
  });

  test('keeps an optional list absent when the lock has none, empty when filtered out', () => {
    expect(scoped.ir.valueObjects).toEqual([]);
    expect(scoped.ir.adapters).toEqual([]);
    const { valueObjects: _, ...irWithout } = lock.ir;
    const noOptional = scopeLock({ ...lock, ir: irWithout }, orders);
    expect('valueObjects' in noOptional.ir).toBe(false);
  });

  test('removes relation ids that point into the hidden module', () => {
    const [order, line] = scoped.ir.entities;
    expect(order?.contains).toEqual(['entity:Line']);
    expect(order?.references).toBeUndefined();
    expect(order?.methods[0]?.emits).toEqual(['event:OrderPaid']);
    expect(line?.contains).toBeUndefined();
    const [useCase] = scoped.ir.useCases;
    expect(useCase?.uses).toEqual(['method:Order.pay']);
    expect(useCase?.emits).toEqual(['event:OrderPaid']);
    expect(useCase?.ports).toEqual(['port:OrderRepo']);
    const [operator] = scoped.ir.operators;
    expect(operator?.useCases).toEqual(['usecase:pay_order']);
    expect(operator?.requiresApproval).toEqual([]);
  });

  test('blanks the single-id fields that point into the hidden module', () => {
    expect(scoped.ir.ports?.[0]?.root).toBe('');
    const billing = scopeLock(lock, new Set(['billing']));
    expect(billing.ir.adapters?.[0]?.implements).toBe('');
  });

  test('never serializes an id from the hidden module', () => {
    const text = JSON.stringify(scoped);
    for (const hidden of ['Invoice', 'billing', 'Money', 'bill']) {
      expect(text.includes(hidden)).toBe(false);
    }
  });

  test('a module scope naming no module yields an empty lock', () => {
    const empty = scopeLock(lock, new Set(['ghost']));
    expect(empty.ir.modules).toEqual([]);
    expect(empty.ir.entities).toEqual([]);
    expect(empty.ir.useCases).toEqual([]);
  });

  test('keeps a change only when every item is in scope', () => {
    const withChanges: DomainLock = {
      ...lock,
      changes: [
        change('0001-all-in', [item('entity:Order', 'orders')]),
        change('0002-mixed', [
          item('entity:Order', 'orders'),
          item('entity:Invoice', 'billing'),
        ]),
        change('0003-other', [item('entity:Invoice', 'billing')]),
        change('0004-empty', []),
      ],
    };
    expect(scopeLock(withChanges, orders).changes.map((c) => c.id)).toEqual([
      '0001-all-in',
    ]);
    expect(scopeLock(withChanges, 'all').changes).toHaveLength(4);
  });

  test('does not mutate its input', () => {
    const deepFreeze = (value: unknown): void => {
      if (value === null || typeof value !== 'object') return;
      Object.freeze(value);
      for (const child of Object.values(value)) deepFreeze(child);
    };
    const copy = structuredClone(lock);
    deepFreeze(copy);
    expect(() => scopeLock(copy, orders)).not.toThrow();
    expect(copy).toEqual(lock);
  });
});

describe('pathModule', () => {
  test('picks the longest module path that prefixes the path', () => {
    expect(pathModule(lock, 'examples/orders/a.ts')).toBe('orders');
    expect(pathModule(lock, 'examples/orders/deep/a.ts')).toBe('orders-deep');
    expect(pathModule(lock, 'examples/billing/x/y.ts')).toBe('billing');
  });

  test('matches the module path itself', () => {
    expect(pathModule(lock, 'examples/orders')).toBe('orders');
  });

  test('does not match a sibling that shares the prefix text', () => {
    expect(pathModule(lock, 'examples/ordersX/a.ts')).toBeUndefined();
    expect(pathModule(lock, 'examples/orders-deep/a.ts')).toBeUndefined();
  });

  test('returns undefined outside every module', () => {
    expect(pathModule(lock, 'src/core/a.ts')).toBeUndefined();
    expect(pathModule(lock, '')).toBeUndefined();
  });
});

describe('narrowRulePaths', () => {
  const rule = (key: string, paths: string[] | null): Rule => ({
    key,
    file: `.ai/rules/${key}.md`,
    paths,
    body: `body of ${key}`,
  });
  const file = 'examples/orders/a.ts';

  test('keeps only the globs that match the path', () => {
    const [r] = narrowRulePaths(
      [rule('multi', ['examples/orders/**', 'examples/billing/**', '**/*.md'])],
      file,
    );
    expect(r?.paths).toEqual(['examples/orders/**']);
  });

  test('keeps null paths and a single matching glob as they are', () => {
    const rules = [rule('all', null), rule('one', ['examples/**'])];
    expect(narrowRulePaths(rules, file)).toEqual(rules);
  });

  test('leaves the other fields and the key order intact', () => {
    const [r] = narrowRulePaths(
      [rule('multi', ['examples/billing/**', 'examples/orders/**'])],
      file,
    );
    expect(Object.keys(r ?? {})).toEqual(['key', 'file', 'paths', 'body']);
    expect(r).toEqual({ ...rule('multi', ['examples/orders/**']) });
  });

  test('does not mutate its input', () => {
    const input = Object.freeze([
      Object.freeze(
        rule(
          'multi',
          Object.freeze(['examples/orders/**', 'examples/billing/**']) as never,
        ),
      ),
    ]);
    narrowRulePaths(input, file);
    expect(input[0]?.paths).toEqual([
      'examples/orders/**',
      'examples/billing/**',
    ]);
  });
});
