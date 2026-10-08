import type { DomainEvent } from '@agentic-ddd/core';
import type { EventBus, EventHandler } from './ports';

/** Serializes batches and awaits subscribers in subscription order. */
export class InMemoryEventBus implements EventBus {
  readonly events: DomainEvent[] = [];
  #handlers = new Set<EventHandler>();
  #tail: Promise<void> = Promise.resolve();

  subscribe(handler: EventHandler): () => void {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  publish(events: readonly DomainEvent[]): Promise<void> {
    const batch = [...events];
    const delivery = this.#tail.then(async () => {
      for (const event of batch) {
        this.events.push(event);
        for (const handler of this.#handlers) await handler(event);
      }
    });
    this.#tail = delivery.catch(() => {});
    return delivery;
  }
}
