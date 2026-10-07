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

  test('campo aninhado removido no input → breaking', () => {
    const before = clone();
    const input = useCase(before, 'create_product').inputSchema;
    input.properties.metadata = {
      type: 'object',
      properties: { sku: { type: 'string' } },
    };
    input.required = ['product_id', 'price', 'metadata'];

    const after = clone();
    const inputAfter = useCase(after, 'create_product').inputSchema;
    inputAfter.properties.metadata = { type: 'object', properties: {} };
    inputAfter.required = ['product_id', 'price', 'metadata'];

    expect(
      semanticDiff(before, after).find(
        (i) => i.id === 'usecase:create_product',
      )!.classification,
    ).toBe('breaking');
  });

  test('items de array muda de tipo no input → breaking', () => {
    const before = clone();
    const input = useCase(before, 'create_product').inputSchema;
    input.properties.tags = { type: 'array', items: { type: 'string' } };

    const after = clone();
    const inputAfter = useCase(after, 'create_product').inputSchema;
    inputAfter.properties.tags = { type: 'array', items: { type: 'number' } };

    expect(
      semanticDiff(before, after).find(
        (i) => i.id === 'usecase:create_product',
      )!.classification,
    ).toBe('breaking');
  });

  test('enum no input: valor removido → breaking; valor adicionado → behavioral', () => {
    const before = clone();
    const input = useCase(before, 'publish_product').inputSchema;
    input.properties.priority = { enum: ['low', 'medium', 'high'] };

    const afterRemoved = clone();
    useCase(afterRemoved, 'publish_product').inputSchema.properties.priority = {
      enum: ['low', 'medium'],
    };
    expect(
      semanticDiff(before, afterRemoved).find(
        (i) => i.id === 'usecase:publish_product',
      )!.classification,
    ).toBe('breaking');

    const afterAdded = clone();
    useCase(afterAdded, 'publish_product').inputSchema.properties.priority = {
      enum: ['low', 'medium', 'high', 'urgent'],
    };
    expect(
      semanticDiff(before, afterAdded).find(
        (i) => i.id === 'usecase:publish_product',
      )!.classification,
    ).toBe('behavioral');
  });

  test('enum no output: valor adicionado → breaking', () => {
    const before = clone();
    const output = useCase(before, 'create_product').outputSchema;
    output.properties.result = { enum: ['success', 'pending'] };

    const after = clone();
    useCase(after, 'create_product').outputSchema.properties.result = {
      enum: ['success', 'pending', 'failed'],
    };

    expect(
      semanticDiff(before, after).find(
        (i) => i.id === 'usecase:create_product',
      )!.classification,
    ).toBe('breaking');
  });

  test('propriedade input chamada constructor removida → breaking', () => {
    const before = clone();
    const input = useCase(before, 'create_product').inputSchema;
    input.properties.constructor = { type: 'string' };
    input.required = ['product_id', 'price', 'constructor'];

    const after = clone();
    const inputAfter = useCase(after, 'create_product').inputSchema;
    delete inputAfter.properties.constructor;
    inputAfter.required = ['product_id', 'price'];

    expect(
      semanticDiff(before, after).find(
        (i) => i.id === 'usecase:create_product',
      )!.classification,
    ).toBe('breaking');
  });

  test('description muda + campo input opcional novo → behavioral (não docs)', () => {
    const ir = clone();
    useCase(ir, 'create_product').description = 'Nova descrição.';
    useCase(ir, 'create_product').inputSchema.properties.note = {
      type: 'string',
    };
    expect(semanticDiff(base, ir)[0]!.classification).toBe('behavioral');
  });

  test('enum removido de propriedade do input → behavioral', () => {
    const before = clone();
    const input = useCase(before, 'publish_product').inputSchema;
    input.properties.priority = {
      type: 'string',
      enum: ['low', 'medium', 'high'],
    };

    const after = clone();
    useCase(after, 'publish_product').inputSchema.properties.priority = {
      type: 'string',
    };

    expect(
      semanticDiff(before, after).find(
        (i) => i.id === 'usecase:publish_product',
      )!.classification,
    ).toBe('behavioral');
  });

  test('enum adicionado a propriedade do output → behavioral', () => {
    const before = clone();
    const output = useCase(before, 'create_product').outputSchema;
    output.properties.result = { type: 'string' };

    const after = clone();
    useCase(after, 'create_product').outputSchema.properties.result = {
      type: 'string',
      enum: ['success', 'pending'],
    };

    expect(
      semanticDiff(before, after).find(
        (i) => i.id === 'usecase:create_product',
      )!.classification,
    ).toBe('behavioral');
  });

  test('enum adicionado a propriedade do input → breaking', () => {
    const before = clone();
    const input = useCase(before, 'publish_product').inputSchema;
    input.properties.priority = { type: 'string' };

    const after = clone();
    useCase(after, 'publish_product').inputSchema.properties.priority = {
      type: 'string',
      enum: ['low', 'medium', 'high'],
    };

    expect(
      semanticDiff(before, after).find(
        (i) => i.id === 'usecase:publish_product',
      )!.classification,
    ).toBe('breaking');
  });

  test('enum removido de propriedade do output → breaking', () => {
    const before = clone();
    const output = useCase(before, 'create_product').outputSchema;
    output.properties.result = {
      type: 'string',
      enum: ['success', 'pending'],
    };

    const after = clone();
    useCase(after, 'create_product').outputSchema.properties.result = {
      type: 'string',
    };

    expect(
      semanticDiff(before, after).find(
        (i) => i.id === 'usecase:create_product',
      )!.classification,
    ).toBe('breaking');
  });

  test('array de objetos no input cujo item ganha campo opcional → behavioral', () => {
    const before = clone();
    const input = useCase(before, 'create_product').inputSchema;
    input.properties.tags = {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' } } },
    };

    const after = clone();
    const inputAfter = useCase(after, 'create_product').inputSchema;
    inputAfter.properties.tags = {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, value: { type: 'string' } },
      },
    };

    expect(
      semanticDiff(before, after).find(
        (i) => i.id === 'usecase:create_product',
      )!.classification,
    ).toBe('behavioral');
  });

  test('input array item perde campo → breaking', () => {
    const before = clone();
    const input = useCase(before, 'create_product').inputSchema;
    input.properties.items = {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
      },
    };

    const after = clone();
    const inputAfter = useCase(after, 'create_product').inputSchema;
    inputAfter.properties.items = {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
    };

    expect(
      semanticDiff(before, after).find(
        (i) => i.id === 'usecase:create_product',
      )!.classification,
    ).toBe('breaking');
  });

  test('output array item perde campo → breaking', () => {
    const before = clone();
    const output = useCase(before, 'create_product').outputSchema;
    output.properties.items = {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
      },
    };

    const after = clone();
    const outputAfter = useCase(after, 'create_product').outputSchema;
    outputAfter.properties.items = {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
    };

    expect(
      semanticDiff(before, after).find(
        (i) => i.id === 'usecase:create_product',
      )!.classification,
    ).toBe('breaking');
  });

  test('input array item ganha required em campo existente → breaking', () => {
    const before = clone();
    const input = useCase(before, 'create_product').inputSchema;
    input.properties.items = {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
      },
    };

    const after = clone();
    const inputAfter = useCase(after, 'create_product').inputSchema;
    inputAfter.properties.items = {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
        required: ['id', 'name'],
      },
    };

    expect(
      semanticDiff(before, after).find(
        (i) => i.id === 'usecase:create_product',
      )!.classification,
    ).toBe('breaking');
  });

  test('input type string with enum → number → breaking', () => {
    const before = clone();
    const input = useCase(before, 'publish_product').inputSchema;
    input.properties.priority = {
      type: 'string',
      enum: ['low', 'medium', 'high'],
    };

    const after = clone();
    useCase(after, 'publish_product').inputSchema.properties.priority = {
      type: 'number',
    };

    expect(
      semanticDiff(before, after).find(
        (i) => i.id === 'usecase:publish_product',
      )!.classification,
    ).toBe('breaking');
  });

  test('output type string → number with enum → breaking', () => {
    const before = clone();
    const output = useCase(before, 'create_product').outputSchema;
    output.properties.code = { type: 'string' };

    const after = clone();
    useCase(after, 'create_product').outputSchema.properties.code = {
      type: 'number',
      enum: [1, 2, 3],
    };

    expect(
      semanticDiff(before, after).find(
        (i) => i.id === 'usecase:create_product',
      )!.classification,
    ).toBe('breaking');
  });

  describe('transição de método', () => {
    const publishOf = (ir: any): any =>
      ir.entities[0].methods.find((m: any) => m.name === 'publish');
    const classify = (after: IR, source: IR = base): string | undefined =>
      semanticDiff(source, after).find((i) => i.id === 'method:Product.publish')
        ?.classification;

    test('remover um estado do from → breaking', () => {
      const before = clone();
      publishOf(before).transition.from = ['draft', 'published'];
      const after = clone();
      publishOf(after).transition.from = ['draft'];
      expect(classify(after, before)).toBe('breaking');
    });

    test('trocar o from por outro estado → breaking', () => {
      const after = clone();
      publishOf(after).transition.from = ['published'];
      expect(classify(after)).toBe('breaking');
    });

    test('mudar o to → breaking', () => {
      const after = clone();
      publishOf(after).transition.to = 'draft';
      expect(classify(after)).toBe('breaking');
    });

    test('acrescentar um estado ao from → behavioral', () => {
      const after = clone();
      publishOf(after).transition.from = ['draft', 'published'];
      expect(classify(after)).toBe('behavioral');
    });
  });

  describe('obrigatoriedade de campo', () => {
    const classify = (before: IR, after: IR): string | undefined =>
      semanticDiff(before, after).find((i) => i.id === 'usecase:create_product')
        ?.classification;

    test('output com required → sem required → breaking', () => {
      const before = clone();
      useCase(before, 'create_product').outputSchema.required = ['product_id'];
      const after = clone();
      delete useCase(after, 'create_product').outputSchema.required;
      expect(classify(before, after)).toBe('breaking');
    });

    test('output: campo sai do required e continua em properties → breaking', () => {
      const after = clone();
      useCase(after, 'create_product').outputSchema.required = ['product_id'];
      expect(classify(base, after)).toBe('breaking');
    });

    test('output: campo de objeto aninhado deixa de ser obrigatório → breaking', () => {
      const nested = (required: string[]): any => ({
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
        required,
      });
      const before = clone();
      useCase(before, 'create_product').outputSchema.properties.owner = nested([
        'id',
        'name',
      ]);
      const after = clone();
      useCase(after, 'create_product').outputSchema.properties.owner = nested([
        'id',
      ]);
      expect(classify(before, after)).toBe('breaking');
    });

    test('output: campo de item de array deixa de ser obrigatório → breaking', () => {
      const list = (required: string[]): any => ({
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required,
        },
      });
      const before = clone();
      useCase(before, 'create_product').outputSchema.properties.list = list([
        'id',
      ]);
      const after = clone();
      useCase(after, 'create_product').outputSchema.properties.list = list([]);
      expect(classify(before, after)).toBe('breaking');
    });

    test('output: campo passa a ser obrigatório → behavioral', () => {
      const before = clone();
      useCase(before, 'create_product').outputSchema.required = ['product_id'];
      expect(classify(before, base)).toBe('behavioral');
    });

    test('input: campo que deixa de ser obrigatório → behavioral', () => {
      const after = clone();
      useCase(after, 'create_product').inputSchema.required = ['product_id'];
      expect(classify(base, after)).toBe('behavioral');
    });
  });
});
