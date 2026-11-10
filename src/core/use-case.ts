import type { DomainEvent } from './domain-event';

export interface UseCaseContext {
  readonly correlationId: string;
  readonly causationId: string;
  /** Aborted when the run's deadline expires. Aborting only notifies: it does not interrupt work in progress. */
  readonly signal: AbortSignal;
  publish(events: readonly DomainEvent[]): Promise<void>;
}

export interface UseCase<In, Out> {
  execute(input: In, ctx: UseCaseContext): Promise<Out>;
}
