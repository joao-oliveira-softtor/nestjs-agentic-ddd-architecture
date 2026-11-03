import { describe, expect, test } from 'bun:test';
import { ERROR_CODES } from '../../contracts/codes';
import type { ErrorCode, IR } from '../ir';
import {
  LIMITS,
  compareErrors,
  compareText,
  parseType,
  splitOptional,
  validateDelta,
  type Delta,
  type DeltaError,
} from './schema';
import {
  INSTANCE_MEMBERS,
  RENDERER_IMPORT_NAMES,
  STATIC_MEMBERS,
} from './names';
import { sampleDelta } from './sample';

const errorsOf = (input: unknown, base: IR | null = null) => {
  const r = validateDelta(input, { base });
  return r.ok ? [] : r.errors;
};

describe('validateDelta', () => {
  test('accepts the sample, with optional markers and void', () => {
    expect(validateDelta(sampleDelta()).ok).toBe(true);
  });

  test('rejects unknown keys and wrong shapes with delta.schema-invalid and a path', () => {
    expect(errorsOf({ ...sampleDelta(), extra: 1 })[0]).toMatchObject({
      code: 'delta.schema-invalid',
    });
    const d = sampleDelta();
    (d.entities[0] as unknown as Record<string, unknown>).name = 5;
    expect(errorsOf(d)[0]).toMatchObject({
      code: 'delta.schema-invalid',
      path: 'entities[0].name',
    });
    expect(errorsOf(null)[0]!.code).toBe('delta.schema-invalid');
  });

  test.each<[string, (d: Delta) => void]>([
    [
      'entities[0].methods[1].name',
      (d) => (d.entities[0]!.methods[1]!.name = 'Bad-Name'),
    ],
    [
      'entities[0].methods[1].name',
      (d) => (d.entities[0]!.methods[1]!.name = 'delete'),
    ],
    [
      'entities[0].name',
      (d) => (d.entities[0]!.name = "X'); process.exit(); ('"),
    ],
    [
      'entities[0].invariants[0].id',
      (d) => (d.entities[0]!.invariants[0]!.id = 'Not Kebab'),
    ],
    ['useCases[0].name', (d) => (d.useCases[0]!.name = 'Publish-Product')],
    ['module', (d) => (d.module = 'Shop')],
    [
      'events[0].payload[0].name',
      (d) => (d.events[0]!.payload[0]!.name = 'a-b'),
    ],
    [
      'entities[0].methods[0].params[0].name',
      (d) => (d.entities[0]!.methods[0]!.params[0]!.name = 'Id'),
    ],
    [
      'useCases[0].uses[0]',
      (d) => (d.useCases[0]!.uses[0] = 'Product.publish'),
    ],
    [
      'events[0].payload[0].name',
      (d) => (d.events[0]!.payload[0]!.name = 'x??'),
    ],
  ])('delta.invalid-identifier at %s', (path, mutate) => {
    const d = sampleDelta();
    mutate(d);
    expect(errorsOf(d)).toContainEqual(
      expect.objectContaining({ code: 'delta.invalid-identifier', path }),
    );
  });

  test('type grammar admits allowlisted types only', () => {
    expect(parseType('string[][]')).not.toBeNull();
    expect(parseType('Money[]')).toMatchObject({ kind: 'array' });
    for (const bad of [
      'any',
      'Record<string, string>',
      'string | null',
      'string[',
      '{a: 1}',
      'import("x")',
      'Array<string>',
      'typeof x',
      '',
    ])
      expect(parseType(bad)).toBeNull();
    const d = sampleDelta();
    d.entities[0]!.methods[0]!.params[0]!.type = 'Record<string, any>';
    expect(errorsOf(d)).toContainEqual(
      expect.objectContaining({
        code: 'delta.type-invalid',
        path: 'entities[0].methods[0].params[0].type',
      }),
    );
  });

  test('a type naming something undeclared is delta.reference-unknown', () => {
    const d = sampleDelta();
    d.valueObjects[0]!.fields[0]!.type = 'Ghost[]';
    expect(errorsOf(d)[0]).toMatchObject({
      code: 'delta.reference-unknown',
      path: 'valueObjects[0].fields[0].type',
    });
  });

  test('void is only a method return type; a field and its optional twin collide', () => {
    const d = sampleDelta();
    d.useCases[0]!.input[0]!.type = 'void';
    expect(errorsOf(d)[0]!.code).toBe('delta.type-invalid');
    const e = sampleDelta();
    e.events[0]!.payload.push({ name: 'productId?', type: 'string' });
    expect(errorsOf(e)[0]).toMatchObject({ code: 'delta.name-collision' });
  });

  test('delta.name-collision inside the Delta', () => {
    const d = sampleDelta();
    d.valueObjects[0]!.name = 'Product';
    expect(errorsOf(d).map((e) => e.code)).toContain('delta.name-collision');
    const m = sampleDelta();
    m.entities[0]!.methods[1]!.name = 'create';
    expect(errorsOf(m)).toContainEqual(
      expect.objectContaining({
        code: 'delta.name-collision',
        path: 'entities[0].methods[1].name',
      }),
    );
  });

  test('delta.reference-unknown for uses, emits, ports, owner, states and root', () => {
    const d = sampleDelta();
    d.useCases[0]!.uses = ['method:Product.nope'];
    d.useCases[0]!.emits = ['Nope'];
    d.useCases[0]!.ports = ['NoPort'];
    d.events[0]!.entity = 'Nobody';
    d.entities[0]!.methods[1]!.transition = { from: ['x'], to: 'y' };
    d.ports[0]!.root = 'Nobody';
    const paths = errorsOf(d)
      .filter((e) => e.code === 'delta.reference-unknown')
      .map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'useCases[0].uses[0]',
        'useCases[0].emits[0]',
        'useCases[0].ports[0]',
        'events[0].entity',
        'entities[0].methods[1].transition.from[0]',
        'entities[0].methods[1].transition.to',
        'ports[0].root',
      ]),
    );
  });

  test('a collision with the base says removing or renaming existing items is not supported', () => {
    const base = {
      irVersion: 1,
      modules: [],
      entities: [
        { id: 'entity:Product', name: 'Product', invariants: [], methods: [] },
      ],
      events: [],
      useCases: [],
      operators: [],
    } as unknown as IR;
    const e = errorsOf(sampleDelta(), base).find(
      (x) => x.code === 'delta.name-collision',
    )!;
    expect(e.path).toBe('entities[0].name');
    expect(e.message).toContain('removing or renaming existing items');
  });

  test.each<[string, (d: Delta) => void, ErrorCode]>([
    [
      'use_case',
      (d) => (d.useCases[0]!.name = 'use_case'),
      'delta.invalid-identifier',
    ],
    [
      'promise',
      (d) => (d.useCases[0]!.name = 'promise'),
      'delta.invalid-identifier',
    ],
    [
      'trailing underscore',
      (d) => (d.useCases[0]!.name = 'foo_'),
      'delta.invalid-identifier',
    ],
    [
      'double underscore',
      (d) => (d.useCases[0]!.name = 'foo__bar'),
      'delta.invalid-identifier',
    ],
    [
      'class equal to an event',
      (d) => (d.useCases[0]!.name = 'product_published'),
      'delta.name-collision',
    ],
    [
      'repeated emits',
      (d) => d.useCases[0]!.emits.push('ProductPublished'),
      'delta.name-collision',
    ],
    [
      'repeated state',
      (d) => d.entities[0]!.states!.push('draft'),
      'delta.name-collision',
    ],
  ])('%s is refused before rendering', (_label, mutate, code) => {
    const d = sampleDelta();
    mutate(d);
    expect(errorsOf(d).map((e) => e.code)).toContain(code);
  });

  test('the delta codes are registered', () => {
    for (const c of [
      'delta.invalid-identifier',
      'delta.type-invalid',
      'delta.name-collision',
      'delta.reference-unknown',
      'delta.schema-invalid',
    ])
      expect(ERROR_CODES).toHaveProperty([c]);
  });
});

