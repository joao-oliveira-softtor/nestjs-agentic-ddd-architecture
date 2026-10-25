import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  DomainEvent,
  ValueObject,
  notImplemented,
  type UseCase,
  type UseCaseContext,
} from '@agentic-ddd/core';
import { AggregateRoot } from '@agentic-ddd/core';
import {
  AgentAdapter,
  AgentEntity,
  AgentEvent,
  AgentPort,
  AgentUseCase,
  AgentValueObject,
  Invariant,
  Registry,
  createRegistry,
  withRegistry,
} from '@agentic-ddd/decorators';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop';
import { canonicalize, stableStringify } from './canonical';
import { buildIR, irHash } from './ir';

const ROOT = resolve(import.meta.dir, '../..');
const options = { root: ROOT, modules: [SHOP_MODULE] };

describe('canonical', () => {
  test('ordena chaves recursivamente e descarta undefined', () => {
    expect(
      JSON.stringify(
        canonicalize({ b: 1, a: { d: undefined, c: [{ z: 1, y: 2 }] } }),
      ),
    ).toBe('{"a":{"c":[{"y":2,"z":1}]},"b":1}');
    expect(stableStringify({ b: 1, a: 2 })).toBe('{\n  "a": 2,\n  "b": 1\n}\n');
  });
});

