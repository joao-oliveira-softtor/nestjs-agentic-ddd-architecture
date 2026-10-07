import { sha256, stableStringify } from './canonical';
import type { IR, JsonSchema } from './ir';

export type ElementKind =
  'entity' | 'invariant' | 'method' | 'event' | 'usecase' | 'operator';
export type ChangeKind = 'added' | 'modified' | 'removed';
export type Classification = 'breaking' | 'behavioral' | 'docs';

export interface DomainElement {
  readonly id: string;
  readonly kind: ElementKind;
  readonly module: string;
  readonly content: Readonly<Record<string, unknown>>;
}

export interface DiffItem {
  readonly id: string;
  readonly kind: ChangeKind;
  readonly classification: Classification;
  readonly module: string;
}

export const EMPTY_IR: IR = {
  irVersion: 1,
  modules: [],
  entities: [],
  events: [],
  useCases: [],
  operators: [],
};

const DOC_FIELDS = new Set(['description', 'whenToUse', 'whenNotToUse']);

export function elementsOf(ir: IR): Map<string, DomainElement> {
  const elements = new Map<string, DomainElement>();
  const add = (element: DomainElement): void => {
    elements.set(element.id, element);
  };
  for (const e of ir.entities) {
    add({
      id: e.id,
      kind: 'entity',
      module: e.module,
      content: {
        name: e.name,
        module: e.module,
        description: e.description,
        states: e.states,
      },
    });
    for (const i of e.invariants)
      add({
        id: i.id,
        kind: 'invariant',
        module: e.module,
        content: { text: i.text, on: i.on },
      });
    for (const m of e.methods) {
      add({
        id: m.id,
        kind: 'method',
        module: e.module,
        content: {
          name: m.name,
          static: m.static,
          description: m.description,
          transition: m.transition,
          emits: m.emits,
        },
      });
    }
  }
  for (const ev of ir.events) {
    add({
      id: ev.id,
      kind: 'event',
      module: ev.module,
      content: {
        name: ev.name,
        module: ev.module,
        description: ev.description,
        payloadSchema: ev.payloadSchema,
      },
    });
  }
  for (const u of ir.useCases) {
    add({
      id: u.id,
      kind: 'usecase',
      module: u.module,
      content: {
        name: u.name,
        module: u.module,
        description: u.description,
        whenToUse: u.whenToUse,
        whenNotToUse: u.whenNotToUse,
        inputSchema: u.inputSchema,
        outputSchema: u.outputSchema,
        uses: u.uses,
        emits: u.emits,
      },
    });
  }
  for (const o of ir.operators) {
    add({
      id: o.id,
      kind: 'operator',
      module: o.module,
      content: {
        name: o.name,
        module: o.module,
        description: o.description,
        instructions: o.instructions,
        useCases: o.useCases,
        requiresApproval: o.requiresApproval,
        limits: o.limits,
        model: o.model,
      },
    });
  }
  return elements;
}

export function contentHash(element: DomainElement): string {
  return sha256(stableStringify(element.content));
}

const properties = (schema: unknown): Record<string, JsonSchema> =>
  ((schema as JsonSchema | undefined)?.properties ?? {}) as Record<
    string,
    JsonSchema
  >;
const requiredOf = (schema: unknown): Set<string> =>
  new Set(((schema as JsonSchema | undefined)?.required ?? []) as string[]);
const typeOf = (property: JsonSchema | undefined): string =>
  stableStringify({
    type: property?.type,
    anyOf: property?.anyOf,
    const: property?.const,
    format: property?.format,
  });

function enumBreaksInput(before: unknown, after: unknown): boolean {
  const beforeEnum = (before as JsonSchema | undefined)?.enum as
    string[] | undefined;
  const afterEnum = (after as JsonSchema | undefined)?.enum as
    string[] | undefined;
  if (!beforeEnum && afterEnum) return true;
  if (beforeEnum && afterEnum) {
    return beforeEnum.some((val) => !afterEnum.includes(val));
  }
  return false;
}

