import { expect, test } from 'bun:test';
import {
  DomainError,
  DomainEvent,
  type UseCase,
  type UseCaseContext,
} from '@agentic-ddd/core';
import { FakeApproval, FakeLlm, InMemoryEventBus } from '@agentic-ddd/testing';
import { buildIR, irHash } from '../contracts/ir';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from '../../test/helpers/runtime';
import {
  OperatorRuntime,
  type AssistantBlock,
  type LlmResponse,
  type RuntimeOptions,
} from './index';

const end: LlmResponse = {
  content: [{ type: 'text', text: 'done' }],
  stopReason: 'end',
};
const call = (
  id = 't1',
  name = 'tool',
  input: unknown = { value: 'a' },
): AssistantBlock => ({ type: 'tool_call', id, name, input });
const calls = (...content: AssistantBlock[]): LlmResponse => ({
  content,
  stopReason: 'tool_calls',
});
class Changed extends DomainEvent {}
async function setup(
  script: ConstructorParameters<typeof FakeLlm>[0],
  execute: UseCase<unknown, unknown>['execute'] = async (input) => input,
  options: Partial<RuntimeOptions> = {},
  limits?: { maxSteps?: number; timeoutMs?: number },
  approval = false,
) {
  const f = fixture();
  if (limits || approval) {
    f.registry.operators[0] = {
      ...f.registry.operators[0]!,
      limits: { ...f.registry.operators[0]!.limits, ...limits },
      requiresApproval: approval ? [f.Tool] : [],
    };
    const hash = irHash(buildIR(f.registry, f).ir);
    writeFileSync(
      join(f.skillDir, 'SKILL.md'),
      f.skill.replace(/[a-f0-9]{64}/, hash),
    );
  }
  const llm = new FakeLlm(script);
  const eventBus = new InMemoryEventBus();
  const runtime = new OperatorRuntime({ ...f, llm, eventBus, ...options });
  await runtime.register(f.Agent, new Map([[f.Tool, { execute }]]));
  return { runtime, llm, eventBus };
}

test('loop executes sequentially, validates/transmits outputs, groups tool results and preserves providerPayload', async () => {
  const native = { reasoning: Symbol('opaque') };
  const seen: string[] = [];
  const f = await setup(
    [
      {
        ...calls(call(), call('t2', 'tool', { value: 'b' })),
        providerPayload: native,
      },
      end,
    ],
    async (input, ctx) => {
      const value = (input as { value: string }).value;
      seen.push(value);
      await Bun.sleep(2);
      await ctx.publish([new Changed({ value })]);
      return { value: value.toUpperCase() };
    },
  );
  const result = await f.runtime.run('agent', { message: 'go' });
  expect(result.status).toBe('completed');
  expect(result.output).toBe('done');
  expect(seen).toEqual(['a', 'b']);
  expect(f.llm.requests[0]!.messages).toHaveLength(1);
  expect(f.llm.requests[1]!.messages).toHaveLength(3);
  const assistant = f.llm.requests[1]!.messages[1]!;
  expect(assistant.role === 'assistant' && assistant.providerPayload).toBe(
    native,
  );
  expect(f.llm.requests[1]!.messages[2]).toEqual({
    role: 'tool',
    results: [
      {
        toolCallId: 't1',
        isError: false,
        content: {
          output: { value: 'A' },
          events: [{ name: 'Changed', payload: { value: 'a' } }],
        },
      },
      {
        toolCallId: 't2',
        isError: false,
        content: {
          output: { value: 'B' },
          events: [{ name: 'Changed', payload: { value: 'b' } }],
        },
      },
    ],
  });
  expect(result.events).toEqual(f.eventBus.events);
  expect(result.steps[0]!.tools.map((t) => t.policy)).toEqual([
    'allow',
    'allow',
  ]);
  expect(new Set([result.runId, ...result.steps.map((s) => s.id)]).size).toBe(
    3,
  );
  for (const event of result.events) {
    expect(event.correlationId).toBe(result.runId);
    expect(event.causationId).toBe(result.steps[0]!.id);
  }
});

test('unknown_tool, invalid_input and DomainError are recoverable results; invalid calls never execute', async () => {
  let executions = 0;
  const f = await setup(
    [
      calls(
        call('unknown', 'outside'),
        call('invalid', 'tool', { value: 9 }),
        call('domain'),
      ),
      end,
    ],
    async () => {
      executions++;
      throw new DomainError('NO_WORK', 'no work');
    },
  );
  const result = await f.runtime.run('agent', { message: 'go' });
  expect(result.status).toBe('completed');
  expect(executions).toBe(1);
  const tool = f.llm.requests[1]!.messages[2]!;
  expect(tool.role).toBe('tool');
  if (tool.role !== 'tool') throw new Error('missing results');
  expect(tool.results.map((r) => (r.content as { code: string }).code)).toEqual(
    ['unknown_tool', 'invalid_input', 'NO_WORK'],
  );
  expect(tool.results.every((r) => r.isError)).toBe(true);
  expect(
    (tool.results[1]!.content as { issues: unknown[] }).issues.length,
  ).toBeGreaterThan(0);
});

