import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  AggregateRoot,
  DomainEvent,
  Entity,
  ValueObject,
} from '@agentic-ddd/core';
import {
  AgentAdapter,
  AgentEntity,
  AgentEvent,
  AgentMethod,
  AgentPort,
  AgentUseCase,
  AgentValueObject,
  Invariant,
  Operator,
  createRegistry,
  withRegistry,
} from '@agentic-ddd/decorators';
import {
  PORTS_MODULE,
  definePortConcreto,
  definePortDivergente,
  definePortEmpilhado,
  definePortNomeLiteral,
  definePortOk,
  definePortSobrecarga,
  definePortsHomonimos,
} from './__fixtures__/ports';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop';
import { analyze } from './analyze';
import { buildIR } from './ir';
import { relationWarnings, validate } from './validate';

const ROOT = resolve(import.meta.dir, '../..');
const HERE = /^src\/compiler\/validate\.test\.ts:\d+ /;
const io = { input: z.object({}), output: z.object({}) };

function errorsOf(define: () => void): string[] {
  const registry = createRegistry();
  withRegistry(registry, define);
  return analyze(registry, {
    root: ROOT,
    modules: [{ name: 'compiler', path: 'src/compiler' }],
  }).errors.map((e) => `${e.source ?? '-'} ${e.code} ${e.message}`);
}

