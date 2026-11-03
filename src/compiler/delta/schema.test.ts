import { describe, expect, test } from 'bun:test';
import { ERROR_CODES } from '../../contracts/codes';
import type { ErrorCode, IR } from '../ir';
import { LIMITS, parseType, validateDelta, type Delta } from './schema';
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

  test('a collision with the base says additions to existing items are not supported yet', () => {
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
    expect(e.message).toContain(
      'additions to existing items are not supported yet',
    );
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
