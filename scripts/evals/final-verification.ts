import type { VerifyReport } from '@agentic-ddd/compiler';
import type { BenchmarkResult } from './contracts';
import { changeReportSchema } from './report-schema';

export function parseFinalReport(value: unknown): VerifyReport | null {
  const parsed = changeReportSchema.safeParse(value);
  if (!parsed.success || parsed.data.change !== '0001') return null;
  const ids = parsed.data.gates.map((g) => g.id).sort();
  if (ids.join() !== 'G1,G2,G3,G4,G5,G6,G7') return null;
  if (
    parsed.data.status === 'done' &&
    parsed.data.gates.some((g) => g.status !== 'passed')
  )
    return null;
  if (
    parsed.data.status === 'failed' &&
    parsed.data.gates.every((g) => g.status === 'passed')
  )
    return null;
  return parsed.data;
}

export function finalVerificationState(
  final: BenchmarkResult['finalVerification'],
): 'verified' | 'behavior_failed' | 'infra_error' | 'not_run' {
  if (!final) return 'not_run';
  const report = parseFinalReport(final.report);
  if (final.command.result.transport !== 'finished' || !report)
    return 'infra_error';
  if (report.status === 'failed' && final.command.result.exitCode === 1)
    return 'behavior_failed';
  if (report.status !== 'failed' && final.command.result.exitCode === 0)
    return 'verified';
  return 'infra_error';
}
