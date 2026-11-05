import type { DomainLock } from '../../src/compiler/lock';

// Synthetic change ids: far from the sequential ids `compile` hands out to the repo lock.
export const CROSS = '0900';
export const BILLING_ONLY = '0901';

// The repo lock has only `orders`: `billing` is a renamed copy, linked to orders in both directions.
export function twoModuleLock(orders: DomainLock): DomainLock {
  const copy = (xs: unknown[]): any[] =>
    JSON.parse(
      JSON.stringify(xs)
        .replaceAll('examples/orders', 'examples/billing')
        .replaceAll('"module":"orders"', '"module":"billing"')
        .replace(/Order/g, 'Invoice')
        .replace(/order/g, 'invoice'),
    );
  const lock = structuredClone(orders) as any;
  const ir = lock.ir;
  const billing = {
    entities: copy(ir.entities),
    events: copy(ir.events),
    useCases: copy(ir.useCases),
    operators: copy(ir.operators),
  };
  // billing -> orders (a use-case uses an orders method), orders -> billing (a reference).
  billing.useCases[0].uses.push(ir.entities[0].methods[0].id);
  ir.entities[0].references = [billing.entities[0].id];
  ir.modules.push({ name: 'billing', path: 'examples/billing' });
  for (const key of ['entities', 'events', 'useCases', 'operators'] as const)
    ir[key].push(...billing[key]);
  const [ordersOnly] = lock.changes;
  const item = (id: string, module: string) => ({
    classification: 'behavioral',
    id,
    kind: 'changed',
    module,
  });
  lock.changes.push(
    {
      ...ordersOnly,
      id: CROSS,
      title: 'Invoice rules and order totals',
      summary: 'Touches billing and orders together.',
      items: [
        item(ir.entities[0].id, 'orders'),
        item(billing.entities[0].id, 'billing'),
      ],
    },
    {
      ...ordersOnly,
      id: BILLING_ONLY,
      title: 'Invoice only',
      summary: 'Billing only.',
      items: [item(billing.entities[0].id, 'billing')],
    },
  );
  return lock;
}
