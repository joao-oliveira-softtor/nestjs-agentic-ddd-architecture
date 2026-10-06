import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { z } from 'zod';
import { DomainEvent, notImplemented, type UseCase, type UseCaseContext } from '@agentic-ddd/core';
import { AgentEvent, AgentUseCase, Registry, createRegistry, withRegistry } from '@agentic-ddd/decorators';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop.js';
import { canonicalize, stableStringify } from './canonical.js';
import { buildIR, irHash } from './ir.js';

const ROOT = resolve(import.meta.dir, '../..');
const options = { root: ROOT, modules: [SHOP_MODULE] };

describe('canonical', () => {
  test('ordena chaves recursivamente e descarta undefined', () => {
    expect(JSON.stringify(canonicalize({ b: 1, a: { d: undefined, c: [{ z: 1, y: 2 }] } }))).toBe(
      '{"a":{"c":[{"y":2,"z":1}]},"b":1}',
    );
    expect(stableStringify({ b: 1, a: 2 })).toBe('{\n  "a": 2,\n  "b": 1\n}\n');
  });
});

describe('buildIR', () => {
  test('converte o shop sem erros', () => {
    const { ir, errors } = buildIR(defineShop(), options);
    expect(errors).toEqual([]);
    expect(ir.irVersion).toBe(1);
    expect(ir.entities.map((e) => e.id)).toEqual(['entity:Product']);
    expect(ir.events.map((e) => e.id)).toEqual(['event:ProductCreated', 'event:ProductPublished']);
    expect(ir.useCases.map((u) => u.id)).toEqual(['usecase:create_product', 'usecase:publish_product']);
    expect(ir.operators[0]!.useCases).toEqual(['usecase:create_product', 'usecase:publish_product']);
    expect(ir.operators[0]!.requiresApproval).toEqual(['usecase:publish_product']);
  });

  test('distingue invariantes de classe e de método e ordena por id', () => {
    const product = buildIR(defineShop(), options).ir.entities[0]!;
    expect(product.invariants.map((i) => [i.id, i.on])).toEqual([
      ['invariant:Product/preco-positivo', null],
      ['invariant:Product/publicacao-exige-estoque', 'method:Product.publish'],
    ]);
    expect(product.methods.map((m) => [m.id, m.static])).toEqual([
      ['method:Product.create', true],
      ['method:Product.publish', false],
    ]);
    expect(product.methods[1]!.emits).toEqual(['event:ProductPublished']);
  });

  test('usa fonte relativa POSIX com linha e o módulo configurado', () => {
    const product = buildIR(defineShop(), options).ir.entities[0]!;
    expect(product.source).toMatch(/^src\/compiler\/__fixtures__\/shop\.ts:\d+$/);
    expect(product.module).toBe('shop');
  });

  test('gera JSON Schema sem a chave $schema', () => {
    const publish = buildIR(defineShop(), options).ir.useCases.find((u) => u.name === 'publish_product')!;
    expect(publish.inputSchema.$schema).toBeUndefined();
    expect(publish.inputSchema.required).toEqual(['product_id']);
  });

  test('IR estável (snapshot)', () => {
    expect(stableStringify(buildIR(defineShop(), options).ir)).toMatchSnapshot();
  });

  test('não depende da ordem de registro', () => {
    const original = defineShop();
    const shuffled = new Registry();
    for (const key of ['entities', 'invariants', 'methods', 'events', 'useCases', 'operators'] as const) {
      (shuffled[key] as unknown[]).push(...[...(original[key] as unknown[])].reverse());
    }
    expect(stableStringify(buildIR(shuffled, options).ir)).toBe(stableStringify(buildIR(original, options).ir));
  });

  test('schema Zod não representável vira erro com arquivo:linha', () => {
    const registry = createRegistry();
    withRegistry(registry, () => {
      @AgentEvent({ description: 'Evento com data.', payload: z.object({ at: z.date() }) })
      class Dated extends DomainEvent<{ at: Date }> {}
      void Dated;
    });
    const { errors } = buildIR(registry, { root: ROOT, modules: [{ name: 'compiler', path: 'src/compiler' }] });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('não representável em JSON Schema');
    expect(errors[0]!.source).toMatch(/^src\/compiler\/ir\.test\.ts:\d+$/);
  });

  test('elemento fora dos módulos configurados vira erro', () => {
    const { errors } = buildIR(defineShop(), { root: ROOT, modules: [{ name: 'outro', path: 'examples/outro' }] });
    expect(errors.some((e) => e.message.includes('fora dos módulos'))).toBe(true);
  });

  test('inputSchema omite campos com default do required', () => {
    const registry = createRegistry();
    withRegistry(registry, () => {
      @AgentUseCase({
        name: 'test_case',
        description: 'Testa input com default.',
        whenToUse: 'Teste.',
        input: z.object({ a: z.string().default('x'), b: z.string() }),
        output: z.object({ result: z.string() }),
        uses: [],
        emits: [],
      })
      class TestCase implements UseCase<{ a: string; b: string }, { result: string }> {
        execute(_input: { a: string; b: string }, _ctx: UseCaseContext): Promise<{ result: string }> {
          return notImplemented();
        }
      }
      void TestCase;
    });
    const { ir, errors } = buildIR(registry, { root: ROOT, modules: [{ name: 'compiler', path: 'src/compiler' }] });
    expect(errors).toEqual([]);
    const useCase = ir.useCases[0]!;
    expect(useCase.inputSchema.required).toEqual(['b']);
  });

  test('inputSchema com transform não gera erro', () => {
    const registry = createRegistry();
    withRegistry(registry, () => {
      @AgentUseCase({
        name: 'transform_case',
        description: 'Testa input com transform.',
        whenToUse: 'Teste.',
        input: z.object({ text: z.string().transform((s) => s.length) }),
        output: z.object({ length: z.number() }),
        uses: [],
        emits: [],
      })
      class TransformCase implements UseCase<{ text: string }, { length: number }> {
        execute(_input: { text: string }, _ctx: UseCaseContext): Promise<{ length: number }> {
          return notImplemented();
        }
      }
      void TransformCase;
    });
    const { ir, errors } = buildIR(registry, { root: ROOT, modules: [{ name: 'compiler', path: 'src/compiler' }] });
    expect(errors).toEqual([]);
    expect(ir.useCases[0]!.inputSchema.properties).toBeDefined();
  });

  test('irHash é estável e sensível a mudanças', () => {
    const { ir } = buildIR(defineShop(), options);
    const hash1 = irHash(ir);
    const hash2 = irHash(ir);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);

    const modified = {
      ...ir,
      entities: [{ ...ir.entities[0]!, description: 'modificada' }],
    };
    const hash3 = irHash(modified as typeof ir);
    expect(hash3).not.toBe(hash1);
  });
});
