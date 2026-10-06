import type { ZodType } from 'zod';
import type { SourceLoc } from './source.js';

export type ClassRef = Function;

export interface EntityRecord {
  readonly target: ClassRef;
  readonly description: string;
  readonly states: readonly string[];
  readonly source: SourceLoc;
}

export interface InvariantRecord {
  readonly entity: ClassRef;
  readonly method: string | null;
  readonly id: string;
  readonly text: string;
  readonly source: SourceLoc;
}

export interface TransitionSpec {
  readonly from: readonly string[];
  readonly to: string;
}

export interface MethodRecord {
  readonly entity: ClassRef;
  readonly name: string;
  readonly isStatic: boolean;
  readonly description: string;
  readonly emits: readonly ClassRef[];
  readonly transition: TransitionSpec | null;
  readonly fn: Function;
  readonly source: SourceLoc;
}

export interface EventRecord {
  readonly target: ClassRef;
  readonly description: string;
  readonly payload: ZodType;
  readonly source: SourceLoc;
}

export interface UseCaseRecord {
  readonly target: ClassRef;
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string;
  readonly whenNotToUse: string | null;
  readonly input: ZodType;
  readonly output: ZodType;
  readonly uses: readonly string[];
  readonly emits: readonly ClassRef[];
  readonly source: SourceLoc;
}

export interface OperatorLimits {
  readonly maxSteps: number;
  readonly timeoutMs: number;
}

export interface OperatorRecord {
  readonly target: ClassRef;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly useCases: readonly ClassRef[];
  readonly requiresApproval: readonly ClassRef[];
  readonly limits: OperatorLimits;
  readonly model: string;
  readonly source: SourceLoc;
}

export class Registry {
  readonly entities: EntityRecord[] = [];
  readonly invariants: InvariantRecord[] = [];
  readonly methods: MethodRecord[] = [];
  readonly events: EventRecord[] = [];
  readonly useCases: UseCaseRecord[] = [];
  readonly operators: OperatorRecord[] = [];

  reset(): void {
    this.entities.length = 0;
    this.invariants.length = 0;
    this.methods.length = 0;
    this.events.length = 0;
    this.useCases.length = 0;
    this.operators.length = 0;
  }
}

export const defaultRegistry = new Registry();
let active: Registry = defaultRegistry;

export function activeRegistry(): Registry {
  return active;
}

export function createRegistry(): Registry {
  return new Registry();
}

export function withRegistry<T>(registry: Registry, fn: () => T): T {
  const previous = active;
  active = registry;
  try {
    return fn();
  } finally {
    active = previous;
  }
}
