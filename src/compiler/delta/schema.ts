import { z } from 'zod';
import type { Coded, ErrorCode, IR } from '../ir';

export interface DeltaError extends Coded {
  readonly path: string;
}

const text = z.string().min(1).max(10_000);
const name = z.string().min(1).max(200);

const field = z.strictObject({ name, type: name });
const invariant = z.strictObject({ id: name, text });
const method = z.strictObject({
  name,
  description: text,
  static: z.boolean().optional(),
  params: z.array(field),
  returns: name,
  emits: z.array(name).optional(),
  transition: z.strictObject({ from: z.array(name), to: name }).optional(),
  invariants: z.array(invariant).optional(),
});

export const deltaSchema = z.strictObject({
  module: name,
  entities: z.array(
    z.strictObject({
      name,
      description: text,
      states: z.array(name).optional(),
      invariants: z.array(invariant),
      methods: z.array(method),
    }),
  ),
  valueObjects: z.array(
    z.strictObject({ name, description: text, fields: z.array(field) }),
  ),
  ports: z.array(
    z.strictObject({
      name,
      description: text,
      root: name,
      methods: z.array(
        z.strictObject({
          name,
          description: text,
          params: z.array(field),
          returns: name,
        }),
      ),
    }),
  ),
  events: z.array(
    z.strictObject({
      name,
      entity: name,
      description: text,
      payload: z.array(field),
    }),
  ),
  useCases: z.array(
    z.strictObject({
      name,
      description: text,
      whenToUse: text,
      whenNotToUse: text.optional(),
      input: z.array(field),
      output: z.array(field),
      uses: z.array(name),
      emits: z.array(name),
      ports: z.array(name).optional(),
    }),
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

// JS/TS reserved and strict-mode words, plus names that would shadow what the renderer imports.
const RESERVED = new Set(
  (
    'break case catch class const continue debugger default delete do else enum export extends false ' +
    'finally for function if import in instanceof new null return super switch this throw true try ' +
    'typeof var void while with yield let static implements interface package private protected public ' +
    'await async abstract any as asserts bigint boolean constructor declare from get global infer is ' +
    'keyof module namespace never number object of out override readonly require set string symbol ' +
    'type undefined unique unknown arguments eval ' +
    'Array Boolean Date Error Function Map Number Object Promise Set String Symbol DomainEvent ' +
    'AggregateRoot ValueObject UseCase UseCaseContext AgentEntity AgentEvent AgentMethod AgentUseCase ' +
    'AgentValueObject Invariant z'
  ).split(' '),
);

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

export interface ValidateOptions {
  readonly base?: IR | null;
}

/** Zod shape check, then the semantic checks. Returns every problem, ordered by path. */
export function validateDelta(
  input: unknown,
  options: ValidateOptions = {},
): { ok: true; delta: Delta } | { ok: false; errors: DeltaError[] } {
  const parsed = deltaSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        code: 'delta.schema-invalid',
        path: pathOf(i.path),
        message: i.message,
      })),
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
  // Duplicates inside one scope, and against the global IR ids of the base.
  const baseIds = new Set<string>([
    ...(base?.entities.map((e) => e.id) ?? []),
    ...(base?.valueObjects?.map((v) => v.id) ?? []),
    ...(base?.events.map((e) => e.id) ?? []),
    ...(base?.ports?.map((p) => p.id) ?? []),
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

  ident('module', delta.module, KEBAB, 'kebab-case module name');

  // Type names are one namespace across entities, value objects and events.
  const types = new Set<string>();
  const entityNames = new Set(delta.entities.map((e) => e.name));
  const eventNames = new Set(delta.events.map((e) => e.name));
  const baseEvents = new Set(base?.events.map((e) => e.name) ?? []);
  const typeNames = new Set([
    ...entityNames,
    ...delta.valueObjects.map((v) => v.name),
    ...(base?.entities.map((e) => e.name) ?? []),
    ...(base?.valueObjects?.map((v) => v.name) ?? []),
  ]);
  const methodIds = new Set<string>([
    ...delta.entities.flatMap((e) =>
      e.methods.map((m) => `${e.name}.${m.name}`),
    ),
    ...(base?.entities.flatMap((e) =>
      e.methods.map((m) => m.id.replace(/^method:/, '')),
    ) ?? []),
  ]);
  const portNames = new Set([
    ...delta.ports.map((p) => p.name),
    ...(base?.ports?.map((p) => p.name) ?? []),
  ]);

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
  ): void => {
    const seen = new Set<string>();
    fields.forEach((f, i) => {
      const { id } = splitOptional(f.name);
      ident(`${path}[${i}].name`, id, re, label);
      checkType(`${path}[${i}].type`, f.type);
      claim(seen, id, `${path}[${i}].name`);
    });
  };
  const noDuplicates = (path: string, list: readonly string[] | undefined) =>
    list?.forEach((v, i) => {
      if (list.indexOf(v) !== i)
        add('delta.name-collision', `${path}[${i}]`, `${v} is listed twice`);
    });
  const checkEmits = (path: string, list: readonly string[] | undefined) =>
    list?.forEach((ev, i) => {
      if (!eventNames.has(ev) && !baseEvents.has(ev))
        add(
          'delta.reference-unknown',
          `${path}[${i}]`,
          `event ${ev} is not declared`,
        );
    });

  delta.entities.forEach((entity, ei) => {
    const ep = `entities[${ei}]`;
    ident(`${ep}.name`, entity.name, PASCAL, 'PascalCase entity name');
    claim(types, entity.name, `${ep}.name`, `entity:${entity.name}`);
    const states = new Set(entity.states ?? []);
    noDuplicates(`${ep}.states`, entity.states);
    const invariants = new Set<string>();
    const checkInvariants = (
      path: string,
      list: readonly { id: string }[] | undefined,
    ) =>
      list?.forEach((inv, ii) => {
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
      claim(methods, m.name, `${mp}.name`, `method:${entity.name}.${m.name}`);
      checkFields(`${mp}.params`, m.params, CAMEL, 'camelCase parameter name');
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
    claim(types, vo.name, `${vp}.name`, `valueobject:${vo.name}`);
    checkFields(`${vp}.fields`, vo.fields, FIELD, 'field name');
  });

  const entityIds = new Set<string>(base?.entities.map((e) => e.name) ?? []);
  const ports = new Set<string>();
  delta.ports.forEach((port, i) => {
    const p = `ports[${i}]`;
    ident(`${p}.name`, port.name, PASCAL, 'PascalCase port name');
    claim(ports, port.name, `${p}.name`, `port:${port.name}`);
    if (types.has(port.name))
      add(
        'delta.name-collision',
        `${p}.name`,
        `${port.name} is already declared as a type`,
      );
    if (!entityNames.has(port.root) && !entityIds.has(port.root))
      add(
        'delta.reference-unknown',
        `${p}.root`,
        `entity ${port.root} is not declared`,
      );
    const methods = new Set<string>();
    port.methods.forEach((m, mi) => {
      const mp = `${p}.methods[${mi}]`;
      ident(`${mp}.name`, m.name, CAMEL, 'camelCase method name');
      claim(methods, m.name, `${mp}.name`);
      checkFields(`${mp}.params`, m.params, CAMEL, 'camelCase parameter name');
      if (m.returns !== 'void') checkType(`${mp}.returns`, m.returns);
    });
  });

  const events = new Set<string>();
  delta.events.forEach((ev, i) => {
    const p = `events[${i}]`;
    ident(`${p}.name`, ev.name, PASCAL, 'PascalCase event name');
    claim(events, ev.name, `${p}.name`, `event:${ev.name}`);
    if (types.has(ev.name))
      add(
        'delta.name-collision',
        `${p}.name`,
        `${ev.name} is already declared as a type`,
      );
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
      else if (
        typeNames.has(cls) ||
        eventNames.has(cls) ||
        baseEvents.has(cls) ||
        portNames.has(cls)
      )
        add(
          'delta.name-collision',
          `${p}.name`,
          `class ${cls} collides with a declared type, event or port`,
        );
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
          `${u} is not declared`,
        );
    });
    checkEmits(`${p}.emits`, uc.emits);
    uc.ports?.forEach((port, pi) => {
      if (!portNames.has(port))
        add(
          'delta.reference-unknown',
          `${p}.ports[${pi}]`,
          `port ${port} is not declared`,
        );
    });
  });

  return errors.sort((a, b) =>
    a.path === b.path ? (a.code < b.code ? -1 : 1) : a.path < b.path ? -1 : 1,
  );
}
