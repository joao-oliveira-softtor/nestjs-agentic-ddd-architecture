import { describe, expect, test } from 'bun:test';
import { ERROR_CODES } from '../../contracts/codes';
import type { IR } from '../ir';
import { parseType, validateDelta, type Delta } from './schema';
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
