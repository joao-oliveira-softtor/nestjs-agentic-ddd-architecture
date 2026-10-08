import type { DomainEvent } from './domain-event';
import { Entity } from './entity';

export abstract class AggregateRoot<Id> extends Entity<Id> {
  #events: DomainEvent[] = [];

  protected record(event: DomainEvent): void {
    this.#events.push(event);
  }

  pullEvents(): DomainEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }
}