describe('validateDelta limits and error order', () => {
  const over = (n: number, make: (i: number) => unknown) =>
    Array.from({ length: n + 1 }, (_, i) => make(i));

  test.each<[string, (d: Delta) => void]>([
    [
      'entities',
      (d) =>
        ((d as { entities: unknown }).entities = over(
          LIMITS.entities,
          () => ({}),
        )),
    ],
    [
      'entities[0].methods',
      (d) =>
        ((d.entities[0] as { methods: unknown }).methods = over(
          LIMITS.methods,
          () => ({}),
        )),
    ],
    [
      'entities[0].methods[0].params',
      (d) =>
        ((d.entities[0]!.methods[0] as { params: unknown }).params = over(
          LIMITS.params,
          () => ({}),
        )),
    ],
    [
      'events[0].payload',
      (d) =>
        ((d.events[0] as { payload: unknown }).payload = over(
          LIMITS.fields,
          () => ({}),
        )),
    ],
    [
      'useCases[0].uses',
      (d) =>
        ((d.useCases[0] as { uses: unknown }).uses = over(
          LIMITS.uses,
          () => 'x',
        )),
    ],
    [
      'entities[0].states',
      (d) =>
        ((d.entities[0] as { states: unknown }).states = over(
          LIMITS.states,
          () => 'x',
        )),
    ],
  ])('an over-cap array at %s is rejected with its path', (path, mutate) => {
    const d = sampleDelta();
    mutate(d);
    expect(errorsOf(d)).toContainEqual(
      expect.objectContaining({ code: 'delta.schema-invalid', path }),
    );
  });

  test('errors are ordered by path, code and message whatever the input order', () => {
    const d = sampleDelta();
    d.entities[0]!.methods[0]!.name = 'Bad-Name';
    d.entities[0]!.methods[1]!.name = 'also-bad';
    d.events[0]!.entity = 'Nobody';
    d.useCases[0]!.uses = ['method:X.y', 'bogus'];
    const a = errorsOf(d);
    expect(a.length).toBeGreaterThan(3);
    const key = (e: (typeof a)[number]) =>
      `${e.path}\u0000${e.code}\u0000${e.message}`;
    expect(a.map(key)).toEqual(a.map(key).sort());
    const s = sampleDelta();
    s.entities[0]!.methods = [...d.entities[0]!.methods].reverse();
    s.events = [...d.events].reverse();
    s.useCases = [...d.useCases].reverse();
    const b = errorsOf(s);
    expect(b.map(key)).toEqual(b.map(key).sort());
  });
});

