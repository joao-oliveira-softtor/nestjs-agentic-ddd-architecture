import {
  DomainError,
  type DomainEvent,
  type UseCase,
  type UseCaseContext,
} from '@agentic-ddd/core';
import type { UseCaseRecord } from '@agentic-ddd/decorators';
import type { ZodType } from 'zod';
import { guardEmits, guardFailure } from './emits-guard';

/** The guard refused an event or the bus failed: `reason` is what an operator run reports. */
export class StepFailure extends Error {
  constructor(
    readonly reason: 'use_case_error' | 'event_bus_error',
    readonly error: unknown,
  ) {
    super('Use-case step failed');
  }
}

export interface StepOptions {
  correlationId: string;
  causationId?: string;
  /** Delivers one stamped batch; it runs under `wait` only if the caller wraps it. */
  publishEvent: (batch: readonly DomainEvent[]) => void | Promise<void>;
  wait: <T>(operation: () => Promise<T>) => Promise<T>;
  check: () => void;
  signal: AbortSignal;
  schemaFor?: (name: string) => ZodType | undefined;
}

/**
 * One use-case execution for both callers: emits guard, drain, then the outcome.
 * Throws `StepFailure` for an undeclared event or a bus failure, the use-case's
 * own error unless it is a `DomainError`, and the `ZodError` of an invalid output.
 */
export async function executeStep(
  record: UseCaseRecord,
  instance: UseCase<unknown, unknown>,
  parsed: unknown,
  opts: StepOptions,
): Promise<{ output: unknown } | { domainError: DomainError }> {
  const causationId = opts.causationId ?? opts.correlationId;
  const guard = guardEmits(
    record,
    async (batch) => {
      for (const event of batch) event.stamp(opts.correlationId, causationId);
      await opts.publishEvent(batch);
    },
    opts.check,
    opts.schemaFor,
  );
  const ctx: UseCaseContext = {
    correlationId: opts.correlationId,
    causationId,
    signal: opts.signal,
    publish: guard.publish,
  };
  try {
    let output: unknown;
    let thrown: { error: unknown } | undefined;
    try {
      output = await opts.wait(() => instance.execute(parsed, ctx));
    } catch (error) {
      thrown = { error };
    }
    // Drain on every path: an un-awaited delivery may still fail after the use-case threw.
    await opts.wait(() => guard.drain());
    // Precedence: undeclared event, then a bus failure, then the use-case's own error.
    const blocked = guardFailure(guard);
    if (blocked) throw new StepFailure(blocked.reason, blocked.error);
    if (thrown) {
      if (!(thrown.error instanceof DomainError)) throw thrown.error;
      return { domainError: thrown.error };
    }
    return { output: record.output.parse(output) };
  } finally {
    guard.end();
  }
}
