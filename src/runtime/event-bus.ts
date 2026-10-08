import { AsyncLocalStorage } from 'node:async_hooks';
import type { DomainEvent } from '@agentic-ddd/core';
import type { EventBus, EventHandler } from './ports';

/** Serializes batches and awaits subscribers in subscription order. */
export class InMemoryEventBus implements EventBus {
  readonly events: DomainEvent[] = [];
  #handlers = new Set<EventHandler>();
  #tail: Promise<void> = Promise.resolve();
  #deliveryContext = new AsyncLocalStorage<{ active: boolean }>();

  subscribe(handler: EventHandler): () => void {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  publish(events: readonly DomainEvent[]): Promise<void> {
    // A subscriber cannot await a batch queued behind its own delivery.
    if (this.#deliveryContext.getStore()?.active)
      return Promise.reject(
        new Error(
          'Reentrant publication on the same EventBus is not supported',
        ),
      );
    const batch = [...events];
    const delivery = this.#tail.then(async () => {
      for (const event of batch) {
        this.events.push(event);
        for (const handler of this.#handlers) {
          const context = { active: true };
          try {
            await this.#deliveryContext.run(context, () => handler(event));
          } finally {
            context.active = false;
          }
        }
      }
    });
    this.#tail = delivery.catch(() => {});
    return delivery;
  }
}