describe('names derived from the code they protect', () => {
  test('every name the renderer imports is rejected as an identifier', () => {
    for (const n of RENDERER_IMPORT_NAMES) {
      const d = sampleDelta();
      d.valueObjects[0]!.name = n;
      expect(errorsOf(d).map((e) => e.code)).not.toEqual([]);
    }
    expect(RENDERER_IMPORT_NAMES.has('notImplemented')).toBe(true);
    expect(RENDERER_IMPORT_NAMES.has('AgentPort')).toBe(true);
  });

  test('inherited and built-in members come from the core classes', () => {
    for (const n of ['id', 'equals', 'record', 'pullEvents', 'toString'])
      expect(INSTANCE_MEMBERS.has(n)).toBe(true);
    for (const n of ['name', 'length', 'prototype', 'apply'])
      expect(STATIC_MEMBERS.has(n)).toBe(true);
  });
});

describe('validateDelta hardening (ADR-0007 D9)', () => {
  const invalidAt = (d: Delta, path: string) =>
    expect(errorsOf(d)).toContainEqual(
      expect.objectContaining({ code: 'delta.invalid-identifier', path }),
    );

  test.each(['Con', 'Prn', 'Aux', 'Nul', 'Com0', 'Com1', 'Lpt9', 'CON'])(
    'entity %s would become a Windows device file name',
    (name) => {
      const d = sampleDelta();
      d.entities[0]!.name = name;
      invalidAt(d, 'entities[0].name');
    },
  );

  test('value objects, ports and use cases cannot be device file names either', () => {
    const v = sampleDelta();
    v.valueObjects[0]!.name = 'Prn';
    invalidAt(v, 'valueObjects[0].name');
    const p = sampleDelta();
    p.ports[0]!.name = 'Aux';
    invalidAt(p, 'ports[0].name');
    const u = sampleDelta();
    u.useCases[0]!.name = 'nul';
    invalidAt(u, 'useCases[0].name');
  });

  test('names that only start with a device stem are fine', () => {
    const d = sampleDelta();
    d.valueObjects[0]!.name = 'Console';
    expect(
      errorsOf(d).filter((e) => e.path === 'valueObjects[0].name'),
    ).toEqual([]);
  });

  test.each([
    'Delete',
    'Class',
    'New',
    'If',
    'Var',
    'Void',
    'With',
    'Do',
    'Enum',
  ])('port %s cannot become a constructor parameter', (name) => {
    const d = sampleDelta();
    d.ports[0]!.name = name;
    d.useCases[0]!.ports = [name];
    invalidAt(d, 'useCases[0].ports[0]');
  });

  test('a use-case name over 64 characters is an error', () => {
    const d = sampleDelta();
    d.useCases[0]!.name = 'a'.repeat(65);
    invalidAt(d, 'useCases[0].name');
  });

  test.each([
    'Reflect',
    'NaN',
    'Infinity',
    'Record',
    'Partial',
    'Readonly',
    'Required',
    'Pick',
    'Omit',
  ])('the global %s is not a usable class name', (name) => {
    const d = sampleDelta();
    d.valueObjects[0]!.name = name;
    invalidAt(d, 'valueObjects[0].name');
  });

  test('messages do not echo long client strings', () => {
    const long = 'x'.repeat(200); // the schema caps names at 200
    const d = sampleDelta();
    d.entities[0]!.states = [long, long];
    const dup = errorsOf(d).find((e) => e.code === 'delta.name-collision')!;
    expect(dup.message.length).toBeLessThan(200);
    expect(dup.message).toContain('"');
    const e = sampleDelta();
    e.useCases[0]!.emits = [long];
    const ref = errorsOf(e).find((x) => x.code === 'delta.reference-unknown')!;
    expect(ref.message.length).toBeLessThan(250);
    const f = sampleDelta();
    f.entities[0]!.methods[1]!.transition = { from: [long], to: long };
    const refs = errorsOf(f).filter((x) => x.path.includes('transition'));
    expect(refs.length).toBe(2);
    for (const x of refs) expect(x.message.length).toBeLessThan(200);
  });

  test('unknown keys are listed capped, with a count', () => {
    const extras = Object.fromEntries(
      Array.from({ length: 300 }, (_, i) => [`k${i}_${'y'.repeat(50)}`, 1]),
    );
    const e = errorsOf({ ...sampleDelta(), ...extras });
    expect(e[0]).toMatchObject({ code: 'delta.schema-invalid', path: '' });
    expect(e[0]!.message.length).toBeLessThan(500);
    expect(e[0]!.message).toContain('295');
  });
});

