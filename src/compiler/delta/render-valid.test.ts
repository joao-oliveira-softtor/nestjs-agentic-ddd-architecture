import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import ts from 'typescript';
import { analyzeProject } from '../compile';
import { DEFAULT_CONVENTIONS } from '../conventions';
import type { IR } from '../ir';
import {
  additionDelta,
  baseIR,
  HOSTILE,
  spliceScenario,
} from './additions-fixture';
import { renderDelta, type RenderedFile } from './render';
import { sampleDelta } from './sample';
import type { Delta } from './schema';
import { splice } from './splice';

// The anchor for "a Delta that validates must render code that compiles": every case is either
// rejected with an expected coded error and path, or rendered, type-checked with semantic
// diagnostics and run through the project validator exactly as `compile` does.

const ROOT = resolve(import.meta.dir, '../../..');
const conventions = DEFAULT_CONVENTIONS;

const stub = (over: Partial<IR> = {}): IR => ({
  irVersion: 1,
  modules: [{ name: 'shop', path: 'src/shop' }],
  entities: [],
  valueObjects: [],
  events: [],
  ports: [],
  adapters: [],
  useCases: [],
  operators: [],
  ...over,
});
const entity = (name: string, module = 'shop', contains: string[] = []) => ({
  id: `entity:${name}`,
  name,
  module,
  description: 'x',
  states: [],
  invariants: [],
  methods: [],
  contains,
  source: `src/${module}/domain/${name.toLowerCase()}.ts:3`,
});
const event = (name: string, module: string) => ({
  id: `event:${name}`,
  name,
  module,
  description: 'x',
  payloadSchema: {},
  source: `src/${module}/domain/${name.toLowerCase()}.events.ts:3`,
});
const port = (name: string, module: string) => ({
  id: `port:${name}`,
  name,
  module,
  description: 'x',
  root: 'entity:Order',
  methods: [],
  source: `src/${module}/domain/${name.toLowerCase()}.ts:3`,
});

const render = (
  delta: Delta,
  base: IR | null = null,
  existing: string[] = [],
) => renderDelta(delta, { conventions, base, existingFiles: existing });

const NONE: string[] = [];

interface Reject {
  readonly title: string;
  readonly mutate: (d: Delta) => void;
  readonly base?: IR;
  readonly existing?: string[];
  readonly code: string;
  readonly path: string;
}

