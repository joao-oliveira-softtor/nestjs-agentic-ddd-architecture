import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop';
import { analyze } from './analyze';
import { aggregateRoots, workItems } from './graph';
import type { IR } from './ir';
import { ValueObject } from '@agentic-ddd/core';
import {
  AgentValueObject,
  Invariant,
  createRegistry,
  withRegistry,
} from '@agentic-ddd/decorators';

const ROOT = resolve(import.meta.dir, '../..');
const { ir } = analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] });
const items = Object.fromEntries(workItems(ir).map((i) => [i.id, i]));

describe('workItems', () => {
  test('um item por entidade, método de instância, use-case e operator', () => {
    expect(Object.keys(items)).toEqual([
      'entity:Product',
      'method:Product.publish',
      'operator:catalog-operator',
      'usecase:create_product',
      'usecase:publish_product',
    ]);
  });

  test('a entidade é dona da fábrica estática e das invariantes de classe', () => {
    expect(items['entity:Product']!.dependsOn).toEqual([]);
    expect(items['entity:Product']!.obligations).toEqual([
      'invariant:Product/preco-positivo',
      'method:Product.create',
    ]);
  });

  test('método de instância depende da entidade e é dono das invariantes declaradas nele', () => {
    expect(items['method:Product.publish']!.dependsOn).toEqual([
      'entity:Product',
    ]);
    expect(items['method:Product.publish']!.obligations).toEqual([
      'invariant:Product/publicacao-exige-estoque',
      'method:Product.publish',
    ]);
  });

  test('use-case depende do item de cada método em uses (fábrica resolve para a entidade)', () => {
    expect(items['usecase:create_product']!.dependsOn).toEqual([
      'entity:Product',
    ]);
    expect(items['usecase:publish_product']!.dependsOn).toEqual([
      'method:Product.publish',
    ]);
  });

  test('operator depende da allowlist', () => {
    expect(items['operator:catalog-operator']!.dependsOn).toEqual([
      'usecase:create_product',
      'usecase:publish_product',
    ]);
    expect(items['operator:catalog-operator']!.layer).toBe('operators');
  });

  test('regressão: fábricas estáticas são obrigações da entidade, métodos resolvem para entidade ou método', () => {
    const minimalIR: IR = {
      irVersion: 1,
      modules: [{ name: 'm', path: 'src/m' }],
      entities: [
        {
          id: 'entity:A',
          name: 'A',
          module: 'm',
          description: 'Entity A',
          states: [],
          invariants: [
            {
              id: 'invariant:A/cls',
              text: 'Class invariant',
              on: null,
              source: 'src/m:1',
            },
            {
              id: 'invariant:A/fab',
              text: 'Factory invariant',
              on: 'method:A.make',
              source: 'src/m:2',
            },
            {
              id: 'invariant:A/inst',
              text: 'Instance invariant',
              on: 'method:A.go',
              source: 'src/m:3',
            },
          ],
          methods: [
            {
              id: 'method:A.make',
              name: 'make',
              static: true,
              description: 'Factory',
              transition: null,
              emits: [],
              source: 'src/m:4',
            },
            {
              id: 'method:A.make2',
              name: 'make2',
              static: true,
              description: 'Factory 2',
              transition: null,
              emits: [],
              source: 'src/m:5',
            },
            {
              id: 'method:A.go',
              name: 'go',
              static: false,
              description: 'Instance',
              transition: null,
              emits: [],
              source: 'src/m:6',
            },
          ],
          source: 'src/m:1',
        },
      ],
      events: [],
      useCases: [
        {
          id: 'usecase:X',
          name: 'X',
          module: 'm',
          description: 'Use case',
          whenToUse: 'always',
          whenNotToUse: null,
          inputSchema: {},
          outputSchema: {},
          uses: ['method:A.make', 'method:A.make2', 'method:A.go'],
          emits: [],
          source: 'src/m:7',
        },
      ],
      operators: [],
    };

    const minimalItems = Object.fromEntries(
      workItems(minimalIR).map((i) => [i.id, i]),
    );

    expect(minimalItems['entity:A']!.obligations).toEqual([
      'invariant:A/cls',
      'invariant:A/fab',
      'method:A.make',
      'method:A.make2',
    ]);

    expect(minimalItems['method:A.go']!.obligations).toEqual([
      'invariant:A/inst',
      'method:A.go',
    ]);

    expect(minimalItems['usecase:X']!.dependsOn).toEqual([
      'entity:A',
      'method:A.go',
    ]);

    // Regression: all dependsOn ids must exist
    for (const item of Object.values(minimalItems)) {
      for (const dep of item.dependsOn) {
        expect(minimalItems[dep]).toBeDefined();
      }
    }
  });
});

