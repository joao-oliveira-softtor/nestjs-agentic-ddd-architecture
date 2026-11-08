import { AggregateRoot } from '@agentic-ddd/core';

/**
 * Every name the renderer imports, by module. The renderer refuses to import anything not listed
 * here, and the schema rejects these names as identifiers, so the two cannot drift.
 */
export const RENDERER_IMPORTS = {
  '@agentic-ddd/core': [
    'AggregateRoot',
    'DomainEvent',
    'UseCase',
    'UseCaseContext',
    'ValueObject',
    'notImplemented',
  ],
  '@agentic-ddd/decorators': [
    'AgentEntity',
    'AgentEvent',
    'AgentMethod',
    'AgentPort',
    'AgentUseCase',
    'AgentValueObject',
    'Invariant',
  ],
  zod: ['z'],
} as const;

export const RENDERER_IMPORT_NAMES: ReadonlySet<string> = new Set(
  Object.values(RENDERER_IMPORTS).flat(),
);

const ownNames = (o: object): string[] => Object.getOwnPropertyNames(o);

function chain(start: object | null): string[] {
  const names: string[] = [];
  for (let o = start; o !== null; o = Object.getPrototypeOf(o) as object | null)
    names.push(...ownNames(o));
  return names;
}

// Derived from the classes an entity extends, so it follows them when they change.
class Probe extends AggregateRoot<string> {
  constructor() {
    super('probe');
  }
}

/** Members a generated entity class would clash with: prototype chain plus instance fields. */
export const INSTANCE_MEMBERS: ReadonlySet<string> = new Set([
  ...chain(AggregateRoot.prototype),
  ...ownNames(new Probe()),
]);

/** What a generated port (a plain abstract class) would clash with. */
export const PORT_MEMBERS: ReadonlySet<string> = new Set(
  ownNames(Object.prototype),
);

/** Statics a generated class would clash with: the constructor chain (name, length, apply, ...). */
export const STATIC_MEMBERS: ReadonlySet<string> = new Set([
  ...chain(AggregateRoot),
  ...ownNames(Object.prototype),
]);