const rejects: Reject[] = [
  {
    title: 'a port and an event with the same name',
    mutate: (d) => (d.ports[0]!.name = 'ProductCreated'),
    code: 'delta.name-collision',
    path: 'events[0].name',
  },
  {
    title: 'a use-case class named like a port',
    mutate: (d) => (d.useCases[1]!.name = 'product_repository'),
    code: 'delta.name-collision',
    path: 'useCases[1].name',
  },
  {
    title: 'a value object named like a base entity',
    mutate: (d) => (d.valueObjects[0]!.name = 'Order'),
    base: stub({ entities: [entity('Order')] }),
    code: 'delta.name-collision',
    path: 'valueObjects[0].name',
  },
  {
    title: 'an event named like a base entity',
    mutate: (d) => (d.events[0]!.name = 'Order'),
    base: stub({ entities: [entity('Order')] }),
    code: 'delta.name-collision',
    path: 'events[0].name',
  },
  {
    title: 'a port named like a base entity',
    mutate: (d) => (d.ports[0]!.name = 'Order'),
    base: stub({ entities: [entity('Order')] }),
    code: 'delta.name-collision',
    path: 'ports[0].name',
  },
  {
    title: 'a required parameter after an optional one (entity)',
    mutate: (d) =>
      (d.entities[0]!.methods[0]!.params = [
        { name: 'a?', type: 'string' },
        { name: 'b', type: 'string' },
      ]),
    code: 'delta.schema-invalid',
    path: 'entities[0].methods[0].params[1].name',
  },
  {
    title: 'a required parameter after an optional one (port)',
    mutate: (d) =>
      (d.ports[0]!.methods[0]!.params = [
        { name: 'a?', type: 'string' },
        { name: 'b', type: 'string' },
      ]),
    code: 'delta.schema-invalid',
    path: 'ports[0].methods[0].params[1].name',
  },
  ...['name', 'length', 'prototype', 'apply', 'call', 'bind'].map(
    (n): Reject => ({
      title: `a static method named ${n}`,
      mutate: (d) => {
        d.entities[0]!.methods[0]!.name = n;
      },
      code: 'delta.invalid-identifier',
      path: 'entities[0].methods[0].name',
    }),
  ),
  ...['id', 'equals', 'record', 'pullEvents', 'toString', 'hasOwnProperty'].map(
    (n): Reject => ({
      title: `an instance method named ${n}`,
      mutate: (d) => {
        d.entities[0]!.methods[1]!.name = n;
      },
      code: 'delta.invalid-identifier',
      path: 'entities[0].methods[1].name',
    }),
  ),
  {
    title: 'a parameter that shadows notImplemented',
    mutate: (d) =>
      (d.entities[0]!.methods[0]!.params[0]!.name = 'notImplemented'),
    code: 'delta.invalid-identifier',
    path: 'entities[0].methods[0].params[0].name',
  },
  {
    title: 'an entity named like a decorator the file imports',
    mutate: (d) => (d.entities[0]!.name = 'AgentPort'),
    code: 'delta.invalid-identifier',
    path: 'entities[0].name',
  },
  {
    title: 'a port named like a core class the file imports',
    mutate: (d) => (d.ports[0]!.name = 'UseCaseContext'),
    code: 'delta.invalid-identifier',
    path: 'ports[0].name',
  },
  {
    title: 'an empty transition.from',
    mutate: (d) => (d.entities[0]!.methods[1]!.transition!.from = []),
    code: 'delta.schema-invalid',
    path: 'entities[0].methods[1].transition.from',
  },
  {
    title: 'a whitespace-only entity description',
    mutate: (d) => (d.entities[0]!.description = '  \n\t '),
    code: 'delta.schema-invalid',
    path: 'entities[0].description',
  },
  {
    title: 'a whitespace-only use-case whenToUse',
    mutate: (d) => (d.useCases[0]!.whenToUse = '   '),
    code: 'delta.schema-invalid',
    path: 'useCases[0].whenToUse',
  },
  {
    title: 'a whitespace-only invariant text',
    mutate: (d) => (d.entities[0]!.invariants[0]!.text = ' '),
    code: 'delta.schema-invalid',
    path: 'entities[0].invariants[0].text',
  },
  {
    title: 'a type from another module',
    mutate: (d) => (d.valueObjects[0]!.fields[0]!.type = 'Foreign'),
    base: stub({ entities: [entity('Foreign', 'other')] }),
    code: 'delta.reference-unknown',
    path: 'valueObjects[0].fields[0].type',
  },
  {
    title: 'an event from another module',
    mutate: (d) => (d.entities[0]!.methods[0]!.emits = ['Elsewhere']),
    base: stub({ events: [event('Elsewhere', 'other')] }),
    code: 'delta.reference-unknown',
    path: 'entities[0].methods[0].emits[0]',
  },
  {
    title: 'a port from another module',
    mutate: (d) => (d.useCases[0]!.ports = ['Remote']),
    base: stub({ ports: [port('Remote', 'other')] }),
    code: 'delta.reference-unknown',
    path: 'useCases[0].ports[0]',
  },
  {
    title: 'a port root from another module',
    mutate: (d) => (d.ports[0]!.root = 'Foreign'),
    base: stub({ entities: [entity('Foreign', 'other')] }),
    code: 'delta.reference-unknown',
    path: 'ports[0].root',
  },
  {
    title: 'a port root that is not an aggregate root',
    mutate: (d) => (d.ports[0]!.root = 'Line'),
    base: stub({
      entities: [entity('Order', 'shop', ['entity:Line']), entity('Line')],
    }),
    code: 'delta.reference-unknown',
    path: 'ports[0].root',
  },
  {
    title: 'a file that already exists in the module, in another case',
    mutate: () => {},
    existing: ['Domain/PRODUCT.ts'],
    code: 'delta.path-collision',
    path: 'entities[0]',
  },
  {
    title: 'two files whose paths differ only by case',
    mutate: (d) => {
      d.valueObjects[0]!.name = 'AB';
      d.entities[0]!.methods[0]!.params[1]!.type = 'AB';
      d.valueObjects.push({
        name: 'Ab',
        description: 'x',
        fields: [{ name: 'a', type: 'string' }],
      });
    },
    code: 'delta.path-collision',
    path: 'valueObjects[1]',
  },
];

describe('renderDelta rejects what cannot compile', () => {
  test.each(rejects.map((r) => [r.title, r] as const))('%s', (_t, c) => {
    const d = sampleDelta();
    c.mutate(d);
    const r = render(d, c.base ?? null, c.existing ?? NONE);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors).toContainEqual(
        expect.objectContaining({ code: c.code, path: c.path }),
      );
  });
});

const valid: [string, (d: Delta) => void][] = [
  ['the sample', () => {}],
  [
    'every parameter optional',
    (d) =>
      (d.entities[0]!.methods[0]!.params = [
        { name: 'a?', type: 'string' },
        { name: 'b?', type: 'number' },
      ]),
  ],
  [
    'a value object array parameter and a void port method',
    (d) => (d.entities[0]!.methods[0]!.params[1]!.type = 'Money[]'),
  ],
  [
    'an entity with no methods and no states',
    (d) => {
      d.entities[0]!.methods = [];
      d.entities[0]!.states = [];
      d.events = [];
      d.useCases = [];
      d.ports = [];
    },
  ],
  [
    'a use-case with no ports and empty input',
    (d) => {
      d.useCases[1]!.input = [];
    },
  ],
];

const spliced: [string, Delta][] = [
  ['additions spliced into an existing module', additionDelta()],
  ['hostile client strings in spliced additions', additionDelta(HOSTILE)],
];

