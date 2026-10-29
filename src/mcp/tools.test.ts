import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { type DomainLock, parseLock } from '../compiler/lock';
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

  test('use-case invariant is found and returns the owning use-case', () => {
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

  test('value object invariant is found and returns the owning VO', () => {
    const invariant = {
      id: 'invariant:Dinheiro/nao-negativo',
      text: 'Valor não pode ser negativo.',
      on: null,
      source: 'src/shop/domain/dinheiro.ts',
    };
    const voLock: DomainLock = {
      lockVersion: 1,
      changes: [],
      ir: {
        irVersion: 1,
        modules: [],
        entities: [],
        valueObjects: [
          {
            id: 'valueobject:Dinheiro',
            name: 'Dinheiro',
            module: 'shop',
            description: 'Quantia monetária.',
            invariants: [invariant],
            source: 'src/shop/domain/dinheiro.ts',
          },
        ],
        events: [],
        useCases: [],
        operators: [],
      },
    };
    expect(element(voLock, invariant.id)).toEqual({
      ok: true,
      value: { ...invariant, valueObject: 'valueobject:Dinheiro' },
    });
  });

  test('unknown id and unknown prefix return an error with the mcp.element-unknown code', () => {
    const suffix =
      '; use domain_overview to see the ids (prefixes: entity, method, invariant, event, usecase, operator)';
    expect(element(lock, 'entity:Nope')).toEqual({
      ok: false,
      code: 'mcp.element-unknown',
      error: `unknown id: entity:Nope${suffix}`,
    });
    expect(element(lock, 'foo:Order')).toEqual({
      ok: false,
      code: 'mcp.element-unknown',
      error: `unknown id: foo:Order${suffix}`,
    });
    expect(element(lock, 'constructor:x')).toEqual({
      ok: false,
      code: 'mcp.element-unknown',
      error: `unknown id: constructor:x${suffix}`,
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
  test('calling twice gives identical output', () => {
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

  test('normalizes ./ and returns the rules that match the path', () => {
    expect(rulesForPath(rules, 'src/x.ts')).toEqual({
      path: 'src/x.ts',
      rules: both,
    });
    expect(rulesForPath(rules, './src/x.ts')).toEqual({
      path: 'src/x.ts',
      rules: both,
    });
  });

  test('replaces backslash with slash', () => {
    expect(rulesForPath(rules, 'src\\x.ts').path).toBe('src/x.ts');
  });

  test('path outside the glob returns only the rule without paths', () => {
    expect(rulesForPath(rules, 'docs/x.md')).toEqual({
      path: 'docs/x.md',
      rules: [both[1]],
    });
  });
});
