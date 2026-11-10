import type { DomainEvent, UseCaseContext } from '@agentic-ddd/core';

export interface TestContext extends UseCaseContext {
  readonly published: DomainEvent[];
}

export function createTestContext(
  ids: {
    correlationId?: string;
    causationId?: string;
    signal?: AbortSignal;
  } = {},
): TestContext {
  const correlationId = ids.correlationId ?? 'test-run';
  const causationId = ids.causationId ?? 'test-step';
  const published: DomainEvent[] = [];
  return {
    correlationId,
    causationId,
    signal: ids.signal ?? new AbortController().signal,
    published,
    async publish(events) {
      for (const event of events) {
        event.stamp(correlationId, causationId);
        published.push(event);
      }
    },
  };
}