const SAME_FILE = 'an emitted event declared in the entity file';

// A hand-written base where the entity and the event it emits share one file: the fragment must
// not import `OrderPaid` from the file it is spliced into.
function sameFileScenario(): RenderedFile[] {
  const original = `import { AggregateRoot, DomainEvent, notImplemented } from '@agentic-ddd/core';
import { AgentEntity, AgentEvent, AgentMethod } from '@agentic-ddd/decorators';
import { z } from 'zod';

const orderPaidPayload = z.object({});

@AgentEvent({ description: 'Paid.', payload: orderPaidPayload })
export class OrderPaid extends DomainEvent<z.infer<typeof orderPaidPayload>> {}

@AgentEntity({ description: 'An order.', states: ['open', 'paid'] })
export class Order extends AggregateRoot<string> {
  @AgentMethod({
    description: 'Pays the order.',
    transition: { from: ['open'], to: 'paid' },
    emits: [OrderPaid],
  })
  pay(): void {
    return notImplemented();
  }
}
`;
  const ir = baseIR();
  const base: IR = {
    ...ir,
    events: [{ ...ir.events[0]!, source: 'src/shop/domain/order.ts:3' }],
  };
  const r = renderDelta(
    {
      module: 'shop',
      entityAdditions: [
        {
          entity: 'Order',
          invariants: [],
          methods: [
            {
              name: 'settle',
              description: 'Settles it.',
              params: [],
              returns: 'void',
              transition: { from: ['paid'], to: 'open' },
              emits: ['OrderPaid'],
            },
          ],
        },
      ],
      entities: [],
      valueObjects: [],
      ports: [],
      events: [],
      useCases: [],
    },
    { conventions, base, existingFiles: ['domain/order.ts'] },
  );
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  let content = original;
  for (const frag of r.fragments) {
    const s = splice(content, frag);
    if (!s.ok) throw new Error(JSON.stringify(s.error));
    content = s.source;
  }
  return [{ path: 'domain/order.ts', content }];
}

const written: string[] = [];
afterAll(async () => {
  for (const dir of written) await rm(dir, { recursive: true, force: true });
});

async function project(files: readonly RenderedFile[]) {
  await mkdir(join(ROOT, '.tmp'), { recursive: true });
  const proj = await mkdtemp(join(ROOT, '.tmp', 'delta-valid-'));
  written.push(proj);
  for (const f of files) {
    const target = join(proj, 'shop', f.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, f.content);
  }
  const configPath = join(proj, 'agentic.config.ts');
  await writeFile(
    configPath,
    `import { defineConfig } from '@agentic-ddd/compiler';
export default defineConfig({ root: '../..', modules: [{ name: 'shop', path: '.tmp/${basename(proj)}/shop' }] });
`,
  );
  return { proj, configPath };
}

// One TypeScript program for every case: the check is the slow part, and its diagnostics are
// attributed back to each case by the file they belong to.
function semanticDiagnostics(
  cases: readonly { proj: string; files: readonly RenderedFile[] }[],
) {
  const read = ts.readConfigFile(join(ROOT, 'tsconfig.json'), (f) =>
    ts.sys.readFile(f),
  );
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT);
  const options = { ...parsed.options, noEmit: true };
  const program = ts.createProgram(
    cases.flatMap((c) => c.files.map((f) => join(c.proj, 'shop', f.path))),
    options,
  );
  const all = ts.getPreEmitDiagnostics(program);
  return cases.map((c) =>
    all
      .filter(
        (d) =>
          d.file === undefined ||
          resolve(d.file.fileName).startsWith(resolve(c.proj) + sep),
      )
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
  );
}

describe('renderDelta output type-checks and passes the validator', () => {
  const results = new Map<
    string,
    { diagnostics: string[]; errors: unknown[] }
  >();

  beforeAll(async () => {
    const cases = [];
    for (const [title, mutate] of valid) {
      const d = sampleDelta();
      mutate(d);
      const r = render(d);
      if (!r.ok) throw new Error(`${title}: ${JSON.stringify(r.errors)}`);
      cases.push({ title, files: r.files, ...(await project(r.files)) });
    }
    // Spliced files (additions to existing files) join the same batched program.
    for (const [title, delta] of spliced) {
      const files = spliceScenario(delta).spliced;
      cases.push({ title, files, ...(await project(files)) });
    }
    const sameFile = sameFileScenario();
    cases.push({
      title: SAME_FILE,
      files: sameFile,
      ...(await project(sameFile)),
    });
    const diagnostics = semanticDiagnostics(cases);
    for (const [i, c] of cases.entries()) {
      const { errors } = await analyzeProject({ configPath: c.configPath });
      results.set(c.title, { diagnostics: diagnostics[i]!, errors });
    }
  }, 120_000);

  test.each([...valid.map(([title]) => title), ...spliced.map(([t]) => t), SAME_FILE].map((t) => [t] as const))('%s', (title) => {
    expect(results.get(title)).toEqual({ diagnostics: [], errors: [] });
  });
});
