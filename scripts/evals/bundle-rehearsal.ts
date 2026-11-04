import { z } from 'zod';
import { changeReportSchema } from './report-schema';

/**
 * The per-run record of the bundle measurement (#122, `evals/campaigns/cycle-23-bundle/PREREGISTRATION.md`):
 * the metrics the pre-registration reads (initial and final acceptance, corrections, certified runs,
 * timeouts) come from the items, and the certification is the `verify NNNN` change report the
 * cycle-21 and cycle-22 campaigns already parse.
 */
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const attempt = z.strictObject({
  number: z.number().int().positive(),
  transport: z.enum(['finished', 'timeout', 'cancelled', 'infra_error']),
  /** `agentic verify --item` returned `done` after this attempt. */
  accepted: z.boolean(),
});
const itemRun = z.strictObject({
  item: z.string().min(1),
  specHash: hash,
  state: z.enum(['accepted', 'failed']),
  attempts: z.array(attempt).min(1),
});
export const bundleRunSchema = z.strictObject({
  configuration: z.string().min(1),
  repetition: z.number().int().positive(),
  bundleHash: hash,
  baseRef: z.string().min(1),
  items: z.array(itemRun).min(1),
  finalVerification: changeReportSchema,
});
export type BundleRun = z.infer<typeof bundleRunSchema>;
export type BundleItemRun = BundleRun['items'][number];

const rate = (numerator: number, denominator: number) => ({
  numerator,
  denominator,
});

/** The pre-registration metrics of one run; `certifiedRuns` is 1 only when `verify NNNN` said `done`. */
export function summarizeBundleRun(
  items: readonly BundleItemRun[],
  finalStatus: BundleRun['finalVerification']['status'],
) {
  const attempts = items.flatMap((i) => i.attempts);
  return {
    initial: rate(
      items.filter((i) => i.attempts[0]!.accepted).length,
      items.length,
    ),
    final: rate(
      items.filter((i) => i.state === 'accepted').length,
      items.length,
    ),
    corrections: attempts.length - items.length,
    certifiedRuns: finalStatus === 'done' ? 1 : 0,
    timeouts: attempts.filter((a) => a.transport === 'timeout').length,
  };
}

const CREDENTIAL = /key|token|secret|password|credential/i;

/** The environment for every child of the rehearsal: the caller's, minus anything that looks like a credential. */
export const offlineEnv = (
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter(
      (e): e is [string, string] =>
        e[1] !== undefined && !CREDENTIAL.test(e[0]),
    ),
  );
