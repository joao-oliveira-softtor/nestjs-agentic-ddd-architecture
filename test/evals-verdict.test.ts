import { expect, test } from 'bun:test';
import {
  emptyUsage,
  unavailable,
  type AdapterResult,
  type Answer,
  type CaseResult,
  type EvalReport,
} from '../scripts/evals/contracts';
import { verdictOf } from '../scripts/evals/judge';
import { classifyRunStatus } from '../scripts/evals/run';

const EXPECT: Answer = { type: 'exact', value: 'ok' };
const right = JSON.stringify(EXPECT);
const wrong = JSON.stringify({ type: 'exact', value: 'no' });
function execution(
  transport: AdapterResult['transport'],
  exitCode: number | null,
  finalText: string | null,
): AdapterResult {
  return {
    transport,
    finalText,
    exitCode,
    signal: null,
    sessionId: unavailable(),
    observedModel: unavailable(),
    modelRevision: unavailable(),
    usage: emptyUsage(),
    durationMs: 1,
    evidence: [],
    diagnostic: null,
  };
}

// One verdict for the skills runner and the aggregator: an answer only counts
// from a run that finished with exit 0.
test.each([
  ['sem execução', null, 'not_run'],
  ['timeout', execution('timeout', null, right), 'timeout'],
  ['cancelado', execution('cancelled', null, right), 'infra_error'],
  ['infra_error', execution('infra_error', null, right), 'infra_error'],
  ['finished com exit ≠ 0', execution('finished', 1, right), 'infra_error'],
  ['finished sem exit', execution('finished', null, right), 'infra_error'],
  ['JSON inválido', execution('finished', 0, '```json\n{}\n```'), 'malformed'],
  ['resposta vazia', execution('finished', 0, null), 'malformed'],
  ['acerto', execution('finished', 0, right), 'correct'],
  ['erro', execution('finished', 0, wrong), 'incorrect'],
] as const)('verdictOf: %s → %s', (_label, run, verdict) => {
  expect(verdictOf(run, EXPECT)).toBe(verdict);
});

test('caso cancelado sem motivo de parada deixa a execução em infra_error; com motivo, vale o motivo', () => {
  const cancelled = execution('cancelled', null, right);
  const cases = [
    {
      expect: EXPECT,
      execution: cancelled,
      verdict: verdictOf(cancelled, EXPECT),
    },
  ] as CaseResult[];
  const report = {
    status: 'completed',
    cases,
    benchmarks: [],
  } as unknown as EvalReport;
  expect(classifyRunStatus(report, null)).toBe('infra_error');
  expect(classifyRunStatus(report, 'cancelled')).toBe('cancelled');
});
