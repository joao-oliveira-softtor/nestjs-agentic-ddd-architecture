import { AsyncLocalStorage } from 'node:async_hooks';
import type { DomainEvent } from '@agentic-ddd/core';
import type { EventBus, EventHandler } from './ports';

export interface InMemoryEventBusOptions {
  /** Keep every published event in `events` (tests); off by default. */
  record?: boolean;
  /** Receives a subscriber error; defaults to `console.error` with the event name and id (no payload). May be async: a returned promise is awaited. */
  onError?: (error: unknown, event: DomainEvent) => unknown;
}

/**
 * Awaits subscribers in subscription order; a throwing subscriber is reported
 * to `onError` and does not stop delivery. Batches are delivered one at a
 * time, in order, for the whole bus: a slow subscriber delays every publication.
 */
export class InMemoryEventBus implements EventBus {
  readonly events: DomainEvent[] = [];
  readonly #options: InMemoryEventBusOptions;
  #handlers = new Set<EventHandler>();
  #tail: Promise<void> = Promise.resolve();
  #deliveryContext = new AsyncLocalStorage<{ active: boolean }>();

  constructor(options: InMemoryEventBusOptions = {}) {
    this.#options = options;
  }

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
        if (this.#options.record) this.events.push(event);
        for (const handler of this.#handlers) {
          const context = { active: true };
          try {
            await this.#deliveryContext.run(context, () => handler(event));
          } catch (error) {
            await this.#report(error, event);
          } finally {
            context.active = false;
          }
        }
      }
    });
    this.#tail = delivery.catch(() => {});
    return delivery;
  }

  /** Awaited like a handler, so an async `onError` that rejects is caught here too. */
  async #report(error: unknown, event: DomainEvent): Promise<void> {
    try {
      if (this.#options.onError) await this.#options.onError(error, event);
      // Name the event only: its payload may hold data that must not reach a log.
      else
        console.error(
          `Event subscriber failed on ${event.name} (${event.eventId})`,
          error,
        );
    } catch (hookError) {
      console.error(hookError);
    }
  }
}
