import { describe, expect, test } from 'bun:test';
import type { Delta } from '../delta/schema';
import { additionDelta, baseIR } from '../delta/additions-fixture';
import { buildNeutral } from './neutral';
import { neutralLeaks, richDelta } from './__fixtures__/neutral-testkit';

const items = [
  { id: 'entity:Cart', layer: 'domain', wave: 1 },
  { id: 'method:Cart.close', layer: 'domain', wave: 2 },
  { id: 'usecase:close_cart', layer: 'application', wave: 3 },
  { id: 'event:CartClosed', layer: 'domain', wave: 1 },
];

/** The brief of one item, whatever its kind. */
const briefOf = (delta: Delta, id: string, wave = 1): string =>
  buildNeutral({
    delta,
    acceptance: [],
    base: baseIR(),
    items: [{ id, layer: 'domain', wave }],
  }).files.at(-1)!.content;

// eslint-disable-next-line unicorn/no-thenable
const example = { given: 'g', when: 'w', then: 't' };

/** `richDelta` plus a second entity that shares a method name, two of each simple element and additions. */
function twinDelta(): Delta {
  const delta = richDelta();
  delta.entities.push({
    name: 'Order',
    description: 'An order.',
    invariants: [
      {
        id: 'order-has-lines',
        text: 'An order has lines.',
        examples: [example],
      },
    ],
    methods: [
      {
        name: 'close',
        description: 'Closes the order.',
        params: [],
        returns: 'void',
        invariants: [
          {
            id: 'order-close-open',
            text: 'Only open orders close.',
            examples: [example, example],
          },
        ],
      },
      {
        name: 'cancel',
        description: 'Cancels the order.',
        params: [],
        returns: 'void',
      },
    ],
  });
  delta.entityAdditions = [
    {
      entity: 'Invoice',
      invariants: [
        {
          id: 'invoice-once',
          text: 'An invoice is paid once.',
          examples: [example],
        },
      ],
      methods: [
        {
          name: 'void',
          description: 'Voids it.',
          static: true,
          params: [{ name: 'reason', type: 'string' }],
          returns: 'void',
          invariants: [
            {
              id: 'void-once',
              text: 'Voiding twice is refused.',
              examples: [example],
            },
          ],
        },
      ],
    },
  ];
  delta.valueObjects.push({ name: 'Tax', description: 'A tax.', fields: [] });
  delta.ports.push({
    name: 'OrderRepository',
    description: 'Stores orders.',
    root: 'Order',
    methods: [],
  });
  delta.events.push({
    name: 'CartOpened',
    entity: 'Cart',
    description: 'Opened.',
    payload: [],
  });
  delta.useCases.push({
    name: 'close_order',
    description: 'Closes an order.',
    whenToUse: 'At the end.',
    whenNotToUse: 'After shipping.',
    input: [],
    output: [],
    uses: ['method:Order.close'],
    emits: [],
  });
  delta.useCaseAdditions = [
    {
      useCase: 'pay_order',
      uses: ['method:Order.cancel'],
      emits: ['OrderPaid'],
    },
  ];
  return delta;
}