test('use-case é dono das suas invariantes, em ordem por id', () => {
  const useCaseIR: IR = {
    irVersion: 1,
    modules: [{ name: 'm', path: 'src/m' }],
    entities: [],
    events: [],
    useCases: [
      {
        id: 'usecase:matricular_aluno',
        name: 'matricular_aluno',
        module: 'm',
        description: 'Matricula aluno',
        whenToUse: 'sempre',
        whenNotToUse: null,
        inputSchema: {},
        outputSchema: {},
        uses: [],
        emits: [],
        invariants: [
          {
            id: 'invariant:matricular_aluno/vaga',
            text: 'Há vaga',
            on: null,
            source: 'src/m:2',
          },
          {
            id: 'invariant:matricular_aluno/aluno-ativo',
            text: 'Aluno ativo',
            on: null,
            source: 'src/m:1',
          },
        ],
        source: 'src/m:1',
      },
    ],
    operators: [],
  };
  expect(workItems(useCaseIR)[0]!.obligations).toEqual([
    'invariant:matricular_aluno/aluno-ativo',
    'invariant:matricular_aluno/vaga',
    'usecase:matricular_aluno',
  ]);
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

test('value object vira item de domínio sem dependências, dono do id e das invariantes', () => {
  const registry = defineVo();
  const { ir } = analyze(registry, voOptions);
  expect(workItems(ir)).toEqual([
    {
      id: 'valueobject:Dinheiro',
      layer: 'domain',
      module: 'vo',
      source: expect.any(String),
      dependsOn: [],
      obligations: ['invariant:Dinheiro/nao-negativo', 'valueobject:Dinheiro'],
    },
  ]);
});

const relationEntity = (
  name: string,
  relations: { contains?: string[]; references?: string[] } = {},
): IR['entities'][number] => ({
  id: `entity:${name}`,
  name,
  module: 'm',
  description: name,
  states: [],
  invariants: [],
  methods: [],
  ...relations,
  source: `src/m:${name}`,
});

const relationIR: IR = {
  irVersion: 1,
  modules: [{ name: 'm', path: 'src/m' }],
  entities: [
    relationEntity('Pedido', {
      contains: ['valueobject:Dinheiro', 'entity:ItemDoPedido'],
      references: ['entity:Cliente'],
    }),
    relationEntity('ItemDoPedido'),
    relationEntity('Cliente'),
  ],
  valueObjects: [
    {
      id: 'valueobject:Dinheiro',
      name: 'Dinheiro',
      module: 'm',
      description: 'Dinheiro',
      invariants: [],
      source: 'src/m:Dinheiro',
    },
  ],
  events: [],
  useCases: [],
  operators: [],
};

describe('relações entre entidades', () => {
  test('aggregateRoots: entidade que nenhum contains cita é raiz; a contida não é', () => {
    expect(aggregateRoots(relationIR)).toEqual(
      new Set(['entity:Cliente', 'entity:Pedido']),
    );
  });

  test('dependsOn do dono são os contidos, ordenados', () => {
    const relation = Object.fromEntries(
      workItems(relationIR).map((i) => [i.id, i]),
    );
    expect(relation['entity:Pedido']!.dependsOn).toEqual([
      'entity:ItemDoPedido',
      'valueobject:Dinheiro',
    ]);
  });

  test('references não cria aresta; entidade sem relação continua sem dependências', () => {
    const relation = Object.fromEntries(
      workItems(relationIR).map((i) => [i.id, i]),
    );
    expect(relation['entity:Pedido']!.dependsOn).not.toContain(
      'entity:Cliente',
    );
    expect(relation['entity:Cliente']!.dependsOn).toEqual([]);
    expect(relation['entity:ItemDoPedido']!.dependsOn).toEqual([]);
  });
});

describe('adapter', () => {
  const port = {
    id: 'port:Repo',
    name: 'Repo',
    module: 'shop',
    description: 'Persistência.',
    root: 'entity:Product',
    methods: [
      { name: 'salvar', description: 'Grava.' },
      { name: 'buscar', description: 'Lê.' },
    ],
    source: 'x.ts:1',
  };
  const adapter = {
    id: 'adapter:MemoryRepo',
    name: 'MemoryRepo',
    module: 'shop',
    description: 'Em memória.',
    implements: 'port:Repo',
    source: 'x.ts:2',
  };

  test('vira item em infrastructure, depende da raiz e tem uma obrigação por método', () => {
    const item = workItems({ ...ir, ports: [port], adapters: [adapter] }).find(
      (i) => i.id === adapter.id,
    );
    expect(item).toMatchObject({
      layer: 'infrastructure',
      dependsOn: ['entity:Product'],
      obligations: ['port:Repo.buscar', 'port:Repo.salvar'],
    });
  });

  test('port fora da IR: sem item', () => {
    expect(
      workItems({ ...ir, adapters: [adapter] }).some(
        (i) => i.id === adapter.id,
      ),
    ).toBe(false);
  });
});
