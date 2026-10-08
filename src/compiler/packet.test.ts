import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { defineShop, SHOP_MODULE } from './__fixtures__/shop';
import { analyze } from './analyze';
import { workItems } from './graph';
import { itemSpecification, specHash } from './item-spec';
import { renderPacket } from './packet';
import { evaluateStatus } from './state';
import { implementation } from './implementation';

const registry = defineShop();
const ir = analyze(registry, {
  root: resolve(import.meta.dir, '../..'),
  modules: [SHOP_MODULE],
}).ir;
const report = evaluateStatus({
  ir,
  implemented: implementation(ir, registry),
  proposals: [],
  mode: 'dynamic',
  evidence: { exitCode: 0, cases: [] },
});

test('pacotes determinísticos dos quatro tipos compartilham hash e especificação', () => {
  for (const id of [
    'entity:Product',
    'method:Product.publish',
    'usecase:publish_product',
    'operator:catalog-operator',
  ]) {
    const item = report.items.find((i) => i.id === id)!;
    const spec = itemSpecification(ir, item, []);
    const packet = renderPacket(item, spec, 'agentic.config.ts');
    expect(packet).toBe(renderPacket(item, spec, 'agentic.config.ts'));
    expect(packet).toContain(`--spec-hash ${item.specHash}`);
    expect(packet).toMatchSnapshot(id);
  }
});

test('hash exclui localização e mudanças independentes, inclui contratos e regras referenciados', () => {
  const item = workItems(ir).find((i) => i.id === 'usecase:publish_product')!;
  const hash = specHash(itemSpecification(ir, item, []));
  const moved = JSON.parse(
    JSON.stringify(ir).replaceAll(
      'src/compiler/__fixtures__/shop.ts:',
      'outro.ts:',
    ),
  );
  expect(specHash(itemSpecification(moved, item, []))).toBe(hash);
  const independent = structuredClone(ir);
  independent.useCases[0] = {
    ...independent.useCases[0]!,
    description: 'Outra descrição',
  };
  expect(specHash(itemSpecification(independent, item, []))).toBe(hash);
  const changed = structuredClone(ir);
  changed.entities[0] = {
    ...changed.entities[0]!,
    invariants: changed.entities[0]!.invariants.map((i) => ({
      ...i,
      text: 'Nova regra',
    })),
  };
  expect(specHash(itemSpecification(changed, item, []))).not.toBe(hash);
});

test('source é dado de schema: preserva propriedade, enum e hash do contrato', () => {
  const changed = structuredClone(ir);
  const useCase = changed.useCases.find(
    (u) => u.id === 'usecase:publish_product',
  )!;
  changed.useCases[changed.useCases.indexOf(useCase)] = {
    ...useCase,
    inputSchema: {
      type: 'object',
      properties: { source: { type: 'string', enum: ['api'] } },
      required: ['source'],
    },
  };
  const item = workItems(changed).find((i) => i.id === useCase.id)!;
  const spec = itemSpecification(changed, item, []);
  expect((spec.declaration as typeof useCase).inputSchema).toEqual(
    changed.useCases[1]!.inputSchema,
  );
  const hash = specHash(spec);
  changed.useCases[1] = {
    ...changed.useCases[1]!,
    inputSchema: {
      type: 'object',
      properties: { source: { type: 'string', enum: ['import'] } },
      required: ['source'],
    },
  };
  expect(specHash(itemSpecification(changed, item, []))).not.toBe(hash);
});

test('spec de item enriquecido não duplica critérios e preserva o hash publicado', () => {
  const proposal = {
    id: '0009',
    archived: false,
    acceptance: [
      {
        id: 'novo',
        covers: ['method:Product.publish'],
        given: 'produto',
        when: 'publicar',
        // eslint-disable-next-line unicorn/no-thenable
        then: 'publicado',
        manual: false,
      },
    ],
  } as import('./changes/proposal').Proposal;
  const state = evaluateStatus({
    ir,
    implemented: implementation(ir, registry),
    proposals: [proposal],
    mode: 'dynamic',
    evidence: { exitCode: 0, cases: [] },
  });
  const item = state.items.find((i) => i.id === 'method:Product.publish')!;
  const spec = itemSpecification(ir, item, [proposal]);
  expect(
    spec.obligations.filter((id) => id === 'criterion:0009/novo'),
  ).toHaveLength(1);
  expect(specHash(spec)).toBe(item.specHash);
});
