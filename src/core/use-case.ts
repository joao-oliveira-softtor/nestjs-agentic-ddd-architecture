import type { DomainEvent } from './domain-event';

export interface UseCaseContext {
  readonly correlationId: string;
  readonly causationId: string;
  publish(events: readonly DomainEvent[]): Promise<void>;
}

export interface UseCase<In, Out> {
  execute(input: In, ctx: UseCaseContext): Promise<Out>;
}
