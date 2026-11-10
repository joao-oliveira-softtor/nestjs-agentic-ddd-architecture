import type { UseCase } from '@agentic-ddd/core';
import type { UseCaseRecord } from '@agentic-ddd/decorators';
import type { ZodType } from 'zod';
import { guardEmits } from './emits-guard';
import type { EventBus } from './ports';

export interface UseCaseOptions {
  /** The `@AgentEvent` payload schema of an event name, if any. Validation only: transforms and defaults do not change the delivered payload. */
  schemaFor?: (name: string) => ZodType | undefined;
}

/**
 * Runs a use-case outside an operator (e.g. an HTTP route): no LLM and no
 * ApprovalPort, but the same input/output schemas and `emits` rule. A
 * DomainError propagates as is. Each event is validated against its
 * `@AgentEvent` schema only when `options.schemaFor` returns one for its name;
 * with no lookup, or no schema for the name, that event's validation is skipped.
 */
export async function executeUseCase(
  record: UseCaseRecord,
  instance: UseCase<unknown, unknown>,
  input: unknown,
  eventBus: EventBus,
  options?: UseCaseOptions,
): Promise<unknown> {
  return runUseCase(
    record,
    instance,
    record.input.parse(input),
    eventBus,
    options,
  );
}

/** Like `executeUseCase` for an input already parsed by `record.input` (parsing twice breaks transforms). */
export async function runUseCase(
  record: UseCaseRecord,
  instance: UseCase<unknown, unknown>,
  parsed: unknown,
  eventBus: EventBus,
  options?: UseCaseOptions,
): Promise<unknown> {
  const id = crypto.randomUUID();
  const guard = guardEmits(
    record,
    async (batch) => {
      for (const event of batch) event.stamp(id, id);
      await eventBus.publish(batch);
    },
    undefined,
    options?.schemaFor,
  );
  let output: unknown;
  let thrown: { error: unknown } | undefined;
  try {
    output = await instance.execute(parsed, {
      correlationId: id,
      causationId: id,
      signal: new AbortController().signal, // never aborts: no deadline here yet
      publish: guard.publish,
    });
  } catch (error) {
    thrown = { error };
  }
  // Drain on every path: an un-awaited delivery may still fail after the use-case threw.
  await guard.drain();
  guard.end();
  // Precedence: undeclared event, then a bus failure, then the use-case's own error.
  if (guard.refusal) throw guard.refusal;
  if (guard.failed) throw guard.failed.error;
  if (thrown) throw thrown.error;
  return record.output.parse(output);
}
