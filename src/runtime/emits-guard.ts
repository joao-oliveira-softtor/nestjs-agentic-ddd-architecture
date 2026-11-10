import type { DomainEvent, UseCaseContext } from '@agentic-ddd/core';
import type { Registry, UseCaseRecord } from '@agentic-ddd/decorators';
import type { ZodType } from 'zod';

export interface EmitsGuard {
  readonly publish: UseCaseContext['publish'];
  /** Set before the first await so even a swallowed or un-awaited failure fails the execution. */
  readonly undeclared: boolean;
  /** The first delivery failure, kept so an un-awaited publish cannot lose it. */
  readonly failed: { error: unknown } | undefined;
  /** Resolves once no delivery is pending, including ones started meanwhile, so `failed` is final (a use-case may not await its publish). */
  drain(): Promise<void>;
  end(): void;
}

/** Event payload schemas by event name, the same key as the emits check. */
export function schemaLookup(
  registry: Registry,
): (name: string) => ZodType | undefined {
  const byName = new Map(
    registry.events.map((e) => [e.target.name, e.payload]),
  );
  return (name) => byName.get(name);
}

/** One use-case execution may only publish the events in its `emits`, and only while it runs. */
export function guardEmits(
  record: UseCaseRecord,
  deliver: (batch: readonly DomainEvent[]) => Promise<void>,
  check: () => void = () => {},
  schemaFor?: (name: string) => ZodType | undefined,
): EmitsGuard {
  let active = true;
  let undeclared = false;
  let failed: { error: unknown } | undefined;
  const settling: Promise<void>[] = [];
  const assertActive = () => {
    if (!active) throw new Error('Use-case execution already ended');
  };
  return {
    get undeclared() {
      return undeclared;
    },
    get failed() {
      return failed;
    },
    end() {
      active = false;
    },
    publish(batch) {
      // Every refusal happens here, before anything is delivered, and comes back as a rejection.
      try {
        check();
        assertActive();
        // By name, like the IR and skills: identity breaks when a module is loaded twice.
        const refused = batch.find(
          (event) => !record.emits.some((cls) => cls.name === event.name),
        );
        if (refused) {
          undeclared = true;
          throw new Error(
            `Event ${refused.name} is not declared in emits of use-case ${record.name}`,
          );
        }
        // Only validates: the payload stays as the use-case built it.
        const invalid = batch.find(
          (event) =>
            !(
              schemaFor?.(event.name)?.safeParse(event.payload).success ?? true
            ),
        );
        if (invalid) {
          undeclared = true;
          throw new Error(
            `Event ${invalid.name} has a payload that does not match its @AgentEvent schema (use-case ${record.name})`,
          );
        }
        if (undeclared)
          throw new Error(
            `Use-case ${record.name} already published an undeclared event`,
          );
      } catch (error) {
        return Promise.reject(error);
      }
      const delivery = deliver(batch);
      // An awaiting caller still sees the rejection; a caller that forgot to await does not
      // leave an unhandled one, and the guard keeps the failure for the execution to rethrow.
      settling.push(
        delivery.catch((error: unknown) => {
          failed ??= { error };
        }),
      );
      return delivery;
    },
    async drain() {
      // A delivery can start while an earlier one settles, so walk the list as it grows.
      for (let i = 0; i < settling.length; i++) await settling[i];
    },
  };
}
