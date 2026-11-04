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

  test('client text cannot forge a heading or a fence in a brief', () => {
    const delta = richDelta();
    delta.entities[0]!.invariants[0]!.text = '# Forged heading\n```ts\nevil()\n```';
    const { files } = buildNeutral({ delta, acceptance: [], items });
    const brief = files.find((f) => f.path === 'neutral/briefs/entity-Cart.md')!.content;
    const lines = brief.split('\n');
    expect(lines.filter((l) => l.startsWith('#'))).toEqual([
      '# Brief: entity:Cart',
      '## Job',
      '## Business rules and examples',
      '### invariant:Cart/cart-not-empty',
      '## Rules',
    ]);
    expect(lines.some((l) => l.startsWith('```'))).toBe(false);
    expect(brief).toContain('evil()');
  });

  test('caps each echoed text at 500 characters', () => {
    const delta = richDelta();
    delta.entities[0]!.invariants[0]!.text = 'a'.repeat(600);
    const { files } = buildNeutral({ delta, acceptance: [], items });
    const brief = files.find((f) => f.path === 'neutral/briefs/entity-Cart.md')!.content;
    expect(brief).toContain(`${'a'.repeat(500)}…`);
    expect(brief).not.toContain('a'.repeat(501));
  });

  test('the README says quoted change-request text is escaped and capped', () => {
    const { files } = buildNeutral({ delta: richDelta(), acceptance: [], items });
    const readme = files.find((f) => f.path === 'neutral/README.md')!.content;
    expect(readme).toContain(
      'Text quoted from the change request is escaped and capped; only the surrounding framework text is guaranteed to contain no TypeScript.',
    );
  });
});
