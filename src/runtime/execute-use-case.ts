import type { UseCase } from '@agentic-ddd/core';
import type { UseCaseRecord } from '@agentic-ddd/decorators';
import type { ZodType } from 'zod';
import { AgenticError } from '../contracts/codes';
import { createDeadline } from './deadline';
import { guardEmits, guardFailure } from './emits-guard';
import type { EventBus } from './ports';

export interface UseCaseOptions {
  /** The `@AgentEvent` payload schema of an event name, if any. Validation only: transforms and defaults do not change the delivered payload. */
  schemaFor?: (name: string) => ZodType | undefined;
  /** Deadline in ms (the runtime's `useCaseTimeoutMs`); unset means no deadline. */
  timeoutMs?: number;
}

/**
 * Runs a use-case outside an operator (e.g. an HTTP route): no LLM and no
 * ApprovalPort, but the same input/output schemas and `emits` rule. A
 * DomainError propagates as is. Each event is validated against its
 * `@AgentEvent` schema only when `options.schemaFor` returns one for its name;
 * with no lookup, or no schema for the name, that event's validation is skipped.
 * With `options.timeoutMs`, the execution and the delivery of its events must
 * finish in time, or it rejects with an `AgenticError` coded
 * `runtime.use-case-timeout` and `ctx.signal` is aborted.
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
  const timeoutMs = options?.timeoutMs;
  const deadline = createDeadline(
    timeoutMs,
    () =>
      new AgenticError(
        'runtime.use-case-timeout',
        `Use-case ${record.name} did not finish within useCaseTimeoutMs (${timeoutMs} ms)`,
      ),
  );
  const guard = guardEmits(
    record,
    async (batch) => {
      for (const event of batch) event.stamp(id, id);
      await eventBus.publish(batch);
    },
    // After the deadline the use-case may still run, but publishes nothing more.
    deadline.check,
    options?.schemaFor,
  );
  let output: unknown;
  let thrown: { error: unknown } | undefined;
  try {
    try {
      output = await deadline.wait(() =>
        instance.execute(parsed, {
          correlationId: id,
          causationId: id,
          signal: deadline.signal,
          publish: guard.publish,
        }),
      );
    } catch (error) {
      thrown = { error };
    }
    // Drain on every path: an un-awaited delivery may still fail after the use-case threw.
    // Under the deadline, so a timeout (of execute or of the drain) wins over every other outcome.
    await deadline.wait(() => guard.drain());
  } finally {
    guard.end();
    deadline.dispose();
  }
  // Precedence: undeclared event, then a bus failure, then the use-case's own error.
  const blocked = guardFailure(guard);
  if (blocked) throw blocked.error;
  if (thrown) throw thrown.error;
  return record.output.parse(output);
}
