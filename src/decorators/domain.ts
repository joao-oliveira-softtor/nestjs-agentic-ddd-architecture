import type { ZodType } from 'zod';
import { activeRegistry, type ClassRef, type TransitionSpec } from './registry';
import { captureSource } from './source';

export interface AgentEntityOptions {
  readonly description: string;
  readonly states?: readonly string[];
  readonly contains?: () => readonly ClassRef[];
  readonly references?: () => readonly ClassRef[];
}

export function AgentEntity(options: AgentEntityOptions): ClassDecorator {
  const source = captureSource();
  return (target) => {
    activeRegistry().entities.push({
      target,
      description: options.description,
      states: options.states ?? [],
      source,
      ...(options.contains && { contains: options.contains }),
      ...(options.references && { references: options.references }),
    });
  };
}

export interface AgentValueObjectOptions {
  readonly description: string;
}

export function AgentValueObject(
  options: AgentValueObjectOptions,
): ClassDecorator {
  const source = captureSource();
  return (target) => {
    activeRegistry().valueObjects.push({
      target,
      description: options.description,
      source,
    });
  };
}

export interface InvariantOptions {
  readonly id: string;
  readonly text: string;
}

export function Invariant(
  options: InvariantOptions,
): ClassDecorator & MethodDecorator {
  const source = captureSource();
  const decorator = (target: object, key?: string | symbol): void => {
    const onClass = key === undefined;
    const entity = (
      onClass || typeof target === 'function' ? target : target.constructor
    ) as ClassRef;
    activeRegistry().invariants.push({
      entity,
      method: onClass ? null : String(key),
      id: options.id,
      text: options.text,
      source,
    });
  };
  return decorator as ClassDecorator & MethodDecorator;
}

export interface AgentMethodOptions {
  readonly description: string;
  readonly emits?: readonly ClassRef[];
  readonly transition?: TransitionSpec;
}

export function AgentMethod(options: AgentMethodOptions): MethodDecorator {
  const source = captureSource();
  return (target, key, descriptor) => {
    const isStatic = typeof target === 'function';
    activeRegistry().methods.push({
      entity: (isStatic ? target : target.constructor) as ClassRef,
      name: String(key),
      isStatic,
      description: options.description,
      emits: options.emits ?? [],
      transition: options.transition ?? null,
      fn: descriptor.value as unknown as Function,
      source,
    });
  };
}

export interface AgentEventOptions {
  readonly description: string;
  readonly payload: ZodType;
}

export function AgentEvent(options: AgentEventOptions): ClassDecorator {
  const source = captureSource();
  return (target) => {
    activeRegistry().events.push({
      target,
      description: options.description,
      payload: options.payload,
      source,
    });
  };
}

export interface AgentPortOptions {
  readonly description: string;
  readonly root: () => ClassRef;
  readonly methods: Readonly<Record<string, string>>;
}

export function AgentPort(options: AgentPortOptions): ClassDecorator {
  const source = captureSource();
  return (target) => {
    activeRegistry().ports.push({
      target,
      description: options.description,
      root: options.root,
      methods: options.methods,
      source,
    });
  };
}
