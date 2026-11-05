import { z } from 'zod';
import type { Coded, ErrorCode, IR, IREntity, IRUseCase } from '../ir';
import { KEBAB, PASCAL } from '../validate';
import {
  INSTANCE_MEMBERS,
  PORT_MEMBERS,
  RENDERER_IMPORT_NAMES,
  STATIC_MEMBERS,
} from './names';

export interface DeltaError extends Coded {
  readonly path: string;
}

/**
 * Caps on every array of the schema, so a hostile Delta cannot make validation or rendering do
 * unbounded work. They are generous for a hand-written domain and are part of the contract.
 */
export const LIMITS = {
  entities: 200,
  valueObjects: 200,
  ports: 100,
  events: 400,
  useCases: 200,
  methods: 100,
  params: 20,
  fields: 100,
  invariants: 100,
  states: 50,
  /** emits, transition.from and use-case ports. */
  references: 100,
  uses: 100,
  /** given/when/then examples per invariant. */
  examples: 20,
  /** Characters of one given, when or then. */
  exampleText: 1_000,
} as const;

// Business text must carry something, as validate.ts `required` demands (non-empty after trim).
const notBlank = (s: string): boolean => s.trim() !== '';
const blankMessage = 'must not be empty or whitespace only';
const text = z.string().max(10_000).refine(notBlank, blankMessage);
const name = z.string().min(1).max(200);
// validate.ts refuses a blank state (transition-empty-state).
const state = name.refine(notBlank, blankMessage);
const list = <T extends z.ZodType>(item: T, max: number) =>
  z.array(item).max(max);

const field = z.strictObject({ name, type: name });
const exampleText = text.refine(
  (s) => s.length <= LIMITS.exampleText,
  `must have at most ${LIMITS.exampleText} characters`,
);
const example = z.strictObject({
  given: exampleText,
  when: exampleText,
  // eslint-disable-next-line unicorn/no-thenable
  then: exampleText,
});
// Every new invariant carries acceptance examples (ADR-0007 D10); they ride in the neutral layer.
const invariant = z.strictObject({
  id: name,
  text,
  examples: list(example, LIMITS.examples).min(1),
});
const method = z.strictObject({
  name,
  description: text,
  static: z.boolean().optional(),
  params: list(field, LIMITS.params),
  returns: name,
  emits: list(name, LIMITS.references).optional(),
  transition: z
    .strictObject({
      from: list(state, LIMITS.references).min(1),
      to: state,
    })
    .optional(),
  invariants: list(invariant, LIMITS.invariants).optional(),
});

export const deltaSchema = z.strictObject({
  module: name,
  /** Additions to entities that already exist in the base. Removing or renaming is not supported. */
  entityAdditions: list(
    z.strictObject({
      entity: name,
      invariants: list(invariant, LIMITS.invariants),
      methods: list(method, LIMITS.methods),
    }),
    LIMITS.entities,
  ).optional(),
  /** `uses` and `emits` added to use-cases that already exist in the base. */
  useCaseAdditions: list(
    z.strictObject({
      useCase: name,
      uses: list(name, LIMITS.uses),
      emits: list(name, LIMITS.references),
    }),
    LIMITS.useCases,
  ).optional(),
  entities: list(
    z.strictObject({
      name,
      description: text,
      states: list(state, LIMITS.states).optional(),
      invariants: list(invariant, LIMITS.invariants),
      methods: list(method, LIMITS.methods),
    }),
    LIMITS.entities,
  ),
  valueObjects: list(
    z.strictObject({
      name,
      description: text,
      fields: list(field, LIMITS.fields),
    }),
    LIMITS.valueObjects,
  ),
  ports: list(
    z.strictObject({
      name,
      description: text,
      root: name,
      methods: list(
        z.strictObject({
          name,
          description: text,
          params: list(field, LIMITS.params),
          returns: name,
        }),
        LIMITS.methods,
      ),
    }),
    LIMITS.ports,
  ),
  events: list(
    z.strictObject({
      name,
      entity: name,
      description: text,
      payload: list(field, LIMITS.fields),
    }),
    LIMITS.events,
  ),
  useCases: list(
    z.strictObject({
      name,
      description: text,
      whenToUse: text,
      whenNotToUse: text.optional(),
      input: list(field, LIMITS.fields),
      output: list(field, LIMITS.fields),
      uses: list(name, LIMITS.uses),
      emits: list(name, LIMITS.references),
      ports: list(name, LIMITS.references).optional(),
    }),
    LIMITS.useCases,
  ),
});

