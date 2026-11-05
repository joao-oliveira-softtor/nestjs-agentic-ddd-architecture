import { z } from 'zod';
import { changeReportSchema } from './report-schema';
import { isCertified, rate, tallyItems } from './item-tally';

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
  attempts: z.array(attempt).min(1),
});
export const bundleRunSchema = z
  .strictObject({
    configuration: z.string().min(1),
    repetition: z.number().int().positive(),
    bundleHash: hash,
    baseRef: z.string().min(1),
    /** Items the bundle plans; a run that stops early has fewer `items`, and the rates divide by this. */
    plannedItems: z.number().int().positive(),
    /** Fingerprints of the origin project before and after the run (`fingerprintOrigin`). */
    originBefore: hash,
    originAfter: hash,
    items: z.array(itemRun).min(1),
    finalVerification: changeReportSchema,
  })
  .refine((r) => r.items.length <= r.plannedItems, {
    message: 'more items than planned',
  });
export type BundleRun = z.infer<typeof bundleRunSchema>;
export type BundleItemRun = BundleRun['items'][number];

/**
 * The pre-registration metrics of one run, counted as the cycle-21 aggregate counts them (`tallyItems`,
 * `isCertified`): an item is accepted when its last attempt is, and the run is certified only when every
 * planned item is accepted, `verify NNNN` said `done` and the origin is unchanged.
 */
export function summarizeBundleRun(run: BundleRun) {
  const tally = tallyItems(run.items, (a) => a?.accepted === true);
  return {
    initial: rate(tally.initial, run.plannedItems),
    final: rate(tally.final, run.plannedItems),
    corrections: tally.corrections,
    certifiedRuns: isCertified({
      finalItems: tally.final,
      plannedItems: run.plannedItems,
      verifiedDone: run.finalVerification.status === 'done',
      originUnchanged: run.originBefore === run.originAfter,
    })
      ? 1
      : 0,
    timeouts: run.items
      .flatMap((i) => i.attempts)
      .filter((a) => a.transport === 'timeout').length,
  };
}

const CREDENTIAL = /key|token|secret|password|credential/i;

/**
 * The caller's environment minus every variable whose name looks like a credential. A name-based denylist:
 * it keeps the rest (HOME included) and does nothing about the network; the rehearsal gives it to the
 * `agentic` children it spawns, and the executor sandbox has its own empty environment and no network.
 */
export const offlineEnv = (
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter(
      (e): e is [string, string] =>
        e[1] !== undefined && !CREDENTIAL.test(e[0]),
    ),
  );
