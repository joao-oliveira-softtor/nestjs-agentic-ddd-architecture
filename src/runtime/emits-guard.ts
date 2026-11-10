import type { DomainEvent, UseCaseContext } from '@agentic-ddd/core';
import type { UseCaseRecord } from '@agentic-ddd/decorators';

export interface EmitsGuard {
  readonly publish: UseCaseContext['publish'];
  /** Set before the first await so even a swallowed or un-awaited failure fails the execution. */
  readonly undeclared: boolean;
  /** The first delivery failure, kept so an un-awaited publish cannot lose it. */
  readonly failed: { error: unknown } | undefined;
  /** Resolves once every delivery started so far settled, so `failed` is final (a use-case may not await its publish). */
  drain(): Promise<void>;
  end(): void;
}

/** One use-case execution may only publish the events in its `emits`, and only while it runs. */
export function guardEmits(
  record: UseCaseRecord,
  deliver: (batch: readonly DomainEvent[]) => Promise<void>,
  check: () => void = () => {},
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
      await Promise.all(settling);
    },
  };
}
