import { z } from 'zod';
import type { Coded, ErrorCode, IR } from '../ir';
import {
  INSTANCE_MEMBERS,
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
} as const;

// Business text must carry something, as validate.ts `required` demands (non-empty after trim).
const text = z
  .string()
  .max(10_000)
  .refine((s) => s.trim() !== '', 'must not be empty or whitespace only');
const name = z.string().min(1).max(200);
const list = <T extends z.ZodType>(item: T, max: number) =>
  z.array(item).max(max);

const field = z.strictObject({ name, type: name });
const invariant = z.strictObject({ id: name, text });
const method = z.strictObject({
  name,
  description: text,
  static: z.boolean().optional(),
  params: list(field, LIMITS.params),
  returns: name,
  emits: list(name, LIMITS.references).optional(),
  transition: z
    .strictObject({
      from: list(name, LIMITS.references).min(1),
      to: name,
    })
    .optional(),
  invariants: list(invariant, LIMITS.invariants).optional(),
});

export const deltaSchema = z.strictObject({
  module: name,
  entities: list(
    z.strictObject({
      name,
      description: text,
      states: list(name, LIMITS.states).optional(),
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

// Same patterns as validate.ts, plus camelCase for methods, params and fields.
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SNAKE = /^[a-z][a-z0-9_]{0,63}$/;
// Stricter than SNAKE: no leading, trailing or doubled underscore, which would give `foo-.ts` and class clashes.
const USE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
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
    'Array Boolean Date Error Function Map Number Object Promise Set String Symbol'
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
  options: ValidateOptions = {},
): { ok: true; delta: Delta } | { ok: false; errors: DeltaError[] } {
  const parsed = deltaSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      errors: parsed.error.issues
        .map((i): DeltaError => ({
          code: 'delta.schema-invalid',
          path: pathOf(i.path),
          message: i.message,
        }))
        .sort(compareErrors),
    };
  const errors = semanticErrors(parsed.data, options.base ?? null);
  return errors.length === 0
    ? { ok: true, delta: parsed.data }
    : { ok: false, errors };
}

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

function semanticErrors(delta: Delta, base: IR | null): DeltaError[] {
  const errors: DeltaError[] = [];
  const add = (code: ErrorCode, path: string, message: string): void => {
    errors.push({ code, path, message });
  };
  const ident = (path: string, value: string, re: RegExp, label: string) => {
    if (!re.test(value) || RESERVED.has(value))
      add(
        'delta.invalid-identifier',
        path,
        `${JSON.stringify(value)} is not a valid ${label}`,
      );
  };
  const member = (path: string, value: string, taken: ReadonlySet<string>) => {
    if (taken.has(value))
      add(
        'delta.invalid-identifier',
        path,
        `${JSON.stringify(value)} clashes with a built-in or inherited member`,
      );
  };

  // Only elements of this module can be referenced; the class namespace is checked against the whole base.
  const mine = <T extends { module: string }>(l: readonly T[] | undefined) =>
    (l ?? []).filter((x) => x.module === delta.module);
  const baseEntities = mine(base?.entities);
  const baseClasses = new Set<string>(
    [
      ...(base?.entities ?? []),
      ...(base?.valueObjects ?? []),
      ...(base?.events ?? []),
      ...(base?.ports ?? []),
      ...(base?.adapters ?? []),
    ].map((x) => x.name),
  );
  const baseIds = new Set<string>([
    ...(base?.useCases.map((u) => u.id) ?? []),
    ...(base?.entities.flatMap((e) => [
      ...e.invariants.map((i) => i.id),
      ...e.methods.map((m) => m.id),
    ]) ?? []),
  ]);
  const claim = (scope: Set<string>, key: string, path: string, id = key) => {
    if (scope.has(key))
      add('delta.name-collision', path, `${id} is declared twice in the Delta`);
    else if (baseIds.has(id))
      add(
        'delta.name-collision',
        path,
        `${id} already exists in the base; additions to existing items are not supported yet`,
      );
    scope.add(key);
  };
  // One class-name namespace for the module: entities, value objects, ports, events, use-case classes.
  const classes = new Set<string>();
  const claimClass = (cls: string, path: string, id: string) => {
    if (classes.has(cls))
      add(
        'delta.name-collision',
        path,
        `class ${cls} (${id}) is already declared in this Delta`,
      );
    else if (baseClasses.has(cls))
      add(
        'delta.name-collision',
        path,
        `class ${cls} (${id}) already exists in the base; additions to existing items are not supported yet`,
      );
    classes.add(cls);
  };

  ident('module', delta.module, KEBAB, 'kebab-case module name');

  const entityNames = new Set(delta.entities.map((e) => e.name));
  const eventNames = new Set(delta.events.map((e) => e.name));
  const baseEvents = new Set(mine(base?.events).map((e) => e.name));
  const typeNames = new Set([
    ...entityNames,
    ...delta.valueObjects.map((v) => v.name),
    ...baseEntities.map((e) => e.name),
    ...mine(base?.valueObjects).map((v) => v.name),
  ]);
  const methodIds = new Set<string>([
    ...delta.entities.flatMap((e) =>
      e.methods.map((m) => `${e.name}.${m.name}`),
    ),
    ...baseEntities.flatMap((e) =>
      e.methods.map((m) => m.id.replace(/^method:/, '')),
    ),
  ]);
  const portNames = new Set([
    ...delta.ports.map((p) => p.name),
    ...mine(base?.ports).map((p) => p.name),
  ]);
  const contained = new Set(base?.entities.flatMap((e) => e.contains ?? []));

  const checkType = (path: string, source: string): void => {
    const t = parseType(source);
    let leaf = t;
    while (leaf?.kind === 'array') leaf = leaf.of;
    if (t === null)
      add(
        'delta.type-invalid',
        path,
        `${JSON.stringify(source)} is not an allowed type`,
      );
    else if (leaf?.kind === 'ref' && !typeNames.has(leaf.name))
      add('delta.reference-unknown', path, `type ${leaf.name} is not declared`);
  };
  const checkFields = (
    path: string,
    fields: readonly { name: string; type: string }[],
    re: RegExp,
    label: string,
    params = false,
  ): void => {
    const seen = new Set<string>();
    let optionalSeen = false;
    fields.forEach((f, i) => {
      const { id, optional } = splitOptional(f.name);
      ident(`${path}[${i}].name`, id, re, label);
      checkType(`${path}[${i}].type`, f.type);
      claim(seen, id, `${path}[${i}].name`);
      if (params) {
        if (!optional && optionalSeen)
          add(
            'delta.schema-invalid',
            `${path}[${i}].name`,
            'a required parameter cannot follow an optional one',
          );
        optionalSeen ||= optional;
      }
    });
  };
  const noDuplicates = (path: string, items: readonly string[] | undefined) => {
    const seen = new Set<string>();
    items?.forEach((v, i) => {
      if (seen.has(v))
        add('delta.name-collision', `${path}[${i}]`, `${v} is listed twice`);
      seen.add(v);
    });
  };
  const checkEmits = (path: string, items: readonly string[] | undefined) =>
    items?.forEach((ev, i) => {
      if (!eventNames.has(ev) && !baseEvents.has(ev))
        add(
          'delta.reference-unknown',
          `${path}[${i}]`,
          `event ${ev} is not declared in module ${delta.module}`,
        );
    });

  delta.entities.forEach((entity, ei) => {
    const ep = `entities[${ei}]`;
    ident(`${ep}.name`, entity.name, PASCAL, 'PascalCase entity name');
    claimClass(entity.name, `${ep}.name`, `entity:${entity.name}`);
    const states = new Set(entity.states ?? []);
    noDuplicates(`${ep}.states`, entity.states);
    const invariants = new Set<string>();
    const checkInvariants = (
      path: string,
      items: readonly { id: string }[] | undefined,
    ) =>
      items?.forEach((inv, ii) => {
        ident(`${path}[${ii}].id`, inv.id, KEBAB, 'kebab-case invariant id');
        claim(
          invariants,
          inv.id,
          `${path}[${ii}].id`,
          `invariant:${entity.name}/${inv.id}`,
        );
      });
    checkInvariants(`${ep}.invariants`, entity.invariants);
    const methods = new Set<string>();
    entity.methods.forEach((m, mi) => {
      const mp = `${ep}.methods[${mi}]`;
      ident(`${mp}.name`, m.name, CAMEL, 'camelCase method name');
      member(
        `${mp}.name`,
        m.name,
        m.static ? STATIC_MEMBERS : INSTANCE_MEMBERS,
      );
      claim(methods, m.name, `${mp}.name`, `method:${entity.name}.${m.name}`);
      checkFields(
        `${mp}.params`,
        m.params,
        CAMEL,
        'camelCase parameter name',
        true,
      );
      if (m.returns !== 'void') checkType(`${mp}.returns`, m.returns);
      checkEmits(`${mp}.emits`, m.emits);
      noDuplicates(`${mp}.emits`, m.emits);
      if (m.transition) {
        noDuplicates(`${mp}.transition.from`, m.transition.from);
        for (const [i, s] of m.transition.from.entries())
          if (!states.has(s))
            add(
              'delta.reference-unknown',
              `${mp}.transition.from[${i}]`,
              `state ${s} is not declared`,
            );
        if (!states.has(m.transition.to))
          add(
            'delta.reference-unknown',
            `${mp}.transition.to`,
            `state ${m.transition.to} is not declared`,
          );
      }
      checkInvariants(`${mp}.invariants`, m.invariants);
    });
  });

  delta.valueObjects.forEach((vo, vi) => {
    const vp = `valueObjects[${vi}]`;
    ident(`${vp}.name`, vo.name, PASCAL, 'PascalCase value object name');
    claimClass(vo.name, `${vp}.name`, `valueobject:${vo.name}`);
    checkFields(`${vp}.fields`, vo.fields, FIELD, 'field name');
  });

  delta.ports.forEach((port, i) => {
    const p = `ports[${i}]`;
    ident(`${p}.name`, port.name, PASCAL, 'PascalCase port name');
    claimClass(port.name, `${p}.name`, `port:${port.name}`);
    if (!entityNames.has(port.root)) {
      if (!baseEntities.some((e) => e.name === port.root))
        add(
          'delta.reference-unknown',
          `${p}.root`,
          `entity ${port.root} is not declared in module ${delta.module}`,
        );
      else if (contained.has(`entity:${port.root}`))
        add(
          'delta.reference-unknown',
          `${p}.root`,
          `entity ${port.root} is not an aggregate root (another entity contains it)`,
        );
    }
    const methods = new Set<string>();
    port.methods.forEach((m, mi) => {
      const mp = `${p}.methods[${mi}]`;
      ident(`${mp}.name`, m.name, CAMEL, 'camelCase method name');
      member(`${mp}.name`, m.name, INSTANCE_MEMBERS);
      claim(methods, m.name, `${mp}.name`);
      checkFields(
        `${mp}.params`,
        m.params,
        CAMEL,
        'camelCase parameter name',
        true,
      );
      if (m.returns !== 'void') checkType(`${mp}.returns`, m.returns);
    });
  });

  delta.events.forEach((ev, i) => {
    const p = `events[${i}]`;
    ident(`${p}.name`, ev.name, PASCAL, 'PascalCase event name');
    claimClass(ev.name, `${p}.name`, `event:${ev.name}`);
    if (!entityNames.has(ev.entity))
      add(
        'delta.reference-unknown',
        `${p}.entity`,
        `entity ${ev.entity} is not declared in this Delta`,
      );
    checkFields(`${p}.payload`, ev.payload, FIELD, 'field name');
  });

  const useCases = new Set<string>();
  delta.useCases.forEach((uc, i) => {
    const p = `useCases[${i}]`;
    ident(`${p}.name`, uc.name, USE_CASE, 'snake_case use-case name');
    claim(useCases, uc.name, `${p}.name`, `usecase:${uc.name}`);
    if (USE_CASE.test(uc.name) && SNAKE.test(uc.name)) {
      const cls = pascalOfSnake(uc.name);
      // The class is declared next to what the file imports, so it must not shadow any of it.
      if (RESERVED.has(cls))
        add(
          'delta.invalid-identifier',
          `${p}.name`,
          `class ${cls} would shadow a name the generated file uses`,
        );
      else claimClass(cls, `${p}.name`, `usecase:${uc.name}`);
    }
    noDuplicates(`${p}.uses`, uc.uses);
    noDuplicates(`${p}.emits`, uc.emits);
    noDuplicates(`${p}.ports`, uc.ports);
    checkFields(`${p}.input`, uc.input, FIELD, 'field name');
    checkFields(`${p}.output`, uc.output, FIELD, 'field name');
    uc.uses.forEach((u, ui) => {
      const m = USES.exec(u);
      if (!m)
        add(
          'delta.invalid-identifier',
          `${p}.uses[${ui}]`,
          `${JSON.stringify(u)} must look like method:Entity.method`,
        );
      else if (!methodIds.has(`${m[1]}.${m[2]}`))
        add(
          'delta.reference-unknown',
          `${p}.uses[${ui}]`,
          `${u} is not declared in module ${delta.module}`,
        );
    });
    checkEmits(`${p}.emits`, uc.emits);
    uc.ports?.forEach((port, pi) => {
      if (!portNames.has(port))
        add(
          'delta.reference-unknown',
          `${p}.ports[${pi}]`,
          `port ${port} is not declared in module ${delta.module}`,
        );
    });
  });

  return errors.sort(compareErrors);
}