describe('schema building blocks', () => {
  test('splitOptional reads the trailing question mark', () => {
    expect(splitOptional('x?')).toEqual({ id: 'x', optional: true });
    expect(splitOptional('x')).toEqual({ id: 'x', optional: false });
  });

  test('parseType returns the structure of the type text', () => {
    expect(parseType('string')).toEqual({ kind: 'primitive', name: 'string' });
    expect(parseType('Money')).toEqual({ kind: 'ref', name: 'Money' });
    expect(parseType('string[]')).toEqual({
      kind: 'array',
      of: { kind: 'primitive', name: 'string' },
    });
    expect(parseType('Money[][]')).toEqual({
      kind: 'array',
      of: { kind: 'array', of: { kind: 'ref', name: 'Money' } },
    });
  });

  test('compareText orders by code unit', () => {
    expect(compareText('a', 'b')).toBe(-1);
    expect(compareText('b', 'a')).toBe(1);
    expect(compareText('a', 'a')).toBe(0);
    expect(compareText('B', 'a')).toBe(-1);
  });

  test('compareErrors orders by path, then code, then message', () => {
    const err = (
      path: string,
      code: DeltaError['code'],
      message: string,
    ): DeltaError => ({ path, code, message });
    expect(
      compareErrors(
        err('a', 'delta.type-invalid', ''),
        err('b', 'delta.name-collision', ''),
      ),
    ).toBe(-1);
    expect(
      compareErrors(
        err('a', 'delta.type-invalid', ''),
        err('a', 'delta.name-collision', ''),
      ),
    ).toBe(1);
    expect(
      compareErrors(
        err('a', 'delta.type-invalid', 'x'),
        err('a', 'delta.type-invalid', 'y'),
      ),
    ).toBe(-1);
    expect(
      compareErrors(
        err('a', 'delta.type-invalid', 'x'),
        err('a', 'delta.type-invalid', 'x'),
      ),
    ).toBe(0);
  });
});

