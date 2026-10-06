import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop.js';
import { analyze } from './analyze.js';
import { workItems } from './graph.js';
import type { IR } from './ir.js';

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
