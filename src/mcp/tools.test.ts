import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { parseLock } from '../compiler/lock';
import type { Rule } from '../compiler/rules';
import { changes, element, overview, rulesForPath } from './tools';

const root = resolve(import.meta.dir, '../..');
const lock = parseLock(
  await Bun.file(resolve(root, '.agentic/domain.lock.json')).text(),
  'lock',
);

describe('overview', () => {
  test('agrupa os elementos por módulo', () => {
    expect(overview(lock)).toMatchSnapshot();
  });
});

describe('element', () => {
  const ids = [
    'entity:Order',
    'method:Order.cancel',
    'invariant:Order/cancelamento-exige-motivo',
    'event:OrderCancelled',
    'usecase:cancel_order',
    'operator:order-operator',
  ];
  for (const id of ids) {
    test(`devolve ${id}`, () => {
      expect(element(lock, id)).toMatchSnapshot();
    });
  }

  test('invariante de use-case é achada e devolve o use-case dono', () => {
    const invariant = {
      ...lock.ir.entities[0]!.invariants[0]!,
      id: 'invariant:matricular_aluno/aluno-ativo',
      on: null,
    };
    const useCaseLock = {
      ...lock,
      ir: {
        ...lock.ir,
        useCases: [
          ...lock.ir.useCases,
          {
            ...lock.ir.useCases[0]!,
            id: 'usecase:matricular_aluno',
            name: 'matricular_aluno',
            invariants: [invariant],
          },
        ],
      },
    };
    expect(element(useCaseLock, invariant.id)).toEqual({
      ok: true,
      value: { ...invariant, useCase: 'usecase:matricular_aluno' },
    });
  });

  test('id desconhecido e prefixo desconhecido dão erro com a mensagem', () => {
    const suffix =
      '; use domain_overview para ver os ids (prefixos: entity, method, invariant, event, usecase, operator)';
    expect(element(lock, 'entity:Nope')).toEqual({
      ok: false,
      error: `id desconhecido: entity:Nope${suffix}`,
    });
    expect(element(lock, 'foo:Order')).toEqual({
      ok: false,
      error: `id desconhecido: foo:Order${suffix}`,
    });
    expect(element(lock, 'constructor:x')).toEqual({
      ok: false,
      error: `id desconhecido: constructor:x${suffix}`,
    });
  });
});

describe('changes', () => {
  test('sem id devolve todas as changes', () => {
    expect(changes(lock)).toMatchSnapshot();
  });

  test('com id devolve só as changes que tocam o id', () => {
    expect(changes(lock, 'entity:Order')).toMatchSnapshot();
  });
});

describe('determinismo', () => {
  test('chamar duas vezes dá saída idêntica', () => {
    expect(JSON.stringify(overview(lock))).toBe(JSON.stringify(overview(lock)));
    expect(JSON.stringify(element(lock, 'method:Order.cancel'))).toBe(
      JSON.stringify(element(lock, 'method:Order.cancel')),
    );
    expect(JSON.stringify(changes(lock))).toBe(JSON.stringify(changes(lock)));
  });
});

describe('rulesForPath', () => {
  const rules: Rule[] = [
    { key: 'a', file: '.ai/rules/a.md', paths: ['src/**/*.ts'], body: 'A' },
    { key: 'b', file: null, paths: null, body: 'B' },
  ];
  const both = [
    { key: 'a', file: '.ai/rules/a.md', paths: ['src/**/*.ts'], body: 'A' },
    { key: 'b', file: null, paths: null, body: 'B' },
  ];

  test('normaliza ./ e devolve as regras que casam com o caminho', () => {
    expect(rulesForPath(rules, 'src/x.ts')).toEqual({
      path: 'src/x.ts',
      rules: both,
    });
    expect(rulesForPath(rules, './src/x.ts')).toEqual({
      path: 'src/x.ts',
      rules: both,
    });
  });

  test('troca barra invertida por barra', () => {
    expect(rulesForPath(rules, 'src\\x.ts').path).toBe('src/x.ts');
  });

  test('caminho fora do glob devolve só a regra sem paths', () => {
    expect(rulesForPath(rules, 'docs/x.md')).toEqual({
      path: 'docs/x.md',
      rules: [both[1]],
    });
  });
});
