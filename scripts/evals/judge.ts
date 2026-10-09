import { stableStringify } from '@agentic-ddd/compiler';
import {
  answerSchema,
  implementationReplySchema,
  type Answer,
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
