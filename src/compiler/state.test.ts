import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { defineShop, SHOP_MODULE } from './__fixtures__/shop';
import { analyze } from './analyze';
import { evaluateStatus, selectChange, waves } from './state';
import type { TestCaseResult } from './verify/test-run';
import { parseProposal } from './changes/proposal';
import { workItems } from './graph';

const ir = analyze(defineShop(), {
  root: resolve(import.meta.dir, '../..'),
  modules: [SHOP_MODULE],
}).ir;
const implemented = new Map(workItems(ir).map((i) => [i.id, true]));
const tests: TestCaseResult[] = workItems(ir).flatMap((i) =>
  i.obligations.map((id) => ({
    name: id,
    covers: [id],
    file: 'test.ts',
    line: 1,
    status: 'passed',
  })),
);
const evaluate = (
  cases = tests,
  impl = implemented,
  mode: 'static' | 'dynamic' = 'dynamic',
) =>
  evaluateStatus({
    ir,
    implemented: impl,
    proposals: [],
    evidence: { cases, exitCode: 0 },
    mode,
  });

test('precedência, bloqueios, falhas e skip respeitam todas as obrigações', () => {
  expect(evaluate().items.every((i) => i.state === 'done')).toBe(true);
  const skeleton = evaluate(
    tests,
    new Map([...implemented].map(([id]) => [id, id.startsWith('operator:')])),
  );
  expect(skeleton.items.find((i) => i.id === 'entity:Product')!.state).toBe(
    'declared',
  );
  expect(
    skeleton.items.find((i) => i.id === 'method:Product.publish')!,
  ).toMatchObject({
    baseState: 'declared',
    state: 'blocked',
    blockedBy: ['entity:Product'],
  });
  expect(waves(skeleton).waves).toEqual([
    ['entity:Product'],
    ['method:Product.publish', 'usecase:create_product'],
    ['usecase:publish_product'],
    ['operator:catalog-operator'],
  ]);
  const missing = evaluate(
    tests.filter((t) => !t.covers.includes('method:Product.create')),
  );
  expect(missing.items[0]!).toMatchObject({
    baseState: 'implemented',
    missingObligations: ['method:Product.create'],
  });
  for (const status of ['failed', 'skipped'] as const) {
    const failed = evaluate(
      tests.map((t, n) => (n === 0 ? { ...t, status } : t)),
    );
    expect(failed.items[0]!.state).toBe('covered');
    expect(failed.items[0]!.unsuccessfulTests).toHaveLength(1);
  }
  expect(
    evaluate(tests, implemented, 'static').items.every(
      (i) => i.baseState === 'covered',
    ),
  ).toBe(true);
  expect(waves(evaluate()).waves).toEqual([]);
});

const proposal = parseProposal(
  `---
id: "0003"
title: Nova regra
status: proposed
origin: proposal-first
delta:
  modified: [invariant:Product/publicacao-exige-estoque]
acceptance:
  - id: novo
    covers: [invariant:Product/publicacao-exige-estoque]
    given: produto
    when: publicar
    then: publicado
  - id: humano
    manual: true
    then: revisar
---
## Motivo
Nova regra.
`,
  '0003-nova-regra',
  'changes/0003-nova-regra/proposal.md',
  false,
).proposal!;

test('critério aberto retira done, resolve proprietário de invariante e inclui dependências pendentes', () => {
  const report = evaluateStatus({
    ir,
    implemented,
    proposals: [proposal],
    evidence: { cases: tests, exitCode: 0 },
    mode: 'dynamic',
  });
  const item = report.items.find((i) => i.id === 'method:Product.publish')!;
  expect(item.missingObligations).toEqual(['criterion:0003/novo']);
  expect(selectChange(report, ir, proposal).items.map((i) => i.id)).toEqual([
    'method:Product.publish',
  ]);
  const empty = evaluate([]);
  expect(selectChange(empty, ir, proposal).items.map((i) => i.id)).toEqual([
    'entity:Product',
    'method:Product.publish',
  ]);
});
