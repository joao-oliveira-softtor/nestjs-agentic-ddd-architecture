import type { DomainEvent, UseCaseContext } from '@agentic-ddd/core';
import type { UseCaseRecord } from '@agentic-ddd/decorators';

export interface EmitsGuard {
  readonly publish: UseCaseContext['publish'];
  /** Set before the first await so even a swallowed or un-awaited failure fails the execution. */
  readonly undeclared: boolean;
  end(): void;
}

/** One use-case execution may only publish the events in its `emits`, and only while it runs. */
export function guardEmits(
  record: UseCaseRecord,
  deliver: (event: DomainEvent) => Promise<void>,
  check: () => void = () => {},
): EmitsGuard {
  let active = true;
  let undeclared = false;
  return {
    get undeclared() {
      return undeclared;
    },
    end() {
      active = false;
    },
    async publish(batch) {
      check();
      if (!active) throw new Error('Use-case execution already ended');
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
      for (const event of batch) {
        check();
        // Earlier, or concurrently while this batch awaited the bus.
        if (undeclared)
          throw new Error(
            `Use-case ${record.name} already published an undeclared event`,
          );
        await deliver(event);
      }
    },
  };
}