/** A field or parameter name may end in `?` to mark it optional. */
export function splitOptional(raw: string): { id: string; optional: boolean } {
  return raw.endsWith('?')
    ? { id: raw.slice(0, -1), optional: true }
    : { id: raw, optional: false };
}

export type Delta = z.infer<typeof deltaSchema>;

// KEBAB and PASCAL come from validate.ts; the rest are Delta-only.
// snake_case, at most 64 characters, no leading, trailing or doubled underscore (`foo-.ts`, class clashes).
const USE_CASE = /^(?=.{1,64}$)[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
// Windows reserves these as file names whatever the extension; names are ASCII-only, so no ¹²³ variants.
const DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;
const CAMEL = /^[a-z][A-Za-z0-9]*$/;
const FIELD = /^[a-z][A-Za-z0-9_]*$/;
const USES = /^method:([A-Z][A-Za-z0-9]*)\.([a-z][A-Za-z0-9]*)$/;

// JS/TS reserved and strict-mode words, global names the output uses, and every name the renderer imports.
const RESERVED: ReadonlySet<string> = new Set([
  ...(
    'break case catch class const continue debugger default delete do else enum export extends false ' +
    'finally for function if import in instanceof new null return super switch this throw true try ' +
    'typeof var void while with yield let static implements interface package private protected public ' +
    'await async abstract any as asserts bigint boolean constructor declare from get global infer is ' +
    'keyof module namespace never number object of out override readonly require set string symbol ' +
    'type undefined unique unknown arguments eval ' +
    'Array Boolean Date Error Function Map Number Object Promise Set String Symbol ' +
    'Reflect NaN Infinity Record Partial Readonly Required Pick Omit'
  ).split(' '),
  ...RENDERER_IMPORT_NAMES,
]);

export const PRIMITIVES = ['string', 'number', 'boolean', 'Date'] as const;

export type TypeExpr =
  | { readonly kind: 'primitive'; readonly name: (typeof PRIMITIVES)[number] }
  | { readonly kind: 'ref'; readonly name: string }
  | { readonly kind: 'array'; readonly of: TypeExpr };

/** Parses the allowlisted type grammar; null when the text is outside it. */
export function parseType(source: string): TypeExpr | null {
  let rest = source;
  let depth = 0;
  while (rest.endsWith('[]')) {
    rest = rest.slice(0, -2);
    depth++;
  }
  let base: TypeExpr;
  if ((PRIMITIVES as readonly string[]).includes(rest))
    base = { kind: 'primitive', name: rest as (typeof PRIMITIVES)[number] };
  else if (PASCAL.test(rest) && !RESERVED.has(rest))
    base = { kind: 'ref', name: rest };
  else return null;
  for (let i = 0; i < depth; i++) base = { kind: 'array', of: base };
  return base;
}

export const lcFirst = (s: string): string => s[0]!.toLowerCase() + s.slice(1);

export function kebab(pascal: string): string {
  return pascal
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

export function pascalOfSnake(snake: string): string {
  return snake
    .split('_')
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join('');
}

/** Plain code-unit comparison, so the order never depends on the locale. */
export const compareText = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/** The one error order: path, then code, then message. */
export const compareErrors = (a: DeltaError, b: DeltaError): number =>
  compareText(a.path, b.path) ||
  compareText(a.code, b.code) ||
  compareText(a.message, b.message);

export interface ValidateOptions {
  readonly base?: IR | null;
}

/** Zod shape check, then the semantic checks. Returns every problem, ordered by `compareErrors`. */
export function validateDelta(
  input: unknown,
  { base = null }: ValidateOptions = {},
): { ok: true; delta: Delta } | { ok: false; errors: DeltaError[] } {
  const parsed = deltaSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      errors: parsed.error.issues
        .map((i): DeltaError => ({
          code: 'delta.schema-invalid',
          path: pathOf(i.path),
          message:
            i.code === 'unrecognized_keys'
              ? `unrecognized keys: ${i.keys.slice(0, 5).map(show).join(', ')}${
                  i.keys.length > 5 ? ` and ${i.keys.length - 5} more` : ''
                }`
              : i.message,
        }))
        .sort(compareErrors),
    };
  const errors = new SemanticChecks(parsed.data, base).run();
  return errors.length === 0
    ? { ok: true, delta: parsed.data }
    : { ok: false, errors };
}

/** A client string for an error message: quoted, and cut so a hostile value cannot bloat the report. */
const show = (v: string): string =>
  JSON.stringify(v.length > 80 ? `${v.slice(0, 80)}...` : v);

function pathOf(path: readonly PropertyKey[]): string {
  return path.reduce<string>(
    (acc, k) =>
      typeof k === 'number'
        ? `${acc}[${k}]`
        : acc === ''
          ? String(k)
          : `${acc}.${String(k)}`,
    '',
  );
}

type EntityDecl = Delta['entities'][number];
type EntityMethodDecl = EntityDecl['methods'][number];
type EntityAdditionDecl = NonNullable<Delta['entityAdditions']>[number];
type UseCaseAdditionDecl = NonNullable<Delta['useCaseAdditions']>[number];
type PortDecl = Delta['ports'][number];
type FieldDecl = { name: string; type: string };

/** An optional list of the IR, empty when absent. */
export const orEmpty = <T>(items: readonly T[] | undefined): readonly T[] =>
  items ?? [];

/** Only elements of this module can be referenced, so the base is read through its module. */
const inModule = <T extends { module: string }>(
  items: readonly T[] | undefined,
  module: string,
): T[] => orEmpty(items).filter((x) => x.module === module);

/** The class namespace is checked against the whole base, every module included. */
function baseClassNames(base: IR | null): Set<string> {
  if (base === null) return new Set();
  return new Set(
    [
      ...base.entities,
      ...orEmpty(base.valueObjects),
      ...base.events,
      ...orEmpty(base.ports),
      ...orEmpty(base.adapters),
    ].map((x) => x.name),
  );
}

// Entity, invariant and method ids need no entry: a Delta entity named like a base one already
// fails `claimClass`, and invariant and method ids are scoped by the entity name.
const baseUseCaseIds = (base: IR | null): Set<string> =>
  new Set(base?.useCases.map((u) => u.id));

interface BaseIndex {
  /** Entities of the Delta's module. */
  readonly entities: readonly IREntity[];
  /** Use-cases of the Delta's module. */
  readonly useCases: readonly IRUseCase[];
  readonly events: ReadonlySet<string>;
  readonly typeNames: readonly string[];
  readonly portNames: readonly string[];
  /** `Entity.method` -> names of the events it emits. */
  readonly methodEmits: ReadonlyMap<string, readonly string[]>;
  readonly classes: ReadonlySet<string>;
  readonly ids: ReadonlySet<string>;
  /** `entity:Name` of every entity another entity contains. */
  readonly contained: ReadonlySet<string>;
}

function indexBase(base: IR | null, module: string): BaseIndex {
  const entities = inModule(base?.entities, module);
  return {
    entities,
    useCases: inModule(base?.useCases, module),
    events: new Set(inModule(base?.events, module).map((e) => e.name)),
    typeNames: [
      ...entities.map((e) => e.name),
      ...inModule(base?.valueObjects, module).map((v) => v.name),
    ],
    portNames: inModule(base?.ports, module).map((p) => p.name),
    methodEmits: new Map(
      entities.flatMap((e) =>
        e.methods.map((m): [string, string[]] => [
          m.id.replace(/^method:/, ''),
          m.emits.map((ev) => ev.replace(/^event:/, '')),
        ]),
      ),
    ),
    classes: baseClassNames(base),
    ids: baseUseCaseIds(base),
    contained: new Set(base?.entities.flatMap((e) => orEmpty(e.contains))),
  };
}

/** What one entity's methods and invariants are checked against. */
interface EntityScope {
  readonly name: string;
  readonly states: ReadonlySet<string>;
  readonly invariants: Set<string>;
  readonly methods: Set<string>;
  /** Ids already taken by this entity in the base (empty for a new entity). */
  readonly taken: ReadonlySet<string>;
}

/** The semantic checks, one method per kind of declaration; every problem lands in `#errors`. */
class SemanticChecks {
  readonly #delta: Delta;
  readonly #base: BaseIndex;
  readonly #errors: DeltaError[] = [];
  // One class-name namespace for the module: entities, value objects, ports, events, use-case classes.
  readonly #classes = new Set<string>();
  readonly #useCaseNames = new Set<string>();
  // Targets of additions seen so far: each existing item takes one addition entry.
  readonly #entityTargets = new Set<string>();
  readonly #useCaseTargets = new Set<string>();
  readonly #entityNames: ReadonlySet<string>;
  readonly #eventNames: ReadonlySet<string>;
  readonly #typeNames: ReadonlySet<string>;
  readonly #methodEmits: ReadonlyMap<string, readonly string[]>;
  readonly #portNames: ReadonlySet<string>;

  constructor(delta: Delta, base: IR | null) {
    this.#delta = delta;
    this.#base = indexBase(base, delta.module);
    this.#entityNames = new Set(delta.entities.map((e) => e.name));
    this.#eventNames = new Set(delta.events.map((e) => e.name));
    this.#typeNames = new Set([
      ...this.#entityNames,
      ...delta.valueObjects.map((v) => v.name),
      ...this.#base.typeNames,
    ]);
    this.#methodEmits = new Map([
      ...this.#base.methodEmits,
      ...delta.entities.flatMap((e) =>
        e.methods.map((m): [string, readonly string[]] => [
          `${e.name}.${m.name}`,
          m.emits ?? [],
        ]),
      ),
      ...orEmpty(delta.entityAdditions).flatMap((e) =>
        e.methods.map((m): [string, readonly string[]] => [
          `${e.entity}.${m.name}`,
          m.emits ?? [],
        ]),
      ),
    ]);
    this.#portNames = new Set([
      ...delta.ports.map((p) => p.name),
      ...this.#base.portNames,
    ]);
  }

  run(): DeltaError[] {
    const d = this.#delta;
    this.ident('module', d.module, KEBAB, 'kebab-case module name');
    d.entities.forEach((e, i) => this.entity(e, i));
    orEmpty(d.entityAdditions).forEach((a, i) => this.entityAddition(a, i));
    d.valueObjects.forEach((v, i) => this.valueObject(v, i));
    d.ports.forEach((p, i) => this.port(p, i));
    d.events.forEach((e, i) => this.event(e, i));
    d.useCases.forEach((u, i) => this.useCase(u, i));
    orEmpty(d.useCaseAdditions).forEach((u, i) => this.useCaseAddition(u, i));
    return this.#errors.sort(compareErrors);
  }

  add(code: ErrorCode, path: string, message: string): void {
    this.#errors.push({ code, path, message });
  }

  /** `binding`: the name becomes a class or a parameter, so a reserved word cannot be used. */
  ident(
    path: string,
    value: string,
    re: RegExp,
    label: string,
    binding = false,
  ): void {
    if (!re.test(value) || (binding && RESERVED.has(value)))
      this.add(
        'delta.invalid-identifier',
        path,
        `${show(value)} is not a valid ${label}`,
      );
  }

  member(path: string, value: string, taken: ReadonlySet<string>): void {
    if (taken.has(value))
      this.add(
        'delta.invalid-identifier',
        path,
        `${show(value)} clashes with a built-in or inherited member`,
      );
  }

  claim(
    scope: Set<string>,
    key: string,
    path: string,
    id = key,
    taken: ReadonlySet<string> = this.#base.ids,
  ): void {
    if (scope.has(key))
      this.add(
        'delta.name-collision',
        path,
        `${show(id)} is declared twice in the Delta`,
      );
    else if (taken.has(id))
      this.add(
        'delta.name-collision',
        path,
        `${show(id)} already exists in the base; removing or redeclaring existing items is not supported`,
      );
    scope.add(key);
  }

  claimClass(cls: string, path: string, id: string): void {
    if (this.#classes.has(cls))
      this.add(
        'delta.name-collision',
        path,
        `class ${show(cls)} (${show(id)}) is already declared in this Delta`,
      );
    else if (this.#base.classes.has(cls))
      this.add(
        'delta.name-collision',
        path,
        `class ${show(cls)} (${show(id)}) already exists in the base; removing or renaming existing items is not supported`,
      );
    this.#classes.add(cls);
  }

  /** Every entity, value object, port and use case becomes a file named after it. */
  fileName(path: string, stem: string): void {
    if (DEVICE.test(stem))
      this.add(
        'delta.invalid-identifier',
        path,
        `${show(stem)} is a reserved Windows device name and cannot be a file name`,
      );
  }

  type(path: string, source: string): void {
    const t = parseType(source);
    if (t === null) {
      this.add(
        'delta.type-invalid',
        path,
        `${show(source)} is not an allowed type`,
      );
      return;
    }
    let leaf = t;
    while (leaf.kind === 'array') leaf = leaf.of;
    if (leaf.kind === 'ref' && !this.#typeNames.has(leaf.name))
      this.add(
        'delta.reference-unknown',
        path,
        `type ${show(leaf.name)} is not declared`,
      );
  }

  fields(
    path: string,
    fields: readonly FieldDecl[],
    re: RegExp,
    label: string,
    params = false,
  ): void {
    const seen = new Set<string>();
    let optionalSeen = false;
    fields.forEach((f, i) => {
      const { id, optional } = splitOptional(f.name);
      this.ident(`${path}[${i}].name`, id, re, label, params);
      this.type(`${path}[${i}].type`, f.type);
      this.claim(seen, id, `${path}[${i}].name`);
      if (params) {
        if (!optional && optionalSeen)
          this.add(
            'delta.schema-invalid',
            `${path}[${i}].name`,
            'a required parameter cannot follow an optional one',
          );
        optionalSeen ||= optional;
      }
    });
  }

  noDuplicates(path: string, items: readonly string[] | undefined): void {
    const seen = new Set<string>();
    items?.forEach((v, i) => {
      if (seen.has(v))
        this.add(
          'delta.name-collision',
          `${path}[${i}]`,
          `${show(v)} is listed twice`,
        );
      seen.add(v);
    });
  }

  emits(path: string, items: readonly string[] | undefined): void {
    items?.forEach((ev, i) => {
      if (!this.#eventNames.has(ev) && !this.#base.events.has(ev))
        this.add(
          'delta.reference-unknown',
          `${path}[${i}]`,
          `event ${show(ev)} is not declared in module ${show(this.#delta.module)}`,
        );
    });
  }

  /** The name, parameters and return type that entity and port methods share. */
  signature(
    path: string,
    m: { name: string; params: readonly FieldDecl[]; returns: string },
    members: ReadonlySet<string>,
    scope: Set<string>,
    id: string,
    taken?: ReadonlySet<string>,
  ): void {
    this.ident(`${path}.name`, m.name, CAMEL, 'camelCase method name');
    this.member(`${path}.name`, m.name, members);
    this.claim(scope, m.name, `${path}.name`, id, taken);
    this.fields(
      `${path}.params`,
      m.params,
      CAMEL,
      'camelCase parameter name',
      true,
    );
    if (m.returns !== 'void') this.type(`${path}.returns`, m.returns);
  }

  invariants(
    scope: EntityScope,
    path: string,
    items: readonly { id: string }[] | undefined,
  ): void {
    items?.forEach((inv, ii) => {
      this.ident(`${path}[${ii}].id`, inv.id, KEBAB, 'kebab-case invariant id');
      this.claim(
        scope.invariants,
        inv.id,
        `${path}[${ii}].id`,
        `invariant:${scope.name}/${inv.id}`,
        scope.taken,
      );
    });
  }

  entity(entity: EntityDecl, ei: number): void {
    const ep = `entities[${ei}]`;
    this.ident(
      `${ep}.name`,
      entity.name,
      PASCAL,
      'PascalCase entity name',
      true,
    );
    this.fileName(`${ep}.name`, kebab(entity.name));
    this.claimClass(entity.name, `${ep}.name`, `entity:${entity.name}`);
    this.noDuplicates(`${ep}.states`, entity.states);
    this.members(ep, entity.name, new Set(orEmpty(entity.states)), entity);
  }

  /** Invariants and methods added to an entity the base already has; its states come from the base. */
  entityAddition(add: EntityAdditionDecl, i: number): void {
    const p = `entityAdditions[${i}]`;
    const target = this.baseEntity(add.entity);
    this.additionTarget(
      this.#entityTargets,
      target !== undefined,
      add.entity,
      `${p}.entity`,
      `entity ${show(add.entity)} does not exist in module ${show(this.#delta.module)} of the base (new entities go in entities)`,
      `entity ${show(add.entity)} has more than one addition entry`,
    );
    const taken = new Set([
      ...this.#base.ids,
      ...orEmpty(target?.invariants).map((v) => v.id),
      ...orEmpty(target?.methods).map((m) => m.id),
    ]);
    this.members(p, add.entity, new Set(orEmpty(target?.states)), add, taken);
  }

  baseEntity(name: string): IREntity | undefined {
    return this.#base.entities.find((e) => e.name === name);
  }

  /** Shared by new entities and additions: invariant ids and method names are claimed per entity. */
  members(
    ep: string,
    name: string,
    states: ReadonlySet<string>,
    entity: Pick<EntityDecl, 'invariants' | 'methods'>,
    taken: ReadonlySet<string> = this.#base.ids,
  ): void {
    const scope: EntityScope = {
      name,
      states,
      invariants: new Set(),
      methods: new Set(),
      taken,
    };
    this.invariants(scope, `${ep}.invariants`, entity.invariants);
    entity.methods.forEach((m, mi) =>
      this.entityMethod(scope, m, `${ep}.methods[${mi}]`),
    );
  }

  entityMethod(scope: EntityScope, m: EntityMethodDecl, mp: string): void {
    this.signature(
      mp,
      m,
      m.static ? STATIC_MEMBERS : INSTANCE_MEMBERS,
      scope.methods,
      `method:${scope.name}.${m.name}`,
      scope.taken,
    );
    this.emits(`${mp}.emits`, m.emits);
    this.noDuplicates(`${mp}.emits`, m.emits);
    if (m.transition)
      this.transition(scope.states, `${mp}.transition`, m.transition);
    this.invariants(scope, `${mp}.invariants`, m.invariants);
  }

  transition(
    states: ReadonlySet<string>,
    path: string,
    t: { from: readonly string[]; to: string },
  ): void {
    this.noDuplicates(`${path}.from`, t.from);
    for (const [i, s] of t.from.entries())
      if (!states.has(s))
        this.add(
          'delta.reference-unknown',
          `${path}.from[${i}]`,
          `state ${show(s)} is not declared`,
        );
    if (!states.has(t.to))
      this.add(
        'delta.reference-unknown',
        `${path}.to`,
        `state ${show(t.to)} is not declared`,
      );
  }

  valueObject(vo: Delta['valueObjects'][number], vi: number): void {
    const vp = `valueObjects[${vi}]`;
    this.ident(
      `${vp}.name`,
      vo.name,
      PASCAL,
      'PascalCase value object name',
      true,
    );
    this.fileName(`${vp}.name`, kebab(vo.name));
    this.claimClass(vo.name, `${vp}.name`, `valueobject:${vo.name}`);
    // The renderer declares the props interface next to the imports of the file.
    this.claimClass(`${vo.name}Props`, `${vp}.name`, `valueobject:${vo.name}`);
    this.fields(`${vp}.fields`, vo.fields, FIELD, 'field name');
  }

  port(port: PortDecl, i: number): void {
    const p = `ports[${i}]`;
    this.ident(`${p}.name`, port.name, PASCAL, 'PascalCase port name', true);
    this.fileName(`${p}.name`, kebab(port.name));
    this.claimClass(port.name, `${p}.name`, `port:${port.name}`);
    this.portRoot(port.root, `${p}.root`);
    const methods = new Set<string>();
    port.methods.forEach((m, mi) =>
      this.signature(`${p}.methods[${mi}]`, m, PORT_MEMBERS, methods, m.name),
    );
  }

  portRoot(root: string, path: string): void {
    if (this.#entityNames.has(root)) return;
    if (!this.#base.entities.some((e) => e.name === root))
      this.add(
        'delta.reference-unknown',
        path,
        `entity ${show(root)} is not declared in module ${show(this.#delta.module)}`,
      );
    else if (this.#base.contained.has(`entity:${root}`))
      this.add(
        'delta.reference-unknown',
        path,
        `entity ${show(root)} is not an aggregate root (another entity contains it)`,
      );
  }

  event(ev: Delta['events'][number], i: number): void {
    const p = `events[${i}]`;
    this.ident(`${p}.name`, ev.name, PASCAL, 'PascalCase event name', true);
    this.claimClass(ev.name, `${p}.name`, `event:${ev.name}`);
    if (!this.#entityNames.has(ev.entity) && !this.baseEntity(ev.entity))
      this.add(
        'delta.reference-unknown',
        `${p}.entity`,
        `entity ${show(ev.entity)} is not declared in this Delta or in module ${show(this.#delta.module)} of the base`,
      );
    this.fields(`${p}.payload`, ev.payload, FIELD, 'field name');
  }

  useCase(uc: Delta['useCases'][number], i: number): void {
    const p = `useCases[${i}]`;
    this.ident(`${p}.name`, uc.name, USE_CASE, 'snake_case use-case name');
    this.claim(this.#useCaseNames, uc.name, `${p}.name`, `usecase:${uc.name}`);
    this.fileName(`${p}.name`, uc.name.replace(/_/g, '-'));
    if (USE_CASE.test(uc.name)) this.useCaseClass(uc.name, `${p}.name`);
    this.noDuplicates(`${p}.uses`, uc.uses);
    this.noDuplicates(`${p}.emits`, uc.emits);
    this.noDuplicates(`${p}.ports`, uc.ports);
    this.fields(`${p}.input`, uc.input, FIELD, 'field name');
    this.fields(`${p}.output`, uc.output, FIELD, 'field name');
    this.uses(`${p}.uses`, uc.uses);
    this.emits(`${p}.emits`, uc.emits);
    this.emitsMatchUses(uc, p);
    uc.ports?.forEach((port, pi) => this.useCasePort(port, `${p}.ports[${pi}]`));
  }

  /** As validate.ts checks it: emits is exactly the events of the methods in uses. */
  emitsMatchUses(uc: Delta['useCases'][number], path: string): void {
    const reachable = new Set<string>();
    for (const u of uc.uses) {
      const m = USES.exec(u);
      for (const ev of (m && this.#methodEmits.get(`${m[1]}.${m[2]}`)) || []) {
        reachable.add(ev);
        if (!uc.emits.includes(ev))
          this.add(
            'delta.reference-unknown',
            `${path}.emits`,
            `${show(u)} emits ${show(ev)}, which is missing from emits`,
          );
      }
    }
    uc.emits.forEach((ev, i) => {
      if (!reachable.has(ev))
        this.add(
          'delta.reference-unknown',
          `${path}.emits[${i}]`,
          `event ${show(ev)} is not emitted by any method in uses`,
        );
    });
  }

  /** The class is declared next to what the file imports, so it must not shadow any of it. */
  useCaseClass(name: string, path: string): void {
    const cls = pascalOfSnake(name);
    if (RESERVED.has(cls))
      this.add(
        'delta.invalid-identifier',
        path,
        `class ${show(cls)} would shadow a name the generated file uses`,
      );
    else
      // The renderer also declares the Input and Output types next to the imports of the file.
      for (const c of [cls, `${cls}Input`, `${cls}Output`])
        this.claimClass(c, path, `usecase:${name}`);
  }

  uses(path: string, items: readonly string[]): void {
    items.forEach((u, ui) => this.use(u, `${path}[${ui}]`));
  }

  use(u: string, path: string): void {
    const m = USES.exec(u);
    if (!m)
      this.add(
        'delta.invalid-identifier',
        path,
        `${show(u)} must look like method:Entity.method`,
      );
    else if (!this.#methodEmits.has(`${m[1]}.${m[2]}`))
      this.add(
        'delta.reference-unknown',
        path,
        `${show(u)} is not declared in module ${show(this.#delta.module)}`,
      );
  }

  useCasePort(port: string, path: string): void {
    if (RESERVED.has(lcFirst(port)))
      this.add(
        'delta.invalid-identifier',
        path,
        `port ${show(port)} would give a constructor parameter named after a reserved word`,
      );
    if (!this.#portNames.has(port))
      this.add(
        'delta.reference-unknown',
        path,
        `port ${show(port)} is not declared in module ${show(this.#delta.module)}`,
      );
  }

  useCaseAddition(ua: UseCaseAdditionDecl, i: number): void {
    const p = `useCaseAdditions[${i}]`;
    const target = this.#base.useCases.find((u) => u.name === ua.useCase);
    this.additionTarget(
      this.#useCaseTargets,
      target !== undefined,
      ua.useCase,
      `${p}.useCase`,
      `use-case ${show(ua.useCase)} does not exist in module ${show(this.#delta.module)} of the base (new use-cases go in useCases)`,
      `use-case ${show(ua.useCase)} has more than one addition entry`,
    );
    this.noDuplicates(`${p}.uses`, ua.uses);
    this.noDuplicates(`${p}.emits`, ua.emits);
    this.uses(`${p}.uses`, ua.uses);
    this.emits(`${p}.emits`, ua.emits);
    const existingEmits = orEmpty(target?.emits).map((e) =>
      e.replace(/^event:/, ''),
    );
    this.alreadyListed(`${p}.uses`, ua.uses, target?.uses, 'used');
    this.alreadyListed(
      `${p}.emits`,
      ua.emits,
      existingEmits,
      'emitted',
    );
  }

  /** An addition names an item the base already has; each item takes one entry. */
  additionTarget(
    seen: Set<string>,
    exists: boolean,
    name: string,
    path: string,
    missing: string,
    twice: string,
  ): void {
    if (!exists) this.add('delta.reference-unknown', path, missing);
    else if (seen.has(name)) this.add('delta.name-collision', path, twice);
    seen.add(name);
  }

  /** A `uses` or `emits` entry the base use-case already lists would be written twice. */
  alreadyListed(
    path: string,
    items: readonly string[],
    existing: readonly string[] | undefined,
    verb: string,
  ): void {
    items.forEach((item, i) => {
      if (existing?.includes(item))
        this.add(
          'delta.name-collision',
          `${path}[${i}]`,
          `${show(item)} is already ${verb} by the base use-case`,
        );
    });
  }
}