describe('validate', () => {
  test('o shop é válido', () => {
    expect(
      analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] }).errors,
    ).toEqual([]);
  });

  test('id de invariante precisa ser kebab-case', () => {
    const errors = errorsOf(() => {
      @AgentEntity({ description: 'Coisa.' })
      @Invariant({ id: 'Id Ruim', text: 'Regra.' })
      class Thing extends AggregateRoot<string> {}
      void Thing;
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(HERE);
    expect(errors[0]).toContain(
      'validate.invariant-id-format invariant:Thing/Id Ruim',
    );
  });

  test('transição exige states declarados na entidade', () => {
    const errors = errorsOf(() => {
      @AgentEntity({ description: 'Porta.' })
      class Door extends AggregateRoot<string> {
        @AgentMethod({
          description: 'Abre.',
          transition: { from: ['closed'], to: 'open' },
        })
        open(): void {}
      }
      void Door;
    });
    expect(
      errors.some((e) =>
        e.includes('validate.transition-without-states entity:Door'),
      ),
    ).toBe(true);
  });

  test('transição com estado desconhecido', () => {
    const errors = errorsOf(() => {
      @AgentEntity({ description: 'Porta.', states: ['closed', 'open'] })
      class Door extends AggregateRoot<string> {
        @AgentMethod({
          description: 'Abre.',
          transition: { from: ['locked'], to: 'open' },
        })
        open(): void {}
      }
      void Door;
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      'validate.transition-state-unknown method:Door.open',
    );
  });

  test('emits precisa apontar para classe com @AgentEvent', () => {
    const errors = errorsOf(() => {
      class NotAnEvent {}
      @AgentEntity({ description: 'Sino.' })
      class Bell extends AggregateRoot<string> {
        @AgentMethod({ description: 'Toca.', emits: [NotAnEvent] })
        ring(): void {}
      }
      void Bell;
    });
    expect(
      errors.some((e) =>
        e.includes('ir.emits-target-missing emits points to NotAnEvent'),
      ),
    ).toBe(true);
  });

  test('uses precisa citar método existente', () => {
    const errors = errorsOf(() => {
      @AgentUseCase({
        name: 'do_it',
        description: 'Faz.',
        whenToUse: 'Sempre.',
        ...io,
        uses: ['method:Ghost.boo'],
      })
      class DoIt {}
      void DoIt;
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('validate.uses-unknown usecase:do_it');
  });

  test('emits do use-case precisa vir dos métodos em uses', () => {
    const errors = errorsOf(() => {
      @AgentEvent({ description: 'Tocou.', payload: z.object({}) })
      class Rang extends DomainEvent<object> {}
      @AgentEntity({ description: 'Sino.' })
      class Bell extends AggregateRoot<string> {
        @AgentMethod({ description: 'Toca.' })
        ring(): void {}
      }
      @AgentUseCase({
        name: 'ring_bell',
        description: 'Toca.',
        whenToUse: 'Sempre.',
        ...io,
        uses: ['method:Bell.ring'],
        emits: [Rang],
      })
      class RingBell {}
      void Bell;
      void RingBell;
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('validate.emit-unreachable usecase:ring_bell');
  });

  test('emits do use-case precisa cobrir o que os métodos em uses emitem', () => {
    const errors = errorsOf(() => {
      @AgentEvent({ description: 'Tocou.', payload: z.object({}) })
      class Rang extends DomainEvent<object> {}
      @AgentEntity({ description: 'Sino.' })
      class Bell extends AggregateRoot<string> {
        @AgentMethod({ description: 'Toca.', emits: [Rang] })
        ring(): void {}
      }
      @AgentUseCase({
        name: 'ring_bell',
        description: 'Toca.',
        whenToUse: 'Sempre.',
        ...io,
        uses: ['method:Bell.ring'],
      })
      class RingBell {}
      void Bell;
      void RingBell;
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(HERE);
    expect(errors[0]).toContain('validate.emit-undeclared usecase:ring_bell');
  });

  test('requiresApproval precisa estar na allowlist', () => {
    const errors = errorsOf(() => {
      @AgentUseCase({
        name: 'a_case',
        description: 'A.',
        whenToUse: 'A.',
        ...io,
        uses: [],
      })
      class ACase {}
      @AgentUseCase({
        name: 'b_case',
        description: 'B.',
        whenToUse: 'B.',
        ...io,
        uses: [],
      })
      class BCase {}
      @Operator({
        name: 'op',
        description: 'Op.',
        instructions: 'Op.',
        useCases: [ACase],
        requiresApproval: [BCase],
      })
      class Op {}
      void Op;
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      'validate.operator-approval-unknown operator:op',
    );
  });

  test('operator com classe sem @AgentUseCase', () => {
    const errors = errorsOf(() => {
      class Plain {}
      @Operator({
        name: 'op',
        description: 'Op.',
        instructions: 'Op.',
        useCases: [Plain],
      })
      class Op {}
      void Op;
    });
    expect(
      errors.some((e) => e.includes('ir.usecase-missing operator:op')),
    ).toBe(true);
  });

  test('método público sem @AgentMethod é erro; #privado e getters não', () => {
    const errors = errorsOf(() => {
      @AgentEntity({ description: 'Conta.' })
      class Account extends AggregateRoot<string> {
        get balance(): number {
          return this.#secret();
        }

        helper(): void {}

        #secret(): number {
          return 0;
        }
      }
      void Account;
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('validate.method-undecorated Account.helper');
  });

  test('duas entidades com o mesmo nome geram ID duplicado', () => {
    const errors = errorsOf(() => {
      {
        @AgentEntity({ description: 'Item A.' })
        class Item extends AggregateRoot<string> {}
        void Item;
      }
      {
        @AgentEntity({ description: 'Item B.' })
        class Item extends AggregateRoot<string> {}
        void Item;
      }
    });
    expect(
      errors.some((e) =>
        e.includes(
          'validate.duplicate-id duplicate ID entity:Item (also declared in src/compiler/validate.test.ts:',
        ),
      ),
    ).toBe(true);
  });

  test('nome de use-case precisa ser snake_case e whenToUse não pode ser vazio', () => {
    const errors = errorsOf(() => {
      @AgentUseCase({
        name: 'PublishProduct',
        description: 'Publica.',
        whenToUse: ' ',
        ...io,
        uses: [],
      })
      class PublishProduct {}
      void PublishProduct;
    });
    expect(errors.some((e) => e.includes('validate.usecase-name-format'))).toBe(
      true,
    );
    expect(
      errors.some(
        (e) => e.includes('validate.required-empty') && e.includes('whenToUse'),
      ),
    ).toBe(true);
  });

  test('@Invariant em método sem @AgentMethod', () => {
    const errors = errorsOf(() => {
      @AgentEntity({ description: 'Caixa.' })
      class Box extends AggregateRoot<string> {
        @Invariant({ id: 'nunca-cheia', text: 'Nunca cheia.' })
        fill(): void {}
      }
      void Box;
    });
    expect(
      errors.some((e) =>
        e.includes(
          'validate.invariant-method-undeclared invariant:Box/nunca-cheia',
        ),
      ),
    ).toBe(true);
  });

  test('ordenação determinística de analyze: erros misturados de buildIR e validate em ordem diferente da declaração', () => {
    const result = analyze(
      (() => {
        const registry = createRegistry();
        withRegistry(registry, () => {
          // Declarada primeiro na ordem de registro, mas referenciada depois na fonte
          @AgentEntity({ description: 'Depois.' })
          class Depois extends AggregateRoot<string> {}
          void Depois;

          // Declarada segunda, com erro de invariante inválida (validate error)
          @AgentEntity({ description: 'Antes.' })
          @Invariant({ id: 'Bad-Case', text: 'Regra.' })
          class Antes extends AggregateRoot<string> {}
          void Antes;

          // Plain class sem @AgentUseCase, referenciado em operator (buildIR error)
          class Plain {}
          @Operator({
            name: 'op',
            description: 'Op.',
            instructions: 'Op.',
            useCases: [Plain],
          })
          class Op {}
          void Op;
        });
        return registry;
      })(),
      { root: ROOT, modules: [{ name: 'compiler', path: 'src/compiler' }] },
    );

    const errorStrings = result.errors.map(
      (e) => `${e.source ?? ''}|${e.message}`,
    );
    const sorted = [...errorStrings].sort();
    expect(errorStrings).toEqual(sorted);
    expect(result.errors.some((e) => e.message.includes('Bad-Case'))).toBe(
      true,
    );
    expect(result.errors.some((e) => e.code === 'ir.usecase-missing')).toBe(
      true,
    );
  });

  test('invariante com text vazio', () => {
    const errors = errorsOf(() => {
      @AgentEntity({ description: 'Algo.' })
      @Invariant({ id: 'empty-text', text: '' })
      class Thing extends AggregateRoot<string> {}
      void Thing;
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      'validate.required-empty invariant:Thing/empty-text: text',
    );
  });

  test('transition com from vazio', () => {
    const errors = errorsOf(() => {
      @AgentEntity({ description: 'Porta.', states: ['closed', 'open'] })
      class Door extends AggregateRoot<string> {
        @AgentMethod({
          description: 'Abre.',
          transition: { from: [], to: 'open' },
        })
        open(): void {}
      }
      void Door;
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('validate.transition-incomplete');
  });

  test('transition com estado vazio em from é rejeitado', () => {
    for (const empty of ['', '  ']) {
      const errors = errorsOf(() => {
        @AgentEntity({ description: 'Porta.', states: ['closed', 'open'] })
        class Door extends AggregateRoot<string> {
          @AgentMethod({
            description: 'Abre.',
            transition: { from: [empty], to: 'open' },
          })
          open(): void {}
        }
        void Door;
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('validate.transition-empty-state');
    }
  });

  test('@Operator com useCases vazio', () => {
    const errors = errorsOf(() => {
      @Operator({
        name: 'op',
        description: 'Op.',
        instructions: 'Op.',
        useCases: [],
      })
      class Op {}
      void Op;
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('validate.operator-usecases-empty operator:op');
  });

  test('operator com name fora de kebab-case', () => {
    const errors = errorsOf(() => {
      @AgentUseCase({
        name: 'do_it',
        description: 'Faz.',
        whenToUse: 'Sempre.',
        ...io,
        uses: [],
      })
      class DoIt {}
      @Operator({
        name: 'Op Ruim',
        description: 'Op.',
        instructions: 'Op.',
        useCases: [DoIt],
      })
      class Op {}
      void Op;
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      'validate.operator-name-format operator:Op Ruim',
    );
  });

  test('operator com limits inválidos é rejeitado na compilação', () => {
    const invalid = [
      { maxSteps: 0 },
      { maxSteps: 1.5 },
      { timeoutMs: 0 },
      { timeoutMs: Number.POSITIVE_INFINITY },
    ];
    for (const limits of invalid) {
      const errors = errorsOf(() => {
        @AgentUseCase({
          name: 'do_it',
          description: 'Faz.',
          whenToUse: 'Sempre.',
          ...io,
          uses: [],
        })
        class DoIt {}
        @Operator({
          name: 'op',
          description: 'Op.',
          instructions: 'Op.',
          useCases: [DoIt],
          limits,
        })
        class Op {}
        void Op;
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(
        'validate.operator-limits-invalid operator:op',
      );
    }
  });

  test('método estático público sem @AgentMethod', () => {
    const errors = errorsOf(() => {
      @AgentEntity({ description: 'Conta.' })
      class Account extends AggregateRoot<string> {
        static helper(): void {}
      }
      void Account;
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('validate.method-undecorated Account.helper');
  });

  test('@AgentMethod numa classe sem @AgentEntity', () => {
    const errors = errorsOf(() => {
      class NotEntity {
        @AgentMethod({ description: 'Faz.' })
        doIt(): void {}
      }
      void NotEntity;
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      'validate.method-entity-missing NotEntity.doIt',
    );
  });
});

describe('validate: @Invariant em use-case', () => {
  const base = {
    description: 'Caso.',
    whenToUse: 'Teste.',
    ...io,
    uses: [],
    emits: [],
  };

  test('kebab-case, duplicado e texto vazio valem no use-case', () => {
    const errors = errorsOf(() => {
      @AgentUseCase({ ...base, name: 'caso' })
      @Invariant({ id: 'Id Ruim', text: 'Regra.' })
      @Invariant({ id: 'dup', text: 'A.' })
      @Invariant({ id: 'dup', text: 'B.' })
      @Invariant({ id: 'vazia', text: '' })
      class Caso {}
      void Caso;
    });
    expect(
      errors.some((e) =>
        e.includes('validate.invariant-id-format invariant:caso/Id Ruim'),
      ),
    ).toBe(true);
    expect(
      errors.some((e) =>
        e.includes('validate.duplicate-id duplicate ID invariant:caso/dup'),
      ),
    ).toBe(true);
    expect(
      errors.some((e) =>
        e.includes('validate.required-empty invariant:caso/vazia: text'),
      ),
    ).toBe(true);
  });

  test('invariante válida em use-case não gera erro', () => {
    expect(
      errorsOf(() => {
        @AgentUseCase({ ...base, name: 'caso' })
        @Invariant({ id: 'ok', text: 'Regra.' })
        class Caso {}
        void Caso;
      }),
    ).toEqual([]);
  });

  test('@Invariant em método de use-case é erro com source', () => {
    const errors = errorsOf(() => {
      @AgentUseCase({ ...base, name: 'caso' })
      class Caso {
        @Invariant({ id: 'regra', text: 'Regra.' })
        execute(): void {}
      }
      void Caso;
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(HERE);
    expect(errors[0]).toContain(
      'validate.invariant-method-misplaced @Invariant regra on Caso.execute',
    );
  });

  test('@Invariant em classe com @AgentEntity e @AgentUseCase é ambígua', () => {
    const errors = errorsOf(() => {
      @AgentEntity({ description: 'Coisa.' })
      @AgentUseCase({ ...base, name: 'caso' })
      @Invariant({ id: 'dupla', text: 'Regra.' })
      class Dupla extends AggregateRoot<string> {}
      void Dupla;
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(HERE);
    expect(errors[0]).toContain(
      'validate.invariant-owner-ambiguous @Invariant dupla on Dupla',
    );
  });

  test('@Invariant em classe sem decorator cita entidade e use-case', () => {
    const errors = errorsOf(() => {
      @Invariant({ id: 'solta', text: 'Regra.' })
      class Plain {}
      void Plain;
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      'validate.invariant-owner-missing @Invariant solta on Plain',
    );
  });

  describe('value object', () => {
    type P = { v: number };
    test('válido não gera erro', () => {
      expect(
        errorsOf(() => {
          @AgentValueObject({ description: 'Dinheiro.' })
          @Invariant({ id: 'ok', text: 'Regra.' })
          class Dinheiro extends ValueObject<P> {}
          void Dinheiro;
        }),
      ).toEqual([]);
    });

    test('nome não PascalCase, description vazia e invariante inválida', () => {
      const errors = errorsOf(() => {
        @AgentValueObject({ description: ' ' })
        @Invariant({ id: 'Ruim', text: 'Regra.' })
        class dinheiro extends ValueObject<P> {}
        void dinheiro;
      });
      expect(
        errors.some((e) =>
          e.includes('validate.name-pascal-case valueobject:dinheiro'),
        ),
      ).toBe(true);
      expect(
        errors.some((e) =>
          e.includes(
            'validate.required-empty valueobject:dinheiro: description',
          ),
        ),
      ).toBe(true);
      expect(
        errors.some((e) =>
          e.includes('validate.invariant-id-format invariant:dinheiro/Ruim'),
        ),
      ).toBe(true);
    });

    test('não estender ValueObject é erro com source', () => {
      const errors = errorsOf(() => {
        @AgentValueObject({ description: 'Solto.' })
        class Solto {}
        void Solto;
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(HERE);
      expect(errors[0]).toContain(
        'validate.value-object-base-missing valueobject:Solto',
      );
    });

    test('nome igual ao de uma entidade é erro', () => {
      const errors = errorsOf(() => {
        @AgentEntity({ description: 'Coisa.' })
        class Igual extends AggregateRoot<string> {}
        void Igual;
        const Vo = class Igual extends ValueObject<P> {};
        AgentValueObject({ description: 'VO.' })(Vo);
      });
      expect(
        errors.some(
          (e) =>
            e.includes('validate.value-object-name-collision') &&
            e.includes('Igual'),
        ),
      ).toBe(true);
    });

    test('mesmo nome de VO em dois lugares gera ID duplicado', () => {
      const errors = errorsOf(() => {
        {
          @AgentValueObject({ description: 'Dinheiro A.' })
          class Dinheiro extends ValueObject<P> {}
          void Dinheiro;
        }
        {
          @AgentValueObject({ description: 'Dinheiro B.' })
          class Dinheiro extends ValueObject<P> {}
          void Dinheiro;
        }
      });
      expect(
        errors.some((e) =>
          e.includes(
            'validate.duplicate-id duplicate ID valueobject:Dinheiro (also declared in src/compiler/validate.test.ts:',
          ),
        ),
      ).toBe(true);
    });

    test('VO com @AgentUseCase e @Invariant na classe é ambíguo', () => {
      const errors = errorsOf(() => {
        @AgentValueObject({ description: 'VO.' })
        @AgentUseCase({ ...base, name: 'caso' })
        @Invariant({ id: 'dupla', text: 'Regra.' })
        class Dupla extends ValueObject<P> {}
        void Dupla;
      });
      expect(
        errors.some((e) =>
          e.includes(
            'validate.invariant-owner-ambiguous @Invariant dupla on Dupla',
          ),
        ),
      ).toBe(true);
    });

    test('@Invariant em método de VO é erro', () => {
      const errors = errorsOf(() => {
        @AgentValueObject({ description: 'VO.' })
        class Dinheiro extends ValueObject<P> {
          @Invariant({ id: 'regra', text: 'Regra.' })
          soma(): void {}
        }
        void Dinheiro;
      });
      expect(
        errors.some((e) =>
          e.includes(
            'validate.invariant-method-misplaced @Invariant regra on Dinheiro.soma',
          ),
        ),
      ).toBe(true);
    });

    test('VO fora dos módulos é erro', () => {
      const registry = createRegistry();
      withRegistry(registry, () => {
        @AgentValueObject({ description: 'VO.' })
        class Fora extends ValueObject<P> {}
        void Fora;
      });
      const { errors } = analyze(registry, {
        root: ROOT,
        modules: [{ name: 'x', path: 'src/outro' }],
      });
      expect(errors.some((e) => e.code === 'ir.outside-modules')).toBe(true);
    });
  });
});

describe('validate: contains e references', () => {
  const VO = () => {
    @AgentValueObject({ description: 'Dinheiro.' })
    class Dinheiro extends ValueObject<{ c: number }> {}
    return Dinheiro;
  };

  test('references para VO é erro', () => {
    const errors = errorsOf(() => {
      const Dinheiro = VO();
      @AgentEntity({ description: 'A.', references: () => [Dinheiro] })
      class A extends AggregateRoot<string> {}
      void A;
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(HERE);
    expect(errors[0]).toContain('validate.references-value-object entity:A');
  });

  test('entidade filha com dois donos é erro; VO em vários é aceito', () => {
    const errors = errorsOf(() => {
      const Dinheiro = VO();
      @AgentEntity({ description: 'Filha.' })
      class Filha extends AggregateRoot<string> {}
      @AgentEntity({ description: 'A.', contains: () => [Filha, Dinheiro] })
      class A extends AggregateRoot<string> {}
      @AgentEntity({ description: 'B.', contains: () => [Filha, Dinheiro] })
      class B extends AggregateRoot<string> {}
      void A;
      void B;
    });
    const filha = errors.filter((e) => e.includes('entity:Filha'));
    expect(filha).toHaveLength(1);
    expect(filha[0]).toContain(
      'validate.contains-multiple-owners entity:Filha is in the contains of more than one owner (entity:A, entity:B)',
    );
    expect(errors).toHaveLength(1);
  });

  test('ciclo de contains é erro', () => {
    const errors = errorsOf(() => {
      @AgentEntity({ description: 'A.', contains: () => [B] })
      class A extends AggregateRoot<string> {}
      @AgentEntity({ description: 'B.', contains: () => [A] })
      class B extends AggregateRoot<string> {}
      void A;
      void B;
    });
    expect(errors.some((e) => e.includes('validate.contains-cycle'))).toBe(
      true,
    );
  });

  test('ciclo que não passa pela entidade de partida aponta para quem o fecha', () => {
    const errors = errorsOf(() => {
      @AgentEntity({ description: 'A.', contains: () => [B] })
      class A extends AggregateRoot<string> {}
      @AgentEntity({ description: 'B.', contains: () => [C] })
      class B extends AggregateRoot<string> {}
      @AgentEntity({ description: 'C.', contains: () => [B] })
      class C extends AggregateRoot<string> {}
      void A;
      void B;
      void C;
    });
    const cycle = errors.filter((e) => e.includes('validate.contains-cycle'));
    expect(cycle).toHaveLength(1);
    expect(cycle[0]).toMatch(
      /^src\/compiler\/validate\.test\.ts:\d+ validate.contains-cycle entity:C:/,
    );
  });

  test('entidade que contém a si mesma é ciclo', () => {
    const errors = errorsOf(() => {
      @AgentEntity({ description: 'A.', contains: () => [A] })
      class A extends AggregateRoot<string> {}
      void A;
    });
    expect(
      errors.filter((e) => e.includes('validate.contains-cycle')),
    ).toHaveLength(1);
    expect(errors[0]).toContain('validate.contains-cycle entity:A');
  });

  test('contains entre módulos é erro', () => {
    const registry = createRegistry();
    withRegistry(registry, () => {
      @AgentEntity({ description: 'Filha.' })
      class Filha extends AggregateRoot<string> {}
      @AgentEntity({ description: 'A.', contains: () => [Filha] })
      class A extends AggregateRoot<string> {}
      void A;
    });
    const opts = {
      root: ROOT,
      modules: [{ name: 'compiler', path: 'src/compiler' }],
    };
    const { ir } = buildIR(registry, opts);
    const moved = {
      ...ir,
      entities: ir.entities.map((e) =>
        e.name === 'Filha' ? { ...e, module: 'outro' } : e,
      ),
    };
    const errors = validate(moved, registry, ROOT).map((e) => e.code);
    expect(errors).toEqual(['validate.contains-cross-module']);
  });
});

describe('relationWarnings', () => {
  const opts = {
    root: ROOT,
    modules: [{ name: 'compiler', path: 'src/compiler' }],
  };

  test('sem contains nem references, a lista é vazia', () => {
    const registry = createRegistry();
    withRegistry(registry, () => {
      @AgentEntity({ description: 'Solta.' })
      class Solta extends Entity<string> {}
      void Solta;
    });
    const { ir } = buildIR(registry, opts);
    expect(relationWarnings(ir, registry)).toEqual([]);
  });

  test('raiz sem AggregateRoot e filha com AggregateRoot viram aviso', () => {
    const registry = createRegistry();
    withRegistry(registry, () => {
      @AgentEntity({ description: 'Filha.' })
      class Filha extends AggregateRoot<string> {}
      @AgentEntity({ description: 'Raiz.', contains: () => [Filha] })
      class Raiz extends Entity<string> {}
      void Raiz;
    });
    const { ir } = buildIR(registry, opts);
    expect(relationWarnings(ir, registry)).toEqual([
      'entity:Filha: contained entity extends AggregateRoot',
      'entity:Raiz: aggregate root does not extend AggregateRoot',
    ]);
  });
});

describe('validate: ports', () => {
  test('nome, description, método sem descrição e raiz', () => {
    const errors = errorsOf(() => {
      @AgentEntity({ description: 'Filha.' })
      class Filha extends AggregateRoot<string> {}
      @AgentEntity({ description: 'Raiz.', contains: () => [Filha] })
      class Raiz extends AggregateRoot<string> {}
      @AgentPort({ description: ' ', root: () => Filha, methods: { a: ' ' } })
      abstract class repo_ruim {}
      void [Raiz, repo_ruim];
    });
    expect(errors).toEqual(
      expect.arrayContaining([expect.stringMatching(HERE)]),
    );
    const text = errors.join('\n');
    expect(text).toContain('validate.name-pascal-case port:repo_ruim');
    expect(text).toContain(
      'validate.required-empty port:repo_ruim: description',
    );
    expect(text).toContain(
      'validate.required-empty port:repo_ruim.a: description',
    );
    expect(text).toContain('validate.port-root-not-aggregate port:repo_ruim');
  });

  test('ID duplicado entre dois ports de mesmo nome', () => {
    const errors = errorsOf(() => {
      @AgentEntity({ description: 'Conta.' })
      class Conta extends AggregateRoot<string> {}
      @AgentPort({ description: 'A.', root: () => Conta, methods: {} })
      abstract class Repo {}
      void Repo;
    });
    expect(errors.filter((e) => e.includes('validate.duplicate-id'))).toEqual(
      [],
    );
    const dup = errorsOf(() => {
      @AgentEntity({ description: 'Conta.' })
      class Conta extends AggregateRoot<string> {}
      @AgentPort({ description: 'A.', root: () => Conta, methods: {} })
      abstract class Repo {}
      void Repo;
      {
        @AgentPort({ description: 'B.', root: () => Conta, methods: {} })
        abstract class Repo {}
        void Repo;
      }
    });
    expect(
      dup.some((e) =>
        e.includes('validate.duplicate-id duplicate ID port:Repo'),
      ),
    ).toBe(true);
  });

  test('port fora dos módulos usa a regra do moduleOf', () => {
    const registry = createRegistry();
    withRegistry(registry, () => {
      @AgentEntity({ description: 'Conta.' })
      class Conta extends AggregateRoot<string> {}
      @AgentPort({ description: 'A.', root: () => Conta, methods: {} })
      abstract class Repo {}
      void Repo;
    });
    const { errors } = analyze(registry, {
      root: ROOT,
      modules: [{ name: 'x', path: 'src/outro' }],
    });
    expect(errors.filter((e) => e.code === 'ir.outside-modules').length).toBe(
      2,
    );
  });
});

describe('validate: métodos abstratos do port (árvore sintática)', () => {
  const check = (registry: ReturnType<typeof createRegistry>) =>
    analyze(registry, { root: ROOT, modules: [PORTS_MODULE] }).errors.map(
      (e) => e.code,
    );

  test('port correto não gera erro (método concreto auxiliar não conta)', () => {
    expect(check(definePortOk())).toEqual([]);
  });

  test('método abstrato faltando e sobrando em methods', () => {
    expect(check(definePortDivergente())).toEqual([
      'validate.port-methods-undeclared',
      'validate.port-methods-extra',
    ]);
  });

  test('decorator empilhado acima de @AgentPort', () => {
    expect(check(definePortEmpilhado())).toEqual([]);
  });

  test('classes homônimas são conferidas cada uma contra a sua', () => {
    // the duplicate ID is expected (same name); what matters is that each AST is checked against the right class
    expect(
      check(definePortsHomonimos()).filter(
        (m) => m !== 'validate.duplicate-id',
      ),
    ).toEqual([
      'validate.port-methods-undeclared',
      'validate.port-methods-extra',
    ]);
  });

  test('método abstrato de nome literal conta pelo nome sem aspas', () => {
    expect(check(definePortNomeLiteral())).toEqual([]);
  });

  test('método sobrecarregado conta uma vez', () => {
    expect(check(definePortSobrecarga())).toEqual([]);
  });

  test('classe sem abstract é erro', () => {
    expect(check(definePortConcreto())).toEqual(['validate.port-not-abstract']);
  });

  test('classe não encontrada no arquivo do source é erro com source', () => {
    const registry = definePortOk();
    (registry.ports[0]!.source as { line: number }).line = 1;
    const { errors } = analyze(registry, {
      root: ROOT,
      modules: [PORTS_MODULE],
    });
    expect(errors.map((e) => e.code)).toEqual(['validate.port-class-missing']);
    expect(errors[0]!.source).toBe('src/compiler/__fixtures__/ports.ts:1');
  });

  test('arquivo de origem ilegível é erro com source', () => {
    const registry = definePortOk();
    (registry.ports[0]!.source as { file: string }).file = resolve(
      ROOT,
      'src/compiler/__fixtures__/inexistente.ts',
    );
    const { errors } = analyze(registry, {
      root: ROOT,
      modules: [PORTS_MODULE],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('validate.port-source-unreadable');
    expect(errors[0]!.message).toContain('port:ContaRepository');
    expect(errors[0]!.source).toStartWith(
      'src/compiler/__fixtures__/inexistente.ts:',
    );
  });
});

describe('validate: adapters', () => {
  test('adapter válido não gera erro', () => {
    expect(
      errorsOf(() => {
        @AgentEntity({ description: 'Conta.' })
        class Conta extends AggregateRoot<string> {}
        @AgentPort({
          description: 'R.',
          root: () => Conta,
          methods: { a: 'A.' },
        })
        abstract class Repo {
          abstract a(): void;
        }
        @AgentAdapter({ description: 'Impl.', implements: () => Repo })
        class MemRepo extends Repo {
          a() {}
        }
        void MemRepo;
      }),
    ).toEqual([]);
  });

  test('nome, description, não estende o port, port sem métodos', () => {
    const text = errorsOf(() => {
      @AgentEntity({ description: 'Conta.' })
      class Conta extends AggregateRoot<string> {}
      @AgentPort({ description: 'R.', root: () => Conta, methods: {} })
      abstract class Repo {}
      @AgentAdapter({ description: ' ', implements: () => Repo })
      class mem_repo {}
      void mem_repo;
    }).join('\n');
    expect(text).toMatch(HERE);
    expect(text).toContain('validate.name-pascal-case adapter:mem_repo');
    expect(text).toContain(
      'validate.required-empty adapter:mem_repo: description',
    );
    expect(text).toContain('validate.adapter-not-extending adapter:mem_repo');
    expect(text).toContain('validate.adapter-port-empty adapter:mem_repo');
  });

  test('segundo adapter para o mesmo port', () => {
    const text = errorsOf(() => {
      @AgentEntity({ description: 'Conta.' })
      class Conta extends AggregateRoot<string> {}
      @AgentPort({
        description: 'R.',
        root: () => Conta,
        methods: { a: 'A.' },
      })
      abstract class Repo {
        abstract a(): void;
      }
      @AgentAdapter({ description: 'A.', implements: () => Repo })
      class AdapterA extends Repo {
        a() {}
      }
      @AgentAdapter({ description: 'B.', implements: () => Repo })
      class AdapterB extends Repo {
        a() {}
      }
      void [AdapterA, AdapterB];
    }).join('\n');
    expect(text).toContain('validate.adapter-duplicate adapter:AdapterB');
  });

  test('ID duplicado entre dois adapters de mesmo nome', () => {
    const text = errorsOf(() => {
      @AgentEntity({ description: 'Conta.' })
      class Conta extends AggregateRoot<string> {}
      @AgentPort({
        description: 'R.',
        root: () => Conta,
        methods: { a: 'A.' },
      })
      abstract class Repo {
        abstract a(): void;
      }
      @AgentAdapter({ description: 'A.', implements: () => Repo })
      class Mem extends Repo {
        a() {}
      }
      void Mem;
      {
        @AgentAdapter({ description: 'B.', implements: () => Repo })
        class Mem extends Repo {
          a() {}
        }
        void Mem;
      }
    }).join('\n');
    expect(text).toContain('validate.duplicate-id duplicate ID adapter:Mem');
  });

  test('adapter fora dos módulos usa a regra do moduleOf', () => {
    const registry = createRegistry();
    withRegistry(registry, () => {
      @AgentEntity({ description: 'Conta.' })
      class Conta extends AggregateRoot<string> {}
      @AgentPort({
        description: 'R.',
        root: () => Conta,
        methods: { a: 'A.' },
      })
      abstract class Repo {
        abstract a(): void;
      }
      @AgentAdapter({ description: 'A.', implements: () => Repo })
      class Mem extends Repo {
        a() {}
      }
      void Mem;
    });
    const { errors } = analyze(registry, {
      root: ROOT,
      modules: [{ name: 'x', path: 'src/outro' }],
    });
    expect(errors.filter((e) => e.code === 'ir.outside-modules').length).toBe(
      3,
    );
  });
});