describe('validateDelta boundaries', () => {
  const unknownKeys = (keys: string[]) =>
    errorsOf({
      ...sampleDelta(),
      ...Object.fromEntries(keys.map((k) => [k, 1])),
    })[0]!.message;

  test('unknown keys name the first five and count the rest', () => {
    expect(unknownKeys(['zA', 'zB'])).toBe('unrecognized keys: "zA", "zB"');
    expect(unknownKeys(['k0', 'k1', 'k2', 'k3', 'k4'])).toBe(
      'unrecognized keys: "k0", "k1", "k2", "k3", "k4"',
    );
    expect(unknownKeys(['k0', 'k1', 'k2', 'k3', 'k4', 'k5'])).toBe(
      'unrecognized keys: "k0", "k1", "k2", "k3", "k4" and 1 more',
    );
  });

  test('a client string is cut after 80 characters', () => {
    const at80 = 'k'.repeat(80);
    expect(unknownKeys([at80])).toBe(`unrecognized keys: "${at80}"`);
    expect(unknownKeys([`${at80}k`])).toBe(`unrecognized keys: "${at80}..."`);
  });

  test('a required parameter cannot follow an optional one, in methods and ports', () => {
    const method = sampleDelta();
    method.entities[0]!.methods[0]!.params = [
      { name: 'a?', type: 'string' },
      { name: 'b', type: 'string' },
    ];
    expect(errorsOf(method)).toEqual([
      {
        code: 'delta.schema-invalid',
        path: 'entities[0].methods[0].params[1].name',
        message: 'a required parameter cannot follow an optional one',
      },
    ]);
    const port = sampleDelta();
    port.ports[0]!.methods[0]!.params = [
      { name: 'a?', type: 'string' },
      { name: 'b', type: 'string' },
    ];
    expect(errorsOf(port)).toEqual([
      {
        code: 'delta.schema-invalid',
        path: 'ports[0].methods[0].params[1].name',
        message: 'a required parameter cannot follow an optional one',
      },
    ]);
  });

  test('field lists accept an optional field before a required one', () => {
    const d = sampleDelta();
    d.valueObjects[0]!.fields = [
      { name: 'a?', type: 'string' },
      { name: 'b', type: 'string' },
    ];
    d.events[0]!.payload = [
      { name: 'c?', type: 'string' },
      { name: 'd', type: 'string' },
    ];
    expect(errorsOf(d)).toEqual([]);
  });

  test('a method may omit emits', () => {
    const d = sampleDelta();
    delete d.entities[0]!.methods[0]!.emits;
    expect(validateDelta(d).ok).toBe(true);
  });

  describe('against a base', () => {
    const baseWith = (
      ...entities: { name: string; module: string }[]
    ): IR =>
      ({
        irVersion: 1,
        modules: [],
        entities: entities.map((e) => ({
          id: `entity:${e.name}`,
          invariants: [],
          methods: [],
          ...e,
        })),
        events: [],
        useCases: [],
        operators: [],
      }) as unknown as IR;
    const rootError = (root: string, base: IR) => {
      const d = sampleDelta();
      d.ports[0]!.root = root;
      return errorsOf(d, base);
    };

    test('a port root must be an entity of this module, not of another', () => {
      expect(
        rootError('Foreign', baseWith({ name: 'Foreign', module: 'other' })),
      ).toEqual([
        {
          code: 'delta.reference-unknown',
          path: 'ports[0].root',
          message: 'entity "Foreign" is not declared in module "shop"',
        },
      ]);
      expect(
        rootError('Mine', baseWith({ name: 'Mine', module: 'shop' })),
      ).toEqual([]);
    });

    test('an undeclared port root is refused although the base has other entities', () => {
      expect(
        rootError('Nobody', baseWith({ name: 'Other', module: 'shop' })),
      ).toEqual([
        {
          code: 'delta.reference-unknown',
          path: 'ports[0].root',
          message: 'entity "Nobody" is not declared in module "shop"',
        },
      ]);
    });
  });
});

