import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop.js';
import { analyze } from './analyze.js';
import { workItems } from './graph.js';

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
});
