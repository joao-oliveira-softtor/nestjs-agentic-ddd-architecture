import type { DomainEvent, UseCaseContext } from '@agentic-ddd/core';
import type { Registry, UseCaseRecord } from '@agentic-ddd/decorators';
import type { ZodType } from 'zod';

export interface EmitsGuard {
  readonly publish: UseCaseContext['publish'];
  /** Set before the first await so even a swallowed or un-awaited failure fails the execution. */
  readonly undeclared: boolean;
  /** The first refusal that set `undeclared`: it names the event and the use-case. */
  readonly refusal: Error | undefined;
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

/** Why a batch is refused: an event outside `emits` first, then one published before, then a payload outside its schema. */
function refusalFor(
  record: UseCaseRecord,
  batch: readonly DomainEvent[],
  schemaFor?: (name: string) => ZodType | undefined,
): string | undefined {
  // By name, like the IR and skills: identity breaks when a module is loaded twice.
  const refused = batch.find(
    (event) => !record.emits.some((cls) => cls.name === event.name),
  );
  if (refused)
    return `Event ${refused.name} is not declared in emits of use-case ${record.name}`;
  // Stamping happens inside the delivery: refuse here, or a repeat would end as a bus failure.
  const repeated = batch.find(
    (event, i) => event.correlationId !== null || batch.indexOf(event) !== i,
  );
  if (repeated)
    return `Event ${repeated.name} was already published (use-case ${record.name})`;
  // Only validates: the payload stays as the use-case built it.
  const invalid = batch.find((event) => {
    try {
      return !(
        schemaFor?.(event.name)?.safeParse(event.payload).success ?? true
      );
    } catch {
      // A schema that cannot run synchronously (an async refinement) cannot vouch for the payload.
      return true;
    }
  });
  return invalid
    ? `Event ${invalid.name} has a payload that does not match its @AgentEvent schema (use-case ${record.name})`
    : undefined;
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
  let refusal: Error | undefined;
  let failed: { error: unknown } | undefined;
  const settling: Promise<void>[] = [];
  const refuse = (message: string) => {
    undeclared = true;
    const error = new Error(message);
    refusal ??= error;
    return error;
  };
  const assertActive = () => {
    if (!active) throw new Error('Use-case execution already ended');
  };
  return {
    get undeclared() {
      return undeclared;
    },
    get refusal() {
      return refusal;
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
        const message = refusalFor(record, batch, schemaFor);
        if (message) throw refuse(message);
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