describe('buildIR', () => {
  test('converte o shop sem erros', () => {
    const { ir, errors } = buildIR(defineShop(), options);
    expect(errors).toEqual([]);
    expect(ir.irVersion).toBe(1);
    expect(ir.entities.map((e) => e.id)).toEqual(['entity:Product']);
    expect(ir.events.map((e) => e.id)).toEqual([
      'event:ProductCreated',
      'event:ProductPublished',
    ]);
    expect(ir.useCases.map((u) => u.id)).toEqual([
      'usecase:create_product',
      'usecase:publish_product',
    ]);
    expect(ir.operators[0]!.useCases).toEqual([
      'usecase:create_product',
      'usecase:publish_product',
    ]);
    expect(ir.operators[0]!.requiresApproval).toEqual([
      'usecase:publish_product',
    ]);
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
    expect(product.source).toMatch(
      /^src\/compiler\/__fixtures__\/shop\.ts:\d+$/,
    );
    expect(product.module).toBe('shop');
  });

  test('gera JSON Schema sem a chave $schema', () => {
    const publish = buildIR(defineShop(), options).ir.useCases.find(
      (u) => u.name === 'publish_product',
    )!;
    expect(publish.inputSchema.$schema).toBeUndefined();
    expect(publish.inputSchema.required).toEqual(['product_id']);
  });

  test('IR estável (snapshot)', () => {
    expect(
      stableStringify(buildIR(defineShop(), options).ir),
    ).toMatchSnapshot();
  });

  test('não depende da ordem de registro', () => {
    const original = defineShop();
    const shuffled = new Registry();
    for (const key of [
      'entities',
      'invariants',
      'methods',
      'events',
      'useCases',
      'operators',
    ] as const) {
      (shuffled[key] as unknown[]).push(
        ...[...(original[key] as unknown[])].reverse(),
      );
    }
    expect(stableStringify(buildIR(shuffled, options).ir)).toBe(
      stableStringify(buildIR(original, options).ir),
    );
  });

  test('schema Zod não representável vira erro com arquivo:linha', () => {
    const registry = createRegistry();
    withRegistry(registry, () => {
      @AgentEvent({
        description: 'Evento com data.',
        payload: z.object({ at: z.date() }),
      })
      class Dated extends DomainEvent<{ at: Date }> {}
      void Dated;
    });
    const { errors } = buildIR(registry, {
      root: ROOT,
      modules: [{ name: 'compiler', path: 'src/compiler' }],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('não representável em JSON Schema');
    expect(errors[0]!.source).toMatch(/^src\/compiler\/ir\.test\.ts:\d+$/);
  });

  test('elemento fora dos módulos configurados vira erro', () => {
    const { errors } = buildIR(defineShop(), {
      root: ROOT,
      modules: [{ name: 'outro', path: 'examples/outro' }],
    });
    expect(errors.some((e) => e.message.includes('fora dos módulos'))).toBe(
      true,
    );
  });

  test('invariantes de use-case: id, on null, ordem e chave ausente sem elas', () => {
    const registry = createRegistry();
    withRegistry(registry, () => {
      const base = {
        description: 'Caso.',
        whenToUse: 'Teste.',
        input: z.object({}),
        output: z.object({}),
        uses: [],
        emits: [],
      };
      @AgentUseCase({ ...base, name: 'matricular_aluno' })
      @Invariant({ id: 'zeta', text: 'Z.' })
      @Invariant({ id: 'aluno-ativo', text: 'Aluno ativo.' })
      class Matricular {
        execute(): Promise<object> {
          return notImplemented();
        }
      }
      @AgentUseCase({ ...base, name: 'sem_regra' })
      class SemRegra {
        execute(): Promise<object> {
          return notImplemented();
        }
      }
      void Matricular;
      void SemRegra;
    });
    const { ir, errors } = buildIR(registry, {
      root: ROOT,
      modules: [{ name: 'compiler', path: 'src/compiler' }],
    });
    expect(errors).toEqual([]);
    const withInv = ir.useCases.find((u) => u.name === 'matricular_aluno')!;
    expect(withInv.invariants!.map((i) => i.id)).toEqual([
      'invariant:matricular_aluno/aluno-ativo',
      'invariant:matricular_aluno/zeta',
    ]);
    expect(withInv.invariants![0]).toMatchObject({
      text: 'Aluno ativo.',
      on: null,
    });
    const without = ir.useCases.find((u) => u.name === 'sem_regra')!;
    expect('invariants' in without).toBe(false);
  });

  test('value objects entram na IR ordenados, com invariantes; sem VO a chave não existe', () => {
    const modules = [{ name: 'compiler', path: 'src/compiler' }];
    const registry = createRegistry();
    withRegistry(registry, () => {
      @AgentValueObject({ description: 'Zeta.' })
      class Zeta extends ValueObject<{ v: number }> {}
      @AgentValueObject({ description: 'Dinheiro.' })
      @Invariant({ id: 'zz', text: 'Z.' })
      @Invariant({ id: 'nao-negativo', text: 'Não negativo.' })
      class Dinheiro extends ValueObject<{ v: number }> {}
      void Zeta;
      void Dinheiro;
    });
    const { ir, errors } = buildIR(registry, { root: ROOT, modules });
    expect(errors).toEqual([]);
    expect(ir.valueObjects!.map((v) => v.id)).toEqual([
      'valueobject:Dinheiro',
      'valueobject:Zeta',
    ]);
    expect(ir.valueObjects![0]).toMatchObject({
      name: 'Dinheiro',
      module: 'compiler',
      description: 'Dinheiro.',
    });
    expect(ir.valueObjects![0]!.invariants.map((i) => [i.id, i.on])).toEqual([
      ['invariant:Dinheiro/nao-negativo', null],
      ['invariant:Dinheiro/zz', null],
    ]);
    expect(ir.valueObjects![1]!.invariants).toEqual([]);
    expect(
      'valueObjects' in buildIR(createRegistry(), { root: ROOT, modules }).ir,
    ).toBe(false);
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
      class TestCase implements UseCase<
        { a: string; b: string },
        { result: string }
      > {
        execute(
          _input: { a: string; b: string },
          _ctx: UseCaseContext,
        ): Promise<{ result: string }> {
          return notImplemented();
        }
      }
      void TestCase;
    });
    const { ir, errors } = buildIR(registry, {
      root: ROOT,
      modules: [{ name: 'compiler', path: 'src/compiler' }],
    });
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
      class TransformCase implements UseCase<
        { text: string },
        { length: number }
      > {
        execute(
          _input: { text: string },
          _ctx: UseCaseContext,
        ): Promise<{ length: number }> {
          return notImplemented();
        }
      }
      void TransformCase;
    });
    const { ir, errors } = buildIR(registry, {
      root: ROOT,
      modules: [{ name: 'compiler', path: 'src/compiler' }],
    });
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

describe('buildIR: contains e references', () => {
  const mods = {
    root: ROOT,
    modules: [{ name: 'compiler', path: 'src/compiler' }],
  };
  const build = (define: () => void) => {
    const registry = createRegistry();
    withRegistry(registry, define);
    return buildIR(registry, mods);
  };

  test('resolve ids ordenados e sem repetição; sem relação não há chave', () => {
    const { ir, errors } = build(() => {
      @AgentValueObject({ description: 'Dinheiro.' })
      class Dinheiro extends ValueObject<{ c: number }> {}
      @AgentEntity({ description: 'Item.' })
      class Item extends AggregateRoot<string> {}
      @AgentEntity({ description: 'Outra.' })
      class Outra extends AggregateRoot<string> {}
      @AgentEntity({
        description: 'Pedido.',
        contains: () => [Item, Dinheiro, Item],
        references: () => [Outra],
      })
      class Pedido extends AggregateRoot<string> {}
      void Dinheiro;
      void Pedido;
    });
    expect(errors).toEqual([]);
    const byName = (n: string) => ir.entities.find((e) => e.name === n)!;
    expect(byName('Pedido').contains).toEqual([
      'entity:Item',
      'valueobject:Dinheiro',
    ]);
    expect(byName('Pedido').references).toEqual(['entity:Outra']);
    expect('contains' in byName('Item')).toBe(false);
    expect('references' in byName('Item')).toBe(false);
  });

  const only = (define: () => void) => {
    const { ir, errors } = build(define);
    return { ir, errors: errors.map((e) => e.message) };
  };

  test('função que lança vira erro do dono', () => {
    const { errors, ir } = only(() => {
      @AgentEntity({
        description: 'A.',
        contains: () => {
          throw new Error('boom');
        },
      })
      class A extends AggregateRoot<string> {}
      void A;
    });
    expect(errors).toEqual(['entity:A: contains lançou boom']);
    expect('contains' in ir.entities[0]!).toBe(false);
  });

  test('resultado que não é lista e entrada não-classe', () => {
    const { errors, ir } = only(() => {
      @AgentEntity({
        description: 'A.',
        contains: () => undefined as never,
        references: () => [undefined as never],
      })
      class A extends AggregateRoot<string> {}
      void A;
    });
    expect(errors.sort()).toEqual([
      'entity:A: contains não devolveu uma lista',
      'entity:A: references tem entrada que não é classe',
    ]);
    expect('contains' in ir.entities[0]!).toBe(false);
    expect('references' in ir.entities[0]!).toBe(false);
  });

  test('função que lança valor não-Error usa o texto dele', () => {
    const { errors } = only(() => {
      @AgentEntity({
        description: 'A.',
        contains: () => {
          throw 'texto';
        },
      })
      class A extends AggregateRoot<string> {}
      void A;
    });
    expect(errors).toEqual(['entity:A: contains lançou texto']);
  });

  test('classe sem decorator nos dois campos', () => {
    class Solta {}
    const { errors, ir } = only(() => {
      @AgentEntity({
        description: 'A.',
        contains: () => [Solta],
        references: () => [Solta],
      })
      class A extends AggregateRoot<string> {}
      void A;
    });
    expect(errors.sort()).toEqual([
      'entity:A: contains cita Solta, sem @AgentEntity nem @AgentValueObject',
      'entity:A: references cita Solta, sem @AgentEntity nem @AgentValueObject',
    ]);
    expect('contains' in ir.entities[0]!).toBe(false);
  });
});

describe('buildIR: ports', () => {
  const mods = {
    root: ROOT,
    modules: [{ name: 'compiler', path: 'src/compiler' }],
  };
  const io = { input: z.object({}), output: z.object({}) };
  const build = (define: () => void) => {
    const registry = createRegistry();
    withRegistry(registry, define);
    return buildIR(registry, mods);
  };

  test('ids, ordem, métodos ordenados e ports do use-case', () => {
    const { ir, errors } = build(() => {
      @AgentEntity({ description: 'Conta.' })
      class Conta extends AggregateRoot<string> {}
      @AgentPort({
        description: 'Z.',
        root: () => Conta,
        methods: { salvar: 'Grava.', buscar: 'Busca.' },
      })
      abstract class ZRepo {}
      @AgentPort({ description: 'A.', root: () => Conta, methods: {} })
      abstract class ARepo {}
      @AgentUseCase({
        name: 'faz',
        description: 'Faz.',
        whenToUse: 'Sempre.',
        ...io,
        uses: [],
        emits: [],
        ports: () => [ZRepo, ARepo, ZRepo],
      })
      class Faz {}
      void Faz;
    });
    expect(errors).toEqual([]);
    expect(ir.ports!.map((p) => p.id)).toEqual(['port:ARepo', 'port:ZRepo']);
    expect(ir.ports![1]).toMatchObject({
      name: 'ZRepo',
      module: 'compiler',
      description: 'Z.',
      root: 'entity:Conta',
      methods: [
        { name: 'buscar', description: 'Busca.' },
        { name: 'salvar', description: 'Grava.' },
      ],
    });
    expect(ir.useCases[0]!.ports).toEqual(['port:ARepo', 'port:ZRepo']);
  });

  test('sem port não há chave na IR nem no use-case', () => {
    const { ir } = build(() => {
      @AgentUseCase({
        name: 'faz',
        description: 'Faz.',
        whenToUse: 'Sempre.',
        ...io,
        uses: [],
        emits: [],
      })
      class Faz {}
      void Faz;
    });
    expect('ports' in ir).toBe(false);
    expect('ports' in ir.useCases[0]!).toBe(false);
  });

  test('root que lança, não é classe ou não é entidade: erro e o port sai da IR', () => {
    class Solta {}
    const { ir, errors } = build(() => {
      @AgentPort({
        description: 'A.',
        root: () => {
          throw new Error('boom');
        },
        methods: {},
      })
      abstract class A {}
      @AgentPort({ description: 'B.', root: () => 1 as never, methods: {} })
      abstract class B {}
      @AgentPort({ description: 'C.', root: () => Solta, methods: {} })
      abstract class C {}
      @AgentUseCase({
        name: 'faz',
        description: 'Faz.',
        whenToUse: 'Sempre.',
        ...io,
        uses: [],
        emits: [],
        ports: () => [A],
      })
      class Faz {}
      void [A, B, C, Faz];
    });
    expect(errors.map((e) => e.message).sort()).toEqual([
      'port:A: root lançou boom',
      'port:B: root não devolveu uma classe',
      'port:C: root cita Solta, sem @AgentEntity',
    ]);
    expect(
      errors.every((e) => /^src\/compiler\/ir\.test\.ts:\d+$/.test(e.source!)),
    ).toBe(true);
    expect('ports' in ir).toBe(false);
    expect('ports' in ir.useCases[0]!).toBe(false);
  });

  test('use-case que cita classe sem @AgentPort ou thunk que lança: erro com source do use-case', () => {
    class Solta {}
    const { ir, errors } = build(() => {
      @AgentUseCase({
        name: 'a',
        description: 'A.',
        whenToUse: 'Sempre.',
        ...io,
        uses: [],
        emits: [],
        ports: () => [Solta],
      })
      class A {}
      @AgentUseCase({
        name: 'b',
        description: 'B.',
        whenToUse: 'Sempre.',
        ...io,
        uses: [],
        emits: [],
        ports: () => {
          throw new Error('boom');
        },
      })
      class B {}
      void [A, B];
    });
    expect(errors.map((e) => e.message).sort()).toEqual([
      'usecase:a: ports cita Solta, sem @AgentPort',
      'usecase:b: ports lançou boom',
    ]);
    expect(ir.useCases.every((u) => !('ports' in u))).toBe(true);
  });
});

describe('buildIR: adapters', () => {
  const mods = {
    root: ROOT,
    modules: [{ name: 'compiler', path: 'src/compiler' }],
  };
  const build = (define: () => void, m = mods) => {
    const registry = createRegistry();
    withRegistry(registry, define);
    return buildIR(registry, m);
  };

  test('id, módulo, implements e ordem por id', () => {
    const { ir, errors } = build(() => {
      @AgentEntity({ description: 'Conta.' })
      class Conta extends AggregateRoot<string> {}
      @AgentPort({ description: 'R.', root: () => Conta, methods: { a: 'A.' } })
      abstract class Repo {
        abstract a(): void;
      }
      @AgentPort({ description: 'S.', root: () => Conta, methods: { a: 'A.' } })
      abstract class Outro {
        abstract a(): void;
      }
      @AgentAdapter({ description: 'Z.', implements: () => Repo })
      class ZAdapter extends Repo {
        a() {}
      }
      @AgentAdapter({ description: 'A.', implements: () => Outro })
      class AAdapter extends Outro {
        a() {}
      }
      void [ZAdapter, AAdapter];
    });
    expect(errors).toEqual([]);
    expect(ir.adapters!.map((a) => a.id)).toEqual([
      'adapter:AAdapter',
      'adapter:ZAdapter',
    ]);
    expect(ir.adapters![1]).toMatchObject({
      name: 'ZAdapter',
      module: 'compiler',
      description: 'Z.',
      implements: 'port:Repo',
    });
  });

  test('sem adapter não há chave na IR', () => {
    const { ir } = build(() => {});
    expect('adapters' in ir).toBe(false);
  });

  test('implements que lança, não é classe ou sem @AgentPort: erro com source do adapter e o adapter sai', () => {
    class Solta {}
    const { ir, errors } = build(() => {
      @AgentAdapter({ description: 'A.', implements: () => Solta })
      class A {}
      @AgentAdapter({
        description: 'B.',
        implements: () => {
          throw new Error('boom');
        },
      })
      class B {}
      @AgentAdapter({
        description: 'C.',
        implements: (() => 1) as never,
      })
      class C {}
      void [A, B, C];
    });
    expect(errors.map((e) => e.message).sort()).toEqual([
      'adapter:A: implements cita Solta, sem @AgentPort',
      'adapter:B: implements lançou boom',
      'adapter:C: implements não devolveu uma classe',
    ]);
    expect(
      errors.every((e) => /^src\/compiler\/ir\.test\.ts:\d+$/.test(e.source!)),
    ).toBe(true);
    expect('adapters' in ir).toBe(false);
  });
});
