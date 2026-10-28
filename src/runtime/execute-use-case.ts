import type { UseCase } from '@agentic-ddd/core';
import type { UseCaseRecord } from '@agentic-ddd/decorators';
import { guardEmits } from './emits-guard';
import type { EventBus } from './ports';

/**
 * Runs a use-case outside an operator (e.g. an HTTP route): no LLM and no
 * ApprovalPort, but the same input/output schemas and `emits` rule. A
 * DomainError propagates as is.
 */
export async function executeUseCase(
  record: UseCaseRecord,
  instance: UseCase<unknown, unknown>,
  input: unknown,
  eventBus: EventBus,
): Promise<unknown> {
  return runUseCase(record, instance, record.input.parse(input), eventBus);
}

/** Like `executeUseCase` for an input already parsed by `record.input` (parsing twice breaks transforms). */
export async function runUseCase(
  record: UseCaseRecord,
  instance: UseCase<unknown, unknown>,
  parsed: unknown,
  eventBus: EventBus,
): Promise<unknown> {
  const id = crypto.randomUUID();
  const guard = guardEmits(record, async (event) => {
    event.stamp(id, id);
    await eventBus.publish([event]);
  });
  let output: unknown;
  try {
    output = await instance.execute(parsed, {
      correlationId: id,
      causationId: id,
      publish: guard.publish,
    });
  } catch (error) {
    if (!guard.undeclared) throw error;
  } finally {
    guard.end();
  }
  if (guard.undeclared)
    throw new Error(`Use-case ${record.name} published an undeclared event`);
  return record.output.parse(output);
}