describe('additions to existing items', () => {
  const ex = () => [{ given: 'g', when: 'w', then: 't' }];
  const base = {
    irVersion: 1,
    modules: [{ name: 'shop', path: 'src/shop' }],
    entities: [
      {
        id: 'entity:Order',
        name: 'Order',
        module: 'shop',
        states: ['open', 'paid'],
        invariants: [{ id: 'invariant:Order/has-lines', text: 'x', on: null }],
        methods: [{ id: 'method:Order.pay', name: 'pay' }],
        source: 'src/shop/domain/order.ts:3',
      },
    ],
    events: [
      { id: 'event:OrderPaid', name: 'OrderPaid', module: 'shop', source: 'src/shop/domain/order.events.ts:1' },
    ],
    useCases: [
      {
        id: 'usecase:pay_order',
        name: 'pay_order',
        module: 'shop',
        uses: ['method:Order.pay'],
        emits: ['event:OrderPaid'],
        source: 'src/shop/application/pay-order.ts:1',
      },
    ],
    operators: [],
  } as unknown as IR;
  const empty = (): Delta => ({
    module: 'shop',
    entities: [],
    valueObjects: [],
    ports: [],
    events: [],
    useCases: [],
  });
  const addition = (): Delta => ({
    ...empty(),
    entityAdditions: [
      {
        entity: 'Order',
        invariants: [{ id: 'paid-once', text: 'Pay once.', examples: ex() }],
        methods: [
          {
            name: 'refund',
            description: 'Refunds.',
            params: [],
            returns: 'void',
            transition: { from: ['paid'], to: 'open' },
            invariants: [{ id: 'refund-needs-paid', text: 'Paid only.', examples: ex() }],
          },
        ],
      },
    ],
    useCaseAdditions: [
      { useCase: 'pay_order', uses: ['method:Order.refund'], emits: [] },
    ],
  });

  test('accepts additions to an existing entity and use-case', () => {
    expect(errorsOf(addition(), base)).toEqual([]);
  });

  test('a new event may belong to an existing entity', () => {
    const d = addition();
    d.events = [{ name: 'OrderRefunded', entity: 'Order', description: 'd', payload: [] }];
    expect(errorsOf(d, base)).toEqual([]);
  });

  test('every new invariant needs at least one example', () => {
    const d = addition();
    d.entityAdditions![0]!.invariants[0]!.examples = [];
    expect(errorsOf(d, base)[0]).toMatchObject({
      code: 'delta.schema-invalid',
      path: 'entityAdditions[0].invariants[0].examples',
    });
    const s = sampleDelta();
    delete (s.entities[0]!.invariants[0] as { examples?: unknown }).examples;
    expect(errorsOf(s)[0]).toMatchObject({
      code: 'delta.schema-invalid',
      path: 'entities[0].invariants[0].examples',
    });
  });

  test('example strings are capped and non-empty, and unknown keys fail', () => {
    const d = addition();
    d.entityAdditions![0]!.invariants[0]!.examples = [
      { given: 'x'.repeat(LIMITS.exampleText + 1), when: ' ', then: 't' },
    ];
    const paths = errorsOf(d, base).map((e) => e.path);
    expect(paths).toContain('entityAdditions[0].invariants[0].examples[0].given');
    expect(paths).toContain('entityAdditions[0].invariants[0].examples[0].when');
    const e = addition();
    (e.entityAdditions![0]!.invariants[0]!.examples[0] as Record<string, unknown>).extra = 1;
    expect(errorsOf(e, base)[0]!.code).toBe('delta.schema-invalid');
  });

  test.each<[string, (d: Delta) => void, ErrorCode, string]>([
    ['an unknown entity', (d) => (d.entityAdditions![0]!.entity = 'Nope'), 'delta.reference-unknown', 'entityAdditions[0].entity'],
    ['an existing method', (d) => (d.entityAdditions![0]!.methods[0]!.name = 'pay'), 'delta.name-collision', 'entityAdditions[0].methods[0].name'],
    ['an existing invariant', (d) => (d.entityAdditions![0]!.invariants[0]!.id = 'has-lines'), 'delta.name-collision', 'entityAdditions[0].invariants[0].id'],
    ['an unknown state', (d) => (d.entityAdditions![0]!.methods[0]!.transition!.to = 'gone'), 'delta.reference-unknown', 'entityAdditions[0].methods[0].transition.to'],
    ['a removal-like field', (d) => ((d.entityAdditions![0] as Record<string, unknown>).removeMethods = ['pay']), 'delta.schema-invalid', 'entityAdditions[0]'],
    ['a rename-like field', (d) => ((d.entityAdditions![0]!.methods[0] as Record<string, unknown>).renameTo = 'x'), 'delta.schema-invalid', 'entityAdditions[0].methods[0]'],
    ['a duplicate entity entry', (d) => d.entityAdditions!.push(structuredClone(d.entityAdditions![0]!)), 'delta.name-collision', 'entityAdditions[1].entity'],
    ['an unknown use-case', (d) => (d.useCaseAdditions![0]!.useCase = 'nope'), 'delta.reference-unknown', 'useCaseAdditions[0].useCase'],
    ['a use already on the use-case', (d) => (d.useCaseAdditions![0]!.uses = ['method:Order.pay']), 'delta.name-collision', 'useCaseAdditions[0].uses[0]'],
    ['an emit already on the use-case', (d) => (d.useCaseAdditions![0]!.emits = ['OrderPaid']), 'delta.name-collision', 'useCaseAdditions[0].emits[0]'],
    ['an unknown emit', (d) => (d.useCaseAdditions![0]!.emits = ['Ghost']), 'delta.reference-unknown', 'useCaseAdditions[0].emits[0]'],
    ['an unknown use', (d) => (d.useCaseAdditions![0]!.uses = ['method:Order.ghost']), 'delta.reference-unknown', 'useCaseAdditions[0].uses[0]'],
    ['an event of an unknown entity', (d) => (d.events = [{ name: 'X', entity: 'Ghost', description: 'd', payload: [] }]), 'delta.reference-unknown', 'events[0].entity'],
  ])('rejects %s', (_t, mutate, code, path) => {
    const d = addition();
    mutate(d);
    expect(errorsOf(d, base)).toContainEqual(expect.objectContaining({ code, path }));
  });
});
