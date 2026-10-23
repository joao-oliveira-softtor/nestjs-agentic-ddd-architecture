import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { defineShop, SHOP_MODULE } from './__fixtures__/shop';
import { analyze } from './analyze';
import { evaluateStatus, ownerOf, selectChange, waves } from './state';
import { itemSpecification, specHash } from './item-spec';
import type { IR, IRUseCase } from './ir';
import type { TestCaseResult } from './verify/test-run';
import { parseProposal } from './changes/proposal';
import { workItems } from './graph';
import { implementation } from './implementation';
import { ValueObject, notImplemented } from '@agentic-ddd/core';
import {
  AgentValueObject,
  Invariant,
  createRegistry,
  withRegistry,
} from '@agentic-ddd/decorators';

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

test('G7 resolve fábrica e invariantes em um único proprietário, ignora eventos e removidos', async () => {
  const { workItemFindings } = await import('./verify/work-items');
  const declared = evaluate(
    [],
    new Map([...implemented].map(([id]) => [id, false])),
  );
  const changed = {
    ...proposal,
    archived: true,
    delta: {
      added: [
        'method:Product.create',
        'invariant:Product/preco-positivo',
        'event:ProductCreated',
      ],
      modified: ['method:Product.create'],
      removed: ['method:Product.publish'],
    },
  };
  const findings = workItemFindings(ir, declared, changed);
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({
    message: 'entity:Product está declared',
    fix: 'bun run agentic packet entity:Product',
  });
});

const aluno: IRUseCase = {
  id: 'usecase:matricular_aluno',
  name: 'matricular_aluno',
  module: 'shop',
  description: 'Matricula aluno',
  whenToUse: 'sempre',
  whenNotToUse: null,
  inputSchema: {},
  outputSchema: {},
  uses: [],
  emits: [],
  invariants: [
    {
      id: 'invariant:matricular_aluno/aluno-ativo',
      text: 'Aluno ativo',
      on: null,
      source: 'src/m:1',
    },
  ],
  source: 'src/m:1',
};

test('invariante de use-case tem o use-case como dono e exige covers próprio', () => {
  const withAluno: IR = { ...ir, useCases: [...ir.useCases, aluno] };
  expect(ownerOf(withAluno, 'invariant:matricular_aluno/aluno-ativo')).toBe(
    'usecase:matricular_aluno',
  );
  const impl = new Map(workItems(withAluno).map((i) => [i.id, true]));
  const cases: TestCaseResult[] = workItems(withAluno).flatMap((i) =>
    i.obligations.map((id) => ({
      name: id,
      covers: [id],
      file: 'test.ts',
      line: 1,
      status: 'passed' as const,
    })),
  );
  const statusOf = (list: TestCaseResult[]) =>
    evaluateStatus({
      ir: withAluno,
      implemented: impl,
      proposals: [],
      evidence: { cases: list, exitCode: 0 },
      mode: 'dynamic',
    }).items.find((i) => i.id === 'usecase:matricular_aluno')!;
  expect(
    statusOf(
      cases.filter(
        (t) => !t.covers.includes('invariant:matricular_aluno/aluno-ativo'),
      ),
    ).missingObligations,
  ).toEqual(['invariant:matricular_aluno/aluno-ativo']);
  expect(statusOf(cases).missingObligations).toEqual([]);
});

test('operator que usa o use-case muda o specHash quando o use-case ganha invariante', () => {
  const operator = workItems(ir).find(
    (i) => i.id === 'operator:catalog-operator',
  )!;
  const before = specHash(itemSpecification(ir, operator, []));
  const changed: IR = {
    ...ir,
    useCases: ir.useCases.map((u) =>
      u.id === 'usecase:publish_product'
        ? { ...u, invariants: [aluno.invariants![0]!] }
        : u,
    ),
  };
  expect(specHash(itemSpecification(changed, operator, []))).not.toBe(before);
});

const VO_MODULE = { name: 'vo', path: 'src/compiler' } as const;
const voOptions = {
  root: resolve(import.meta.dir, '../..'),
  modules: [VO_MODULE],
};
const voState = (skeleton: boolean, covered: boolean) => {
  const registry = createRegistry();
  withRegistry(registry, () => {
    if (skeleton) {
      @AgentValueObject({ description: 'Valor monetário.' })
      @Invariant({ id: 'nao-negativo', text: 'Dinheiro nunca é negativo.' })
      class Dinheiro extends ValueObject<{ v: number }> {
        private constructor(p: { v: number }) {
          super(p);
          notImplemented();
        }
        #check() {}
        soma() {
          return this.#check();
        }
      }
      void Dinheiro;
    } else {
      @AgentValueObject({ description: 'Valor monetário.' })
      @Invariant({ id: 'nao-negativo', text: 'Dinheiro nunca é negativo.' })
      class Dinheiro extends ValueObject<{ v: number }> {
        private constructor(p: { v: number }) {
          super(p);
        }
        #check() {}
        soma() {
          return this.#check();
        }
      }
      void Dinheiro;
    }
  });
  const voIr = analyze(registry, voOptions).ir;
  const cases: TestCaseResult[] = covered
    ? [
        {
          name: '[covers: valueobject:Dinheiro, invariant:Dinheiro/nao-negativo] soma',
          covers: ['valueobject:Dinheiro', 'invariant:Dinheiro/nao-negativo'],
          file: 'test.ts',
          line: 1,
          status: 'passed',
        },
      ]
    : [];
  return evaluateStatus({
    ir: voIr,
    implemented: implementation(voIr, registry),
    proposals: [],
    evidence: { cases, exitCode: 0 },
    mode: 'dynamic',
  }).items[0]!;
};

test('value object: esqueleto é declared, implementado sem teste é implemented, com teste fica done', () => {
  expect(voState(true, true).baseState).toBe('declared');
  expect(voState(false, false).baseState).toBe('implemented');
  expect(voState(false, true).state).toBe('done');
});
