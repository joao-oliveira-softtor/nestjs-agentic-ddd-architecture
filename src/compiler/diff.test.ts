import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop';
import { analyze } from './analyze';
import { EMPTY_IR, contentHash, elementsOf, semanticDiff } from './diff';
import type { IR } from './ir';

const ROOT = resolve(import.meta.dir, '../..');
const base = analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] }).ir;
const clone = (): any => JSON.parse(JSON.stringify(base));
const useCase = (ir: any, name: string): any =>
  ir.useCases.find((u: any) => u.name === name);

describe('semanticDiff', () => {
  test('IR igual não tem diferenças', () => {
    expect(semanticDiff(base, clone() as IR)).toEqual([]);
  });

  test('da IR vazia, tudo é added e behavioral, ordenado por id', () => {
    const diff = semanticDiff(EMPTY_IR, base);
    expect(diff.map((i) => i.id)).toEqual([
      'entity:Product',
      'event:ProductCreated',
      'event:ProductPublished',
      'invariant:Product/preco-positivo',
      'invariant:Product/publicacao-exige-estoque',
      'method:Product.create',
      'method:Product.publish',
      'operator:catalog-operator',
      'usecase:create_product',
      'usecase:publish_product',
    ]);
    expect(
      new Set(diff.map((i) => `${i.kind}/${i.classification}/${i.module}`)),
    ).toEqual(new Set(['added/behavioral/shop']));
  });

  test('mudar só a fonte (arquivo:linha) não é diferença', () => {
    const ir = clone();
    ir.entities[0].source = 'outro.ts:1';
    ir.entities[0].methods[0].source = 'outro.ts:2';
    expect(semanticDiff(base, ir)).toEqual([]);
    expect(contentHash(elementsOf(base).get('entity:Product')!)).toBe(
      contentHash(elementsOf(ir).get('entity:Product')!),
    );
  });

  test('texto de invariante muda → modified behavioral, sem marcar a entidade', () => {
    const ir = clone();
    ir.entities[0].invariants[0].text = 'Preço sempre acima de um real.';
    expect(semanticDiff(base, ir)).toEqual([
      {
        id: 'invariant:Product/preco-positivo',
        kind: 'modified',
        classification: 'behavioral',
        module: 'shop',
      },
    ]);
  });

  test('invariante nova não modifica a entidade nem o método', () => {
    const ir = clone();
    ir.entities[0].invariants.push({
      id: 'invariant:Product/nova',
      text: 'Nova regra.',
      on: null,
      source: 'x.ts:1',
    });
    expect(semanticDiff(base, ir)).toEqual([
      {
        id: 'invariant:Product/nova',
        kind: 'added',
        classification: 'behavioral',
        module: 'shop',
      },
    ]);
  });

  test('só description/whenToUse mudam → docs', () => {
    const ir = clone();
    useCase(ir, 'publish_product').description = 'Outra descrição.';
    useCase(ir, 'publish_product').whenToUse = 'Outro quando.';
    expect(semanticDiff(base, ir)).toEqual([
      {
        id: 'usecase:publish_product',
        kind: 'modified',
        classification: 'docs',
        module: 'shop',
      },
    ]);
  });

  test('input ganha campo obrigatório → breaking; campo opcional → behavioral', () => {
    const required = clone();
    const input = useCase(required, 'publish_product').inputSchema;
    input.properties.reason = { type: 'string' };
    input.required = [...input.required, 'reason'];
    expect(semanticDiff(base, required)[0]!.classification).toBe('breaking');

    const optional = clone();
    useCase(optional, 'publish_product').inputSchema.properties.note = {
      type: 'string',
    };
    expect(semanticDiff(base, optional)[0]!.classification).toBe('behavioral');
  });

  test('input perde campo ou muda tipo → breaking; output perde campo → breaking', () => {
    const removed = clone();
    delete useCase(removed, 'create_product').inputSchema.properties.price;
    expect(semanticDiff(base, removed)[0]!.classification).toBe('breaking');

    const retyped = clone();
    useCase(retyped, 'create_product').inputSchema.properties.price = {
      type: 'string',
    };
    expect(semanticDiff(base, retyped)[0]!.classification).toBe('breaking');

    const output = clone();
    delete useCase(output, 'create_product').outputSchema.properties.status;
    expect(semanticDiff(base, output)[0]!.classification).toBe('breaking');
  });

  test('use-case removido → breaking; uses alterado → behavioral', () => {
    const removed = clone();
    removed.useCases = removed.useCases.filter(
      (u: any) => u.name !== 'create_product',
    );
    removed.operators[0].useCases = ['usecase:publish_product'];
    const diff = semanticDiff(base, removed);
    expect(diff.find((i) => i.id === 'usecase:create_product')).toEqual({
      id: 'usecase:create_product',
      kind: 'removed',
      classification: 'breaking',
      module: 'shop',
    });
    expect(
      diff.find((i) => i.id === 'operator:catalog-operator')!.classification,
    ).toBe('behavioral');

    const uses = clone();
    useCase(uses, 'publish_product').uses = ['method:Product.create'];
    expect(semanticDiff(base, uses)[0]!.classification).toBe('behavioral');
  });

  test('método perde a transição → breaking; emits muda → behavioral', () => {
    const noTransition = clone();
    noTransition.entities[0].methods[1].transition = null;
    expect(semanticDiff(base, noTransition)[0]).toEqual({
      id: 'method:Product.publish',
      kind: 'modified',
      classification: 'breaking',
      module: 'shop',
    });

    const emits = clone();
    emits.entities[0].methods[1].emits = [];
    expect(semanticDiff(base, emits)[0]!.classification).toBe('behavioral');
  });

  test('método com transição removido → breaking', () => {
    const ir = clone();
    ir.entities[0].methods = ir.entities[0].methods.filter(
      (m: any) => m.name !== 'publish',
    );
    ir.entities[0].invariants = ir.entities[0].invariants.filter(
      (i: any) => i.on === null,
    );
    expect(
      semanticDiff(base, ir).find((i) => i.id === 'method:Product.publish')!
        .classification,
    ).toBe('breaking');
  });
});
