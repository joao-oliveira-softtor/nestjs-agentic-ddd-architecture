import { describe, expect, test } from 'bun:test';
import { buildNeutral } from './neutral';
import { neutralLeaks, richDelta } from './neutral-testkit';

const items = [
  { id: 'entity:Cart', layer: 'domain', wave: 1 },
  { id: 'method:Cart.close', layer: 'domain', wave: 2 },
  { id: 'usecase:close_cart', layer: 'application', wave: 3 },
  { id: 'event:CartClosed', layer: 'domain', wave: 1 },
];

describe('buildNeutral', () => {
  test('no TypeScript path or syntax appears in any neutral file', () => {
    const { files } = buildNeutral({ delta: richDelta(), acceptance: [], items });
    expect(files.length).toBeGreaterThan(items.length);
    expect(neutralLeaks(files)).toEqual([]);
  });

  test('the leak scan itself catches TypeScript', () => {
    const bad = [{ path: 'neutral/x.md', content: "import { a } from 'src/a.ts';" }];
    expect(neutralLeaks(bad).length).toBeGreaterThan(0);
  });

  test('every invariant carries at least one example', () => {
    const { model } = buildNeutral({ delta: richDelta(), acceptance: [], items });
    expect(model.invariants.map((i) => i.id)).toEqual([
      'invariant:Cart/cart-not-empty',
      'invariant:Cart/close-needs-open',
    ]);
    for (const inv of model.invariants) expect(inv.examples.length).toBeGreaterThan(0);
  });

  test('refuses an invariant without examples', () => {
    const delta = richDelta();
    delta.entities[0]!.invariants[0]!.examples = [];
    expect(() => buildNeutral({ delta, acceptance: [], items })).toThrow();
  });

  test('derives transitions and neutral types from the Delta', () => {
    const { model } = buildNeutral({ delta: richDelta(), acceptance: [], items });
    expect(model.transitions).toEqual([
      { entity: 'Cart', method: 'close', from: ['open'], to: 'closed' },
    ]);
    expect(model.entities[0]!.methods[0]!.inputs).toEqual([
      { name: 'note', type: 'text', optional: true },
      { name: 'tags', type: 'list of text', optional: false },
      { name: 'at', type: 'timestamp', optional: false },
    ]);
    expect(model.entities[0]!.methods[0]!.returns).toBe('nothing');
  });

  test('says there are no transitions instead of inventing them', () => {
    const delta = richDelta();
    delete delta.entities[0]!.methods[0]!.transition;
    expect(buildNeutral({ delta, acceptance: [], items }).model.transitions).toEqual([]);
  });

  test('states that the neutral layer has no done certification', () => {
    const { files } = buildNeutral({ delta: richDelta(), acceptance: [], items });
    for (const f of files.filter((x) => x.path.endsWith('.md')))
      expect(f.content).toContain('no `done` certification');
  });
});
