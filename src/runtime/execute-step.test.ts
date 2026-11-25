import { expect, test } from 'bun:test';
import { DomainError, DomainEvent, type UseCase } from '@agentic-ddd/core';
import { FakeLlm, InMemoryEventBus } from '@agentic-ddd/testing';
import { Changed, fixture } from '../../test/helpers/runtime';
import { schemaLookup } from './emits-guard';
import { executeUseCase } from './execute-use-case';
import { OperatorRuntime } from './index';

class Other extends DomainEvent<object> {}
const ok = (v: unknown) => ({ value: (v as { value: string }).value });

// The same use-case body, run through both callers of the step executor.
const cases: {
  title: string;
  execute: UseCase<unknown, unknown>['execute'];
  /** operator path: tool result content, or failed run reason + error message */
  operator: { content: unknown } | { reason: string; message: string };
  /** runUseCase path: resolved value or rejection message */
  direct: { value: unknown } | { message: string };
}[] = [
  {
    title: 'valid output and a declared event',
    execute: async (input, ctx) => {
      await ctx.publish([new Changed({ value: 'a' })]);
      return ok(input);
    },
    operator: {
      content: {
        output: { value: 'a' },
        events: [{ name: 'Changed', payload: { value: 'a' } }],
      },
    },
    direct: { value: { value: 'a' } },
  },
  {
    title: 'a DomainError',
    execute: async () => {
      throw new DomainError('nope', 'no way');
    },
    operator: { content: { code: 'nope', message: 'no way' } },
    direct: { message: 'no way' },
  },
  {
    title: 'an undeclared event',
    execute: async (input, ctx) => {
      await ctx.publish([new Other({})]).catch(() => {});
      return input;
    },
    operator: {
      reason: 'use_case_error',
      message: 'Event Other is not declared in emits of use-case tool',
    },
    direct: {
      message: 'Event Other is not declared in emits of use-case tool',
    },
  },
  {
    title: 'an invalid output',
    execute: async () => ({ wrong: true }),
    operator: { reason: 'use_case_error', message: 'ZodError' },
    direct: { message: 'ZodError' },
  },
];

for (const c of cases)
  test(`both paths agree on ${c.title}`, async () => {
    const f = fixture();
    const instance = { execute: c.execute };
    const runtime = new OperatorRuntime({
      ...f,
      llm: new FakeLlm([
        {
          content: [
            {
              type: 'tool_call',
              id: 't1',
              name: 'tool',
              input: { value: 'a' },
            },
          ],
          stopReason: 'tool_calls',
        },
        { content: [{ type: 'text', text: 'done' }], stopReason: 'end' },
      ]),
      eventBus: new InMemoryEventBus({ record: true }),
    });
    await runtime.register(f.Agent, new Map([[f.Tool, instance]]));
    const run = await runtime.run('agent', { message: 'go' });
    const direct = await executeUseCase(
      f.registry.useCases[0]!,
      instance,
      { value: 'a' },
      new InMemoryEventBus({ record: true }),
      { schemaFor: schemaLookup(f.registry) },
    ).then(
      (value) => ({ value }),
      (error: Error) => ({
        message: error.name === 'ZodError' ? 'ZodError' : error.message,
      }),
    );
    if ('content' in c.operator) {
      expect(run.status).toBe('completed');
      expect(run.steps[0]!.tools[0]!.result?.content).toEqual(
        c.operator.content,
      );
    } else {
      expect(run).toMatchObject({
        status: 'failed',
        reason: c.operator.reason,
      });
      const e = run.error as Error;
      expect(e.name === 'ZodError' ? 'ZodError' : e.message).toBe(
        c.operator.message,
      );
    }
    expect(direct).toEqual(c.direct);
  });
