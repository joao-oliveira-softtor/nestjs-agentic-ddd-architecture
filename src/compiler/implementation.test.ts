import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { defineShop, SHOP_MODULE } from './__fixtures__/shop';
import { analyze } from './analyze';
import { implementation } from './implementation';
import { renderAll, DEFAULT_OUT } from './render';
import { contentHash, elementsOf } from './diff';

test('detecta funções individuais sem contaminar IR e gerados ao implementar corpos', () => {
  const registry = defineShop();
  const options = {
    root: resolve(import.meta.dir, '../..'),
    modules: [SHOP_MODULE],
  };
  const before = analyze(registry, options).ir;
  expect(Object.fromEntries(implementation(before, registry))).toEqual({
    'entity:Product': false,
    'method:Product.publish': false,
    'usecase:create_product': false,
    'usecase:publish_product': false,
    'operator:catalog-operator': true,
  });
  registry.methods.forEach((m, i) => {
    registry.methods[i] = { ...m, fn: function () {} };
  });
  for (const u of registry.useCases)
    Object.defineProperty(u.target.prototype, 'execute', {
      value: function () {},
    });
  const after = analyze(registry, options).ir;
  expect([...implementation(after, registry).values()]).toEqual([
    true,
    true,
    true,
    true,
    true,
  ]);
  expect(after).toEqual(before);
  expect(renderAll(after, DEFAULT_OUT)).toEqual(renderAll(before, DEFAULT_OUT));
  expect([...elementsOf(after).values()].map(contentHash)).toEqual(
    [...elementsOf(before).values()].map(contentHash),
  );
});

test('entidade sem fábrica usa obrigações; várias fábricas exigem todos os corpos', () => {
  const registry = defineShop();
  const options = {
    root: resolve(import.meta.dir, '../..'),
    modules: [SHOP_MODULE],
  };
  const factory = registry.methods.find((m) => m.isStatic)!;
  registry.methods.push({ ...factory, name: 'other', fn: function () {} });
  expect(
    implementation(analyze(registry, options).ir, registry).get(
      'entity:Product',
    ),
  ).toBe(false);
  registry.methods.splice(
    0,
    registry.methods.length,
    ...registry.methods.filter((m) => !m.isStatic),
  );
  expect(
    implementation(analyze(registry, options).ir, registry).get(
      'entity:Product',
    ),
  ).toBe(true);
});
