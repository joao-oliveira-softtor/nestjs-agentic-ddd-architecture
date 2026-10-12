import { stableStringify } from '@agentic-ddd/compiler';
import {
  answerSchema,
  implementationReplySchema,
  type AdapterResult,
  type Answer,
  type EvalVerdict,
  type ImplementationReply,
} from './contracts';

export function parseAnswer(text: string): Answer {
  return answerSchema.parse(JSON.parse(text));
}
export function parseImplementationReply(text: string): ImplementationReply {
  return implementationReplySchema.parse(JSON.parse(text));
}
export function judge(
  expectation: Answer,
  observed: Answer,
): 'correct' | 'incorrect' {
  return stableStringify(expectation) === stableStringify(observed)
    ? 'correct'
    : 'incorrect';
}
/**
 * The one verdict for a skills case, used by the runner and by the aggregator.
 * An answer only counts from a run that finished with exit 0; a cancelled run
 * is an infrastructure failure, so classifyRunStatus never sees it as
 * completed when no stop reason explains it.
 */
export function verdictOf(
  execution: AdapterResult | null,
  expectation: Answer,
): EvalVerdict {
  if (!execution) return 'not_run';
  if (execution.transport === 'timeout') return 'timeout';
  if (execution.transport !== 'finished' || execution.exitCode !== 0)
    return 'infra_error';
  try {
    return judge(expectation, parseAnswer(execution.finalText ?? ''));
  } catch {
    return 'malformed';
  }
}
