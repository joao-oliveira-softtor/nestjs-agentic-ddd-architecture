import type { DomainEvent } from '@agentic-ddd/core';
import { createDeadline } from './deadline';
import { executeStep, StepFailure } from './execute-step';
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
  const deadline = createDeadline(
    operator.record.limits.timeoutMs,
    () => new RunTimeout(),
  );
  const { check, wait } = deadline;
  const finish = (
    status: RunStatus,
    reason?: TerminationReason,
    output?: string,
    ...caught: [error?: unknown]
  ): OperatorRunResult => ({
    runId,
    operator: operator.record.name,
    status,
    ...(reason ? { reason } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(caught.length ? { error: caught[0] } : {}),
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
      const response = await wait(() =>
        ports.llm.complete(request, deadline.signal),
      );
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
      if (!calls.length && response.stopReason === 'tool_calls')
        return finish('failed', 'provider_error');
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
          failure = 'approval_error';
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
          // Only here: a port that resolves with no decision is still the port's failure.
          failure = 'use_case_error';
        }
        const outcome = await executeStep(
          tool.record,
          tool.instance,
          parsed.data,
          {
            correlationId: runId,
            causationId: step.id,
            signal: deadline.signal,
            check,
            wait,
            schemaFor: operator.schemaFor,
            // One call per batch, under the run deadline: after timeout no later publication is admitted.
            publishEvent: async (batch) => {
              for (const event of batch) {
                trace.events.push(event);
                step.events.push(event);
                events.push(event);
              }
              await wait(() => ports.eventBus.publish(batch));
            },
          },
        ).catch((error: unknown) => {
          if (error instanceof StepFailure) return error;
          throw error;
        });
        if (outcome instanceof StepFailure)
          return finish('failed', outcome.reason, undefined, outcome.error);
        if ('domainError' in outcome)
          result(
            {
              code: outcome.domainError.code,
              message: outcome.domainError.message,
            },
            true,
          );
        else
          result(
            {
              output: outcome.output,
              events: trace.events.map((event) => ({
                name: event.name,
                payload: event.payload,
              })),
            },
            false,
          );
      }
      messages.push({ role: 'tool', results });
    }
    return finish('step_limit');
  } catch (error) {
    return error instanceof RunTimeout
      ? finish('timeout')
      : finish('failed', failure, undefined, error);
  } finally {
    deadline.dispose();
  }
}
