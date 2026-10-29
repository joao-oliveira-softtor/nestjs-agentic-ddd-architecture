import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { defineShop, SHOP_MODULE } from './__fixtures__/shop';
import { analyze } from './analyze';
import { workItems } from './graph';
import { itemSpecification, specHash } from './item-spec';
import { renderPacket } from './packet';
import { evaluateStatus } from './state';
import { implementation } from './implementation';
import { ValueObject } from '@agentic-ddd/core';
import {
  AgentValueObject,
  Invariant,
  createRegistry,
  withRegistry,
} from '@agentic-ddd/decorators';

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

test('static mode labels the state, never promises done and keeps the rest of the packet', () => {
  const item = report.items.find((i) => i.id === 'method:Product.publish')!;
  const spec = itemSpecification(ir, item, []);
  const dynamic = renderPacket(item, spec, 'agentic.config.ts');
  const staticPacket = renderPacket(item, spec, 'agentic.config.ts', 'static');
  expect(staticPacket).toContain(
    `State: ${item.baseState} (static: tests not run; never certifies done)`,
  );
  expect(staticPacket).not.toContain('State: blocked');
  const strip = (text: string) =>
    text.split('\n').filter((l) => !l.startsWith('- State:'));
  expect(strip(staticPacket)).toEqual(strip(dynamic));
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

const VO_MODULE = { name: 'vo', path: 'src/compiler' } as const;
const voOptions = {
  root: resolve(import.meta.dir, '../..'),
  modules: [VO_MODULE],
};
const defineVo = () => {
  const registry = createRegistry();
  withRegistry(registry, () => {
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
  });
  return registry;
};

test('pacote de value object traz declaração e obrigações', () => {
  const vos = defineVo();
  const voIr = analyze(vos, voOptions).ir;
  const voReport = evaluateStatus({
    ir: voIr,
    implemented: implementation(voIr, vos),
    proposals: [],
    mode: 'dynamic',
    evidence: { exitCode: 0, cases: [] },
  });
  const item = voReport.items.find((i) => i.id === 'valueobject:Dinheiro')!;
  const packet = renderPacket(
    item,
    itemSpecification(voIr, item, []),
    'agentic.config.ts',
  );
  expect(packet).toContain('invariant:Dinheiro/nao-negativo');
  expect(packet).toMatchSnapshot('valueobject:Dinheiro');
});

test('contains e references chegam ao packet da dona, do método e do use-case que o usa', () => {
  const related: typeof ir = {
    ...ir,
    valueObjects: [
      {
        id: 'valueobject:Dinheiro',
        name: 'Dinheiro',
        module: 'shop',
        description: 'Valor monetário.',
        invariants: [],
        source: 'src/compiler/__fixtures__/shop.ts:1',
      },
    ],
    entities: [
      ...ir.entities.map((e) =>
        e.id === 'entity:Product'
          ? {
              ...e,
              contains: ['valueobject:Dinheiro'],
              references: ['entity:Cliente'],
            }
          : e,
      ),
      {
        id: 'entity:Cliente',
        name: 'Cliente',
        module: 'shop',
        description: 'Cliente que faz o pedido.',
        states: [],
        invariants: [],
        methods: [],
        source: 'src/compiler/__fixtures__/shop.ts:2',
      },
    ],
  };
  const relatedReport = evaluateStatus({
    ir: related,
    implemented: implementation(ir, registry),
    proposals: [],
    mode: 'dynamic',
    evidence: { exitCode: 0, cases: [] },
  });
  const itemOf = (id: string) => relatedReport.items.find((i) => i.id === id)!;
  const contractIds = (id: string) =>
    (
      itemSpecification(related, itemOf(id), []).contracts as { id: string }[]
    ).map((c) => c.id);
  expect(contractIds('entity:Product')).toEqual([
    'entity:Cliente',
    'event:ProductCreated',
    'valueobject:Dinheiro',
  ]);
  expect(contractIds('method:Product.publish')).toEqual([
    'entity:Cliente',
    'event:ProductCreated',
    'event:ProductPublished',
    'valueobject:Dinheiro',
  ]);
  expect(contractIds('usecase:publish_product')).toEqual([
    'entity:Cliente',
    'event:ProductCreated',
    'event:ProductPublished',
    'method:Product.publish',
    'valueobject:Dinheiro',
  ]);
  expect(contractIds('entity:Cliente')).toEqual([]);
  for (const id of [
    'entity:Product',
    'method:Product.publish',
    'usecase:publish_product',
  ]) {
    const item = itemOf(id);
    const packet = renderPacket(
      item,
      itemSpecification(related, item, []),
      'agentic.config.ts',
    );
    expect(packet).toMatchSnapshot(`${id} com relações`);
  }
});

const portOf = (
  description: string,
  methods = [{ name: 'salvar', description: 'Grava.' }],
) => ({
  id: 'port:Repo',
  name: 'Repo',
  module: 'shop',
  description,
  root: 'entity:Product',
  methods,
  source: 'src/compiler/__fixtures__/shop.ts:9',
});
const withPort = (port: ReturnType<typeof portOf>): typeof ir => ({
  ...ir,
  ports: [port],
  useCases: ir.useCases.map((u) =>
    u.id === 'usecase:publish_product' ? { ...u, ports: ['port:Repo'] } : u,
  ),
});
const statusOf = (x: typeof ir, id: string) =>
  evaluateStatus({
    ir: x,
    implemented: new Map(),
    proposals: [],
    mode: 'dynamic',
    evidence: { exitCode: 0, cases: [] },
  }).items.find((i) => i.id === id)!;
const packetOf = (x: typeof ir, id: string) => {
  const item = statusOf(x, id);
  return renderPacket(
    item,
    itemSpecification(x, item, []),
    'agentic.config.ts',
  );
};

test('use-case com port traz o port com seus métodos no pacote', () => {
  const portIr = withPort(portOf('Persistência de produtos.'));
  const packet = packetOf(portIr, 'usecase:publish_product');
  expect(packet).toContain('port:Repo');
  expect(packet).toContain('Grava.');
  expect(packet).toMatchSnapshot('usecase com port');
});

test('specHash do use-case muda com a descrição do port e com a lista de métodos', () => {
  const hash = statusOf(
    withPort(portOf('Persistência.')),
    'usecase:publish_product',
  ).specHash;
  expect(
    statusOf(withPort(portOf('Outra.')), 'usecase:publish_product').specHash,
  ).not.toBe(hash);
  expect(
    statusOf(
      withPort(
        portOf('Persistência.', [
          { name: 'salvar', description: 'Grava.' },
          { name: 'apagar', description: 'Apaga.' },
        ]),
      ),
      'usecase:publish_product',
    ).specHash,
  ).not.toBe(hash);
});

test('use-case sem port mantém pacote e hash quando o projeto declara um port', () => {
  const withOnlyPort = { ...ir, ports: [portOf('Persistência.')] };
  expect(packetOf(withOnlyPort, 'usecase:publish_product')).toBe(
    packetOf(ir, 'usecase:publish_product'),
  );
  expect(statusOf(withOnlyPort, 'usecase:publish_product').specHash).toBe(
    statusOf(ir, 'usecase:publish_product').specHash,
  );
});

test('operator que usa use-case com port muda o pacote e o specHash', () => {
  const portIr = withPort(portOf('Persistência.'));
  expect(statusOf(portIr, 'operator:catalog-operator').specHash).not.toBe(
    statusOf(ir, 'operator:catalog-operator').specHash,
  );
  expect(packetOf(portIr, 'operator:catalog-operator')).not.toBe(
    packetOf(ir, 'operator:catalog-operator'),
  );
});

test('pacote de adapter traz o escopo de classe; método mantém o de corpo', () => {
  const adapterIr = {
    ...withPort(portOf('Persistência.')),
    adapters: [
      {
        id: 'adapter:MemoryRepo',
        name: 'MemoryRepo',
        module: 'shop',
        description: 'Em memória.',
        implements: 'port:Repo',
        source: 'x.ts:2',
      },
    ],
  } as typeof ir;
  const packet = packetOf(adapterIr, 'adapter:MemoryRepo');
  expect(packet).toContain("this item's class");
  expect(packet).toMatchSnapshot('adapter');
  expect(packetOf(adapterIr, 'method:Product.publish')).toContain(
    "Change only this item's body",
  );
});
