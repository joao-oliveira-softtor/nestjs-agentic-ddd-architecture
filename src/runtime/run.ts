import {
  DomainError,
  type DomainEvent,
  type UseCaseContext,
} from '@agentic-ddd/core';
import type { ApprovalPort, EventBus, LlmPort } from './ports';
import type { MountedOperator } from './operator-runtime';
import type {
  LlmMessage,
  LlmRequest,
  OperatorRunResult,
  RunInput,
  RunStatus,
  Step,
  TerminationReason,
  ToolResult,
  ToolStep,
} from './types';

class RunTimeout extends Error {
  constructor() {
    super('Operator timeout');
  }
}

/** A single deadline covers provider, approval, execution and event delivery. */
export async function runOperator(
  operator: MountedOperator,
  input: RunInput,
  ports: { llm: LlmPort; approval?: ApprovalPort; eventBus: EventBus },
): Promise<OperatorRunResult> {
  const runId = crypto.randomUUID();
  const steps: Step[] = [];
  const events: DomainEvent[] = [];
  const messages: LlmMessage[] = [{ role: 'user', text: input.message }];
  let active = true;
  const deadline = performance.now() + operator.record.limits.timeoutMs;
  let timer!: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      active = false;
      reject(new RunTimeout());
    }, operator.record.limits.timeoutMs);
  });
  const check = () => {
    if (!active || performance.now() >= deadline) {
      active = false;
      throw new RunTimeout();
    }
  };
  const wait = async <T>(operation: () => Promise<T>): Promise<T> => {
    check();
    const value = await Promise.race([operation(), expired]);
    check();
    return value;
  };
  const finish = (
    status: RunStatus,
    reason?: TerminationReason,
    output?: string,
  ): OperatorRunResult => ({
    runId,
    operator: operator.record.name,
    status,
    ...(reason ? { reason } : {}),
    ...(output !== undefined ? { output } : {}),
    steps,
    events,
  });
  let failure: TerminationReason = 'invalid_context';
  try {
    if (input.context !== undefined) {
      const context = JSON.stringify(input.context);
      if (context === undefined)
        throw new TypeError('Context has no JSON representation');
      messages.push({ role: 'user', text: `Context: ${context}` });
    }
    failure = 'provider_error';
    for (let turn = 0; turn < operator.record.limits.maxSteps; turn++) {
      check();
      const request: LlmRequest = {
        model: operator.record.model,
        system: operator.system,
        tools: operator.tools,
        toolChoice: 'auto',
        messages: [...messages],
      };
      const step: Step = {
        id: crypto.randomUUID(),
        request,
        tools: [],
        events: [],
      };
      steps.push(step);
      failure = 'provider_error';
      const response = await wait(() => ports.llm.complete(request));
      step.response = response;
      if (response.stopReason === 'max_tokens')
        return finish('failed', 'max_tokens');
      if (response.stopReason === 'refusal') return finish('failed', 'refused');
      messages.push({
        role: 'assistant',
        content: response.content,
        ...(response.providerPayload === undefined
          ? {}
          : { providerPayload: response.providerPayload }),
      });
      const calls = response.content.filter((b) => b.type === 'tool_call');
      if (!calls.length && response.stopReason === 'end')
        return finish(
          'completed',
          undefined,
          response.content
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('\n'),
        );
      const results: ToolResult[] = [];
      for (const call of calls) {
        check();
        failure = 'use_case_error';
        const trace: ToolStep = { call, events: [] };
        step.tools.push(trace);
        const result = (content: unknown, isError: boolean) => {
          const value = { toolCallId: call.id, content, isError };
          trace.result = value;
          results.push(value);
        };
        const tool = operator.useCases.get(call.name);
        if (!tool) {
          result({ code: 'unknown_tool', name: call.name }, true);
          continue;
        }
        const parsed = tool.record.input.safeParse(call.input);
        if (!parsed.success) {
          result({ code: 'invalid_input', issues: parsed.error.issues }, true);
          continue;
        }
        trace.policy = operator.record.requiresApproval.includes(
          tool.record.target,
        )
          ? 'require_approval'
          : 'allow';
        if (trace.policy === 'require_approval') {
          trace.approval = ports.approval
            ? await wait(() =>
                ports.approval!.request({
                  operator: operator.record.name,
                  runId,
                  useCase: tool.record.name,
                  input: parsed.data,
                }),
              )
            : { approved: false, reason: 'ApprovalPort is not configured' };
          if (!trace.approval.approved) {
            result(
              {
                code: 'approval_denied',
                ...(trace.approval.reason === undefined
                  ? {}
                  : { reason: trace.approval.reason }),
              },
              true,
            );
            continue;
          }
        }
        let toolActive = true;
        const ctx: UseCaseContext = {
          correlationId: runId,
          causationId: step.id,
          async publish(batch) {
            check();
            if (!toolActive)
              throw new Error('Use-case execution already ended');
            for (const event of batch) {
              check();
              event.stamp(runId, step.id);
              trace.events.push(event);
              step.events.push(event);
              events.push(event);
              // One event at a time: after timeout no next publication is admitted.
              await wait(() => ports.eventBus.publish([event]));
            }
          },
        };
        try {
          const output = await wait(() =>
            tool.instance.execute(parsed.data, ctx),
          );
          const validated = tool.record.output.safeParse(output);
          if (!validated.success) return finish('failed', 'use_case_error');
          result(
            {
              output: validated.data,
              events: trace.events.map((event) => ({
                name: event.name,
                payload: event.payload,
              })),
            },
            false,
          );
        } catch (error) {
          if (error instanceof RunTimeout) throw error;
          if (!(error instanceof DomainError)) throw error;
          result({ code: error.code, message: error.message }, true);
        } finally {
          toolActive = false;
        }
      }
      messages.push({ role: 'tool', results });
    }
    return finish('step_limit');
  } catch (error) {
    return error instanceof RunTimeout
      ? finish('timeout')
      : finish('failed', failure);
  } finally {
    active = false;
    clearTimeout(timer);
  }
}
