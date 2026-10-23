import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { z } from 'zod';
import { AggregateRoot, DomainEvent, ValueObject } from '@agentic-ddd/core';
import {
  AgentEntity,
  AgentEvent,
  AgentMethod,
  AgentUseCase,
  AgentValueObject,
  Invariant,
  Operator,
  createRegistry,
  withRegistry,
} from '@agentic-ddd/decorators';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop';
import { analyze } from './analyze';

const ROOT = resolve(import.meta.dir, '../..');
const HERE = /^src\/compiler\/validate\.test\.ts:\d+ /;
const io = { input: z.object({}), output: z.object({}) };

function errorsOf(define: () => void): string[] {
  const registry = createRegistry();
  withRegistry(registry, define);
  return analyze(registry, {
    root: ROOT,
    modules: [{ name: 'compiler', path: 'src/compiler' }],
  }).errors.map((e) => `${e.source ?? '-'} ${e.message}`);
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
      'invariant:Thing/Id Ruim: o id da invariante deve ser kebab-case',
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
        e.includes(
          'entity:Door tem métodos com transition, mas @AgentEntity não declara states',
        ),
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
      'method:Door.open: estado "locked" não está em states de Door',
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
        e.includes('emits aponta para NotAnEvent, que não tem @AgentEvent'),
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
    expect(errors[0]).toContain(
      'usecase:do_it: uses cita method:Ghost.boo, que não existe',
    );
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
    expect(errors[0]).toContain(
      'usecase:ring_bell: emite event:Rang, mas nenhum método em uses emite esse evento',
    );
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
    expect(errors[0]).toContain(
      'usecase:ring_bell: method:Bell.ring emite event:Rang, que falta em emits (o runtime recusaria a publicação)',
    );
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
      'operator:op: requiresApproval cita usecase:b_case, que não está em useCases',
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
      errors.some((e) =>
        e.includes('operator:op: Plain não tem @AgentUseCase'),
      ),
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
    expect(errors[0]).toContain(
      'Account.helper é público e não tem @AgentMethod',
    );
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
          'ID duplicado entity:Item (também declarado em src/compiler/validate.test.ts:',
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
    expect(errors.some((e) => e.includes('name deve ser snake_case'))).toBe(
      true,
    );
    expect(errors.some((e) => e.includes('whenToUse é obrigatório'))).toBe(
      true,
    );
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
          'invariant:Box/nunca-cheia está num método sem @AgentMethod (method:Box.fill)',
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
    expect(
      result.errors.some((e) =>
        e.message.includes('Plain não tem @AgentUseCase'),
      ),
    ).toBe(true);
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
      'invariant:Thing/empty-text: text é obrigatório e não pode ser vazio',
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
    expect(errors[0]).toContain('transition precisa de from (não vazio) e to');
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
      expect(errors[0]).toContain('transition não aceita estado vazio');
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
    expect(errors[0]).toContain('operator:op: useCases não pode ser vazio');
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
      'operator:Op Ruim: name deve ser kebab-case com até 64 caracteres',
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
      expect(errors[0]).toContain('operator:op: limits inválidos');
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
    expect(errors[0]).toContain(
      'Account.helper é público e não tem @AgentMethod',
    );
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
      'NotEntity.doIt tem @AgentMethod, mas NotEntity não tem @AgentEntity',
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
        e.includes(
          'invariant:caso/Id Ruim: o id da invariante deve ser kebab-case',
        ),
      ),
    ).toBe(true);
    expect(
      errors.some((e) => e.includes('ID duplicado invariant:caso/dup')),
    ).toBe(true);
    expect(
      errors.some((e) =>
        e.includes('invariant:caso/vazia: text é obrigatório'),
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
      '@Invariant regra em Caso.execute: em use-case, @Invariant vai na classe',
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
      '@Invariant dupla em Dupla: a classe tem @AgentEntity e @AgentUseCase, e o dono da invariante fica ambíguo',
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
      '@Invariant solta em Plain, que não tem @AgentEntity, @AgentUseCase nem @AgentValueObject',
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
          e.includes(
            'valueobject:dinheiro: o nome da classe deve ser PascalCase',
          ),
        ),
      ).toBe(true);
      expect(
        errors.some((e) =>
          e.includes('valueobject:dinheiro: description é obrigatório'),
        ),
      ).toBe(true);
      expect(
        errors.some((e) =>
          e.includes(
            'invariant:dinheiro/Ruim: o id da invariante deve ser kebab-case',
          ),
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
        'valueobject:Solto: não estende ValueObject de @agentic-ddd/core (projeto e CLI com cópias diferentes do pacote?)',
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
        errors.some((e) => e.includes('Igual') && e.includes('entidade')),
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
            '@Invariant dupla em Dupla: a classe tem mais de um entre @AgentEntity, @AgentUseCase e @AgentValueObject, e o dono da invariante fica ambíguo',
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
            '@Invariant regra em Dinheiro.soma: em value object, @Invariant vai na classe',
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
      expect(errors.some((e) => e.message.includes('fora dos módulos'))).toBe(
        true,
      );
    });
  });
});
