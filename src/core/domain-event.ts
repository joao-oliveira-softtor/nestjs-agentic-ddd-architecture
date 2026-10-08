export interface DomainEventMeta {
  readonly eventId?: string;
  readonly occurredAt?: Date;
  readonly correlationId?: string | null;
  readonly causationId?: string | null;
}

export abstract class DomainEvent<P = unknown> {
  readonly eventId: string;
  readonly occurredAt: Date;
  #correlationId: string | null;
  #causationId: string | null;

  constructor(
    readonly payload: P,
    meta: DomainEventMeta = {},
  ) {
    this.eventId = meta.eventId ?? crypto.randomUUID();
    this.occurredAt = meta.occurredAt ?? new Date();
    this.#correlationId = meta.correlationId ?? null;
    this.#causationId = meta.causationId ?? null;
  }

  get name(): string {
    return this.constructor.name;
  }

  get correlationId(): string | null {
    return this.#correlationId;
  }

  get causationId(): string | null {
    return this.#causationId;
  }

  stamp(correlationId: string, causationId: string): void {
    if (this.#correlationId !== null) {
      throw new Error(`Evento ${this.eventId} já foi carimbado`);
    }
    this.#correlationId = correlationId;
    this.#causationId = causationId;
  }
}