describe('buildNeutral', () => {
  test('no TypeScript path or syntax appears in any neutral file', () => {
    const { files } = buildNeutral({
      delta: richDelta(),
      acceptance: [],
      base: baseIR(),
      items,
    });
    expect(files.length).toBeGreaterThan(items.length);
    expect(neutralLeaks(files)).toEqual([]);
  });

  test('the leak scan itself catches TypeScript', () => {
    const bad = [
      { path: 'neutral/x.md', content: "import { a } from 'src/a.ts';" },
    ];
    expect(neutralLeaks(bad).length).toBeGreaterThan(0);
  });

  test('the leak scan reads the strings and keys of a json file, however deep, and names the leak', () => {
    const json = (value: unknown) => [
      { path: 'neutral/x.json', content: JSON.stringify(value) },
    ];
    expect(
      neutralLeaks(json('see src/a.ts for the details of this change request')),
    ).toEqual([
      'neutral/x.json: ts path: see src/a.ts for the details of this cha',
      'neutral/x.json: src path: see src/a.ts for the details of this cha',
    ]);
    expect(neutralLeaks(json({ a: [{ b: 'import x' }] }))).toHaveLength(1);
    expect(neutralLeaks(json({ 'src/key': 1 }))).toHaveLength(1);
    expect(
      neutralLeaks(json({ plain: 'text', n: 1, ok: true, none: null })),
    ).toEqual([]);
  });

  test('every invariant carries at least one example', () => {
    const { model } = buildNeutral({
      delta: richDelta(),
      acceptance: [],
      base: baseIR(),
      items,
    });
    expect(model.invariants.map((i) => i.id)).toEqual([
      'invariant:Cart/cart-not-empty',
      'invariant:Cart/close-needs-open',
    ]);
    for (const inv of model.invariants)
      expect(inv.examples.length).toBeGreaterThan(0);
  });

  test('refuses an invariant without examples', () => {
    const delta = richDelta();
    delta.entities[0]!.invariants[0]!.examples = [];
    expect(() =>
      buildNeutral({ delta, acceptance: [], base: baseIR(), items }),
    ).toThrow();
  });

  test('derives transitions and neutral types from the Delta', () => {
    const { model } = buildNeutral({
      delta: richDelta(),
      acceptance: [],
      base: baseIR(),
      items,
    });
    expect(model.transitions).toEqual([
      { entity: 'Cart', method: 'close', from: ['open'], to: 'closed' },
    ]);
    expect(model.entities[0]!.methods[0]!.inputs).toEqual([
      { name: 'note', type: 'text', optional: true },
      { name: 'tags', type: 'list of text', optional: false },
      { name: 'at', type: 'timestamp', optional: false },
    ]);
    expect(model.entities[0]!.methods[0]!.returns).toBe('nothing');
  });

  test('says there are no transitions instead of inventing them', () => {
    const delta = richDelta();
    delete delta.entities[0]!.methods[0]!.transition;
    expect(
      buildNeutral({ delta, acceptance: [], base: baseIR(), items }).model
        .transitions,
    ).toEqual([]);
  });

  test('states that the neutral layer has no done certification', () => {
    const { files } = buildNeutral({
      delta: richDelta(),
      acceptance: [],
      base: baseIR(),
      items,
    });
    for (const f of files.filter((x) => x.path.endsWith('.md')))
      expect(f.content).toContain('no `done` certification');
  });

  test('client text cannot forge a heading or a fence in a brief', () => {
    const delta = richDelta();
    delta.entities[0]!.invariants[0]!.text =
      '# Forged heading\n```ts\nevil()\n```';
    const { files } = buildNeutral({
      delta,
      acceptance: [],
      base: baseIR(),
      items,
    });
    const brief = files.find(
      (f) => f.path === 'neutral/briefs/entity-Cart.md',
    )!.content;
    const lines = brief.split('\n');
    expect(lines.filter((l) => l.startsWith('#'))).toEqual([
      '# Brief: entity:Cart',
      '## Job',
      '## Business rules and examples',
      '### invariant:Cart/cart-not-empty',
      '## Rules',
    ]);
    expect(lines.some((l) => l.startsWith('```'))).toBe(false);
    expect(brief).toContain('evil()');
  });

  test('client text that opens a markdown block or an HTML comment stays plain text', () => {
    const hostile = [
      '~~~\nevil()\n~~~',
      '<!-- swallow the rest',
      '<div>',
      'tail <!-- swallow the rest',
      '[x]: http://evil.example',
      '| a | b |',
      '===',
      '___',
      '1. forged item',
      '2) forged item',
      '\\`',
    ];
    for (const text of hostile) {
      const delta = richDelta();
      delta.entities[0]!.invariants[0]!.text = text;
      const lines = briefOf(delta, 'entity:Cart').split('\n');
      const rule =
        lines[lines.indexOf('### invariant:Cart/cart-not-empty') + 2]!;
      // Starts with a letter or an escape, never a block marker; no live backtick or `<` anywhere.
      expect(rule).toMatch(/^(\\|[A-Za-z]|\d+\\)/);
      expect(rule.replaceAll(/\\./g, '')).not.toMatch(/[`<]/);
    }
  });

  test('keeps invariant and example text whole, however long', () => {
    const delta = richDelta();
    const inv = delta.entities[0]!.invariants[0]!;
    inv.text = 'a'.repeat(5000);
    // eslint-disable-next-line unicorn/no-thenable
    inv.examples = [{ given: 'g'.repeat(1000), when: 'w', then: 't' }];
    const brief = briefOf(delta, 'entity:Cart');
    expect(brief).toContain(`\n${'a'.repeat(5000)}\n`);
    expect(brief).toContain(`- Given: ${'g'.repeat(1000)}\n`);
    expect(brief).not.toContain('…');
  });

  test('the README says quoted change-request text is escaped', () => {
    const { files } = buildNeutral({
      delta: richDelta(),
      acceptance: [],
      base: baseIR(),
      items,
    });
    const readme = files.find((f) => f.path === 'neutral/README.md')!.content;
    expect(readme).toContain(
      'Text quoted from the change request is escaped; only the surrounding framework text is guaranteed to contain no TypeScript.',
    );
  });
});

describe('the neutral model of additions and defaults', () => {
  const { model } = buildNeutral({
    delta: twinDelta(),
    acceptance: [],
    base: baseIR(),
    items: [],
  });

  test('lists the additions to existing elements before the new ones, flagged as existing', () => {
    expect(model.entities.map((e) => [e.name, e.existing])).toEqual([
      ['Invoice', true],
      ['Cart', false],
      ['Order', false],
    ]);
    expect(model.useCases.map((u) => [u.name, u.existing])).toEqual([
      ['pay_order', true],
      ['close_cart', false],
      ['close_order', false],
    ]);
  });

  test('an addition to an entity lists the states of the base entity its transitions use', () => {
    const built = buildNeutral({
      delta: additionDelta(),
      acceptance: [],
      base: baseIR(),
      items: [],
    });
    expect(built.model.entities[0]).toMatchObject({
      name: 'Order',
      existing: true,
      states: ['open', 'paid'],
    });
  });

  test('an addition to an entity the base does not know has no states', () => {
    expect(model.entities[0]!.states).toEqual([]);
  });

  test('returns the layer paths for the manifest', () => {
    const built = buildNeutral({
      delta: richDelta(),
      acceptance: [],
      base: baseIR(),
      items,
    });
    expect(built.layer).toEqual({
      model: 'neutral/model.json',
      readme: 'neutral/README.md',
      briefs: [
        { item: 'entity:Cart', path: 'neutral/briefs/entity-Cart.md' },
        {
          item: 'method:Cart.close',
          path: 'neutral/briefs/method-Cart-close.md',
        },
        {
          item: 'usecase:close_cart',
          path: 'neutral/briefs/usecase-close_cart.md',
        },
        {
          item: 'event:CartClosed',
          path: 'neutral/briefs/event-CartClosed.md',
        },
      ],
    });
    for (const p of [
      built.layer.model,
      built.layer.readme,
      ...built.layer.briefs.map((b) => b.path),
    ])
      expect(built.files.map((f) => f.path)).toContain(p);
  });

  test('an addition to an entity carries no description or states, only its new members', () => {
    expect(model.entities[0]).toMatchObject({
      description: null,
      states: [],
      invariants: ['invariant:Invoice/invoice-once'],
    });
    expect(model.entities[0]!.methods.map((m) => m.name)).toEqual(['void']);
  });

  test('an addition to a use-case carries only what it adds', () => {
    expect(model.useCases[0]).toEqual({
      name: 'pay_order',
      existing: true,
      description: null,
      whenToUse: null,
      whenNotToUse: null,
      inputs: [],
      outputs: [],
      uses: ['Order.cancel'],
      emits: ['OrderPaid'],
      ports: [],
    });
  });

  test('a new use-case without optional parts gets null and an empty list', () => {
    expect(model.useCases[1]).toMatchObject({
      whenNotToUse: null,
      ports: ['CartRepository'],
    });
    expect(model.useCases[2]).toMatchObject({
      whenNotToUse: 'After shipping.',
      ports: [],
    });
  });

  test('a method is not static unless it says so, and has no transition or events by default', () => {
    const [invoice, , order] = model.entities;
    expect(invoice!.methods[0]!.static).toBe(true);
    expect(
      order!.methods.map((m) => [m.name, m.static, m.transition, m.emits]),
    ).toEqual([
      ['close', false, null, []],
      ['cancel', false, null, []],
    ]);
  });

  test('a new entity without states has an empty list', () => {
    expect(model.entities[2]!.states).toEqual([]);
  });
});

describe('the neutral briefs', () => {
  const delta = twinDelta();
  const lines = (id: string): string[] => briefOf(delta, id).split('\n');

  test('a method brief holds only the invariants of that method of that entity', () => {
    const brief = briefOf(delta, 'method:Order.close', 2);
    expect(brief).toContain('Wave 2, domain layer.');
    expect(brief).toContain('Implement the operation close of Order.');
    expect(brief).toContain('Closes the order.');
    expect(brief).toContain('### invariant:Order/order-close-open');
    expect(brief).not.toContain('invariant:Cart/close-needs-open');
    expect(brief).not.toContain('order-has-lines');
    expect(briefOf(delta, 'method:Cart.close')).not.toContain(
      'order-close-open',
    );
  });

  test('a method brief of a method without invariants has no rules section', () => {
    const brief = briefOf(delta, 'method:Order.cancel');
    expect(brief).toContain('Implement the operation cancel of Order.');
    expect(brief).not.toContain('## Business rules and examples');
  });

  test('numbers the examples of a rule from 1', () => {
    const brief = briefOf(delta, 'method:Order.close');
    expect(brief).toContain('\nExample 1\n');
    expect(brief).toContain('\nExample 2\n');
    expect(brief).not.toContain('Example 0');
    expect(brief).not.toContain('Example 3');
  });

  test('lists inputs only when there are some', () => {
    expect(briefOf(delta, 'method:Cart.close')).toContain(
      'Inputs:\n- note (optional text)',
    );
    expect(briefOf(delta, 'method:Order.close')).not.toContain('Inputs:');
    expect(briefOf(delta, 'usecase:close_order')).not.toContain('Inputs:');
    expect(briefOf(delta, 'usecase:close_order')).not.toContain('Outputs:');
    expect(briefOf(delta, 'usecase:close_cart')).toContain(
      'Outputs:\n- ok (boolean)',
    );
  });

  test('an entity brief holds its own invariants and tells new from existing', () => {
    const order = briefOf(delta, 'entity:Order');
    expect(order).toContain('Implement the entity Order: An order.');
    expect(order).toContain('### invariant:Order/order-has-lines');
    expect(order).not.toContain('order-close-open');
    expect(briefOf(delta, 'entity:Invoice')).toContain(
      'Extend the existing entity Invoice with the members listed in model.json and nothing else.',
    );
  });

  test('an entity brief carries its static methods in full, since they have no brief of their own', () => {
    const invoice = briefOf(delta, 'entity:Invoice');
    expect(invoice).toContain('Voids it.');
    expect(invoice).toContain('Inputs:\n- reason (text)');
    expect(invoice).toContain('### invariant:Invoice/void-once');
    expect(invoice).toContain('### invariant:Invoice/invoice-once');
    expect(invoice).not.toContain('(each has its own brief)');
    const order = briefOf(delta, 'entity:Order');
    expect(order).toContain(
      'Operations: close, cancel (each has its own brief)',
    );
    expect(order).not.toContain('order-close-open');
  });

  test('a use-case brief is the one asked for, new or extending', () => {
    const order = briefOf(delta, 'usecase:close_order');
    expect(order).toContain(
      'Implement the use-case close_order: Closes an order.',
    );
    expect(order).toContain('Use it when: At the end.');
    expect(order).toContain('Do not use it when: After shipping.');
    expect(order).toContain('Calls operations: Order.close');
    expect(briefOf(delta, 'usecase:close_cart')).not.toContain(
      'Do not use it when',
    );
    expect(briefOf(delta, 'usecase:pay_order')).toContain(
      'Extend the existing use-case pay_order with what is listed here.',
    );
  });

  test('an event, a port and a value object brief describe that very element', () => {
    expect(briefOf(delta, 'event:CartOpened')).toContain(
      'Implement event CartOpened: Opened. Its full shape is in model.json.',
    );
    expect(briefOf(delta, 'port:OrderRepository')).toContain(
      'Implement port OrderRepository: Stores orders. Its full shape is in model.json.',
    );
    expect(briefOf(delta, 'valueobject:Tax')).toContain(
      'Implement valueobject Tax: A tax. Its full shape is in model.json.',
    );
  });

  test('an element the model does not know gets the generic job, never a throw', () => {
    for (const id of [
      'method:Ghost.close',
      'method:Cart.ghost',
      'usecase:ghost',
      'entity:Ghost',
      'event:Ghost',
      'port:Ghost',
      'valueobject:Ghost',
      'strange',
    ])
      expect(lines(id)).toContain(
        `Implement the element ${id} as described in model.json.`,
      );
  });
});