function enumBreaksOutput(before: unknown, after: unknown): boolean {
  const beforeEnum = (before as JsonSchema | undefined)?.enum as
    string[] | undefined;
  const afterEnum = (after as JsonSchema | undefined)?.enum as
    string[] | undefined;
  if (beforeEnum && !afterEnum) return true;
  if (beforeEnum && afterEnum) {
    return afterEnum.some((val) => !beforeEnum.includes(val));
  }
  return false;
}

type Mode = 'input' | 'output';

function schemaBreaks(before: unknown, after: unknown, mode: Mode): boolean {
  if (
    typeOf(before as JsonSchema | undefined) !==
    typeOf(after as JsonSchema | undefined)
  )
    return true;
  if (
    mode === 'input'
      ? enumBreaksInput(before, after)
      : enumBreaksOutput(before, after)
  )
    return true;
  const old = properties(before);
  const next = properties(after);
  for (const key of Object.keys(old)) {
    if (!Object.hasOwn(next, key)) return true;
    if (schemaBreaks(old[key], next[key], mode)) return true;
  }
  if (mode === 'input') {
    const oldRequired = requiredOf(before);
    if ([...requiredOf(after)].some((key) => !oldRequired.has(key)))
      return true;
  }
  const oldItems = (before as JsonSchema | undefined)?.items;
  const nextItems = (after as JsonSchema | undefined)?.items;
  if (
    oldItems !== undefined &&
    nextItems !== undefined &&
    schemaBreaks(oldItems, nextItems, mode)
  )
    return true;
  return false;
}

const inputBreaks = (before: unknown, after: unknown): boolean =>
  schemaBreaks(before, after, 'input');
const outputBreaks = (before: unknown, after: unknown): boolean =>
  schemaBreaks(before, after, 'output');

interface Transition {
  readonly from: readonly string[];
  readonly to: string;
}

// Quebra se uma transição antes permitida deixa de valer: some, perde um
// estado de origem ou muda o destino. Acrescentar estados de origem só amplia.
function transitionBreaks(
  before: DomainElement,
  after: DomainElement,
): boolean {
  const old = before.content.transition as Transition | null;
  if (old === null || old === undefined) return false;
  const next = after.content.transition as Transition | null;
  if (next === null || next === undefined) return true;
  return (
    old.to !== next.to || old.from.some((state) => !next.from.includes(state))
  );
}

function classifyModified(
  before: DomainElement,
  after: DomainElement,
): Classification {
  const keys = new Set([
    ...Object.keys(before.content),
    ...Object.keys(after.content),
  ]);
  const changed = [...keys].filter(
    (key) =>
      stableStringify(before.content[key] ?? null) !==
      stableStringify(after.content[key] ?? null),
  );
  if (changed.length > 0 && changed.every((key) => DOC_FIELDS.has(key)))
    return 'docs';
  if (
    after.kind === 'usecase' &&
    (inputBreaks(before.content.inputSchema, after.content.inputSchema) ||
      outputBreaks(before.content.outputSchema, after.content.outputSchema))
  ) {
    return 'breaking';
  }
  if (after.kind === 'method' && transitionBreaks(before, after))
    return 'breaking';
  return 'behavioral';
}

function classifyRemoved(before: DomainElement): Classification {
  if (before.kind === 'usecase') return 'breaking';
  if (before.kind === 'method' && before.content.transition !== null)
    return 'breaking';
  return 'behavioral';
}

export function semanticDiff(before: IR, after: IR): DiffItem[] {
  const old = elementsOf(before);
  const next = elementsOf(after);
  const items: DiffItem[] = [];
  for (const [id, element] of next) {
    const previous = old.get(id);
    if (!previous)
      items.push({
        id,
        kind: 'added',
        classification: 'behavioral',
        module: element.module,
      });
    else if (contentHash(previous) !== contentHash(element)) {
      items.push({
        id,
        kind: 'modified',
        classification: classifyModified(previous, element),
        module: element.module,
      });
    }
  }
  for (const [id, element] of old) {
    if (!next.has(id))
      items.push({
        id,
        kind: 'removed',
        classification: classifyRemoved(element),
        module: element.module,
      });
  }
  return items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
