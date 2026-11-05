import { available, unavailable } from './contracts';

/** A count over a planned total: what the aggregate reports as initial, final and certification rates. */
export const rate = (numerator: number, denominator: number) => ({
  numerator,
  denominator,
  value: denominator
    ? available(numerator / denominator, 'evidence_counts')
    : unavailable<number>('zero_denominator'),
});

/**
 * Item-level counts of one run, shared by the campaign aggregate and the bundle run record: items whose
 * first attempt was accepted, items whose last attempt was, and the attempts beyond each item's first.
 */
export function tallyItems<A>(
  items: readonly { attempts: readonly A[] }[],
  accepted: (attempt: A | undefined) => boolean,
) {
  return {
    initial: items.filter((i) => accepted(i.attempts[0])).length,
    final: items.filter((i) => accepted(i.attempts.at(-1))).length,
    corrections: items.reduce(
      (n, i) => n + Math.max(0, i.attempts.length - 1),
      0,
    ),
  };
}

/** A run is certified only when every planned item ended accepted, `verify NNNN` said `done` and the origin did not change. */
export const isCertified = (run: {
  finalItems: number;
  plannedItems: number;
  verifiedDone: boolean;
  originUnchanged: boolean;
}) =>
  run.finalItems === run.plannedItems &&
  run.verifiedDone &&
  run.originUnchanged;