for (const approved of [false, true]) {
  test(`approval ${approved} precedes execute and is recorded`, async () => {
    const approval = new FakeApproval(() => ({
      approved,
      reason: 'human decision',
    }));
    let executed = 0;
    const f = await setup(
      [calls(call()), end],
      async (input, ctx) => {
        expect(approval.requests).toHaveLength(1);
        executed++;
        await ctx.publish([new Changed('x')]);
        return input;
      },
      { approval },
      undefined,
      true,
    );
    const result = await f.runtime.run('agent', { message: 'go' });
    expect(result.status).toBe('completed');
    expect(executed).toBe(approved ? 1 : 0);
    expect(result.events).toHaveLength(approved ? 1 : 0);
    expect(result.steps[0]!.tools[0]!.approval).toEqual({
      approved,
      reason: 'human decision',
    });
    expect(approval.requests[0]).toEqual({
      operator: 'agent',
      runId: result.runId,
      useCase: 'tool',
      input: { value: 'a' },
    });
    if (!approved)
      expect(result.steps[0]!.tools[0]!.result?.content).toEqual({
        code: 'approval_denied',
        reason: 'human decision',
      });
  });
}

test('missing ApprovalPort denies protected tools', async () => {
  let executed = false;
  const f = await setup(
    [calls(call()), end],
    async (input) => {
      executed = true;
      return input;
    },
    {},
    undefined,
    true,
  );
  const result = await f.runtime.run('agent', { message: 'go' });
  expect(executed).toBe(false);
  expect(result.steps[0]!.tools[0]!.result?.isError).toBe(true);
});

for (const [stopReason, reason] of [
  ['max_tokens', 'max_tokens'],
  ['refusal', 'refused'],
] as const) {
  test(`termination ${stopReason} starts no tools`, async () => {
    let executed = false;
    const f = await setup([{ ...calls(call()), stopReason }], async (input) => {
      executed = true;
      return input;
    });
    const result = await f.runtime.run('agent', { message: 'go' });
    expect(result.status).toBe('failed');
    expect(result.reason).toBe(reason);
    expect(executed).toBe(false);
  });
}
test('provider_error stops and records attempted request', async () => {
  const f = await setup([
    () => {
      throw new Error('provider failed');
    },
  ]);
  const result = await f.runtime.run('agent', { message: 'go' });
  expect(result.status).toBe('failed');
  expect(result.reason).toBe('provider_error');
  expect(result.steps).toHaveLength(1);
});
for (const variant of ['throw', 'output'] as const) {
  test(`use_case_error (${variant}) prevents subsequent tool and LLM calls`, async () => {
    let executions = 0;
    const f = await setup([calls(call(), call('later')), end], async () => {
      executions++;
      if (variant === 'throw') throw new Error('bug');
      return { wrong: true };
    });
    const result = await f.runtime.run('agent', { message: 'go' });
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('use_case_error');
    expect(executions).toBe(1);
    expect(f.llm.requests).toHaveLength(1);
  });
}
test('step_limit counts LLM calls, not tools', async () => {
  const f = await setup(
    [calls(call(), call('two')), end],
    undefined,
    {},
    { maxSteps: 1 },
  );
  const result = await f.runtime.run('agent', { message: 'go' });
  expect(result.status).toBe('step_limit');
  expect(result.steps[0]!.tools).toHaveLength(2);
  expect(f.llm.requests).toHaveLength(1);
});

for (const stage of ['llm', 'approval', 'execute', 'bus'] as const) {
  test(`timeout bounds pending ${stage}; late resolution starts no extra tools/publications`, async () => {
    let resolvePending!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolvePending = resolve;
    });
    let executions = 0;
    let lateContext: UseCaseContext | undefined;
    const approval = new FakeApproval(async () => {
      await pending;
      return { approved: true };
    });
    const f = await setup(
      stage === 'llm'
        ? [
            async () => {
              await pending;
              return calls(call());
            },
          ]
        : [calls(call(), call('late')), end],
      async (input, ctx) => {
        executions++;
        lateContext = ctx;
        if (stage === 'execute') await pending;
        if (stage === 'bus') await ctx.publish([new Changed('early')]);
        return input;
      },
      stage === 'approval' ? { approval } : {},
      { timeoutMs: 20 },
      stage === 'approval',
    );
    if (stage === 'bus') f.eventBus.subscribe(() => pending);
    const result = await f.runtime.run('agent', { message: 'go' });
    expect(result.status).toBe('timeout');
    const count = executions;
    const eventCount = result.events.length;
    resolvePending();
    await Bun.sleep(5);
    expect(executions).toBe(count);
    expect(executions).toBe(stage === 'llm' || stage === 'approval' ? 0 : 1);
    expect(f.llm.requests).toHaveLength(1);
    expect(result.events).toHaveLength(eventCount);
    if (lateContext)
      expect(lateContext.publish([new Changed('late')])).rejects.toThrow(
        'timeout',
      );
    expect(f.eventBus.events).toHaveLength(eventCount);
  });
}

for (const [name, context] of [
  ['bigint', 1n],
  [
    'circular reference',
    (() => {
      const value: { self?: unknown } = {};
      value.self = value;
      return value;
    })(),
  ],
  [
    'throwing toJSON',
    {
      toJSON() {
        throw new Error('cannot serialize');
      },
    },
  ],
  ['function', () => 'value'],
  ['symbol', Symbol('context')],
  [
    'undefined JSON representation',
    {
      toJSON() {
        return undefined;
      },
    },
  ],
] as const) {
  test(`non-JSON context (${name}) returns failed without provider/tool/event side effects`, async () => {
    let executions = 0;
    const f = await setup([calls(call()), end], async (input) => {
      executions++;
      return input;
    });
    const result = await f.runtime.run('agent', { message: 'go', context });
    expect(result).toMatchObject({
      operator: 'agent',
      status: 'failed',
      reason: 'invalid_context',
      steps: [],
      events: [],
    });
    expect(result.runId).toBeString();
    expect(f.llm.requests).toEqual([]);
    expect(executions).toBe(0);
    expect(f.eventBus.events).toEqual([]);
  });
}
