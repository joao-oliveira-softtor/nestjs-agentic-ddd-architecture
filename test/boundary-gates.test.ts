import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  bodyOnlyFindings,
  bodyRange,
  classScopeFindings,
  importDirectionFindings,
  importSpecifiers,
  main,
  outerFolders,
} from '../scripts/boundary-gates';
import { DEFAULT_CONVENTIONS } from '../src/compiler/config';

const ROOT = resolve(import.meta.dir, '..');
const BASE = `import { x } from './x';
export class Thing {
  static create(name: string) {
    return notImplemented();
  }
  other() {
    return 1;
  }
}
`;
const body = (inner: string) =>
  BASE.replace('    return notImplemented();', inner);

test('só o interior do corpo muda: mesmo número de linhas passa', () => {
  const after = body('    if (!name) throw new Error("x");');
  expect(bodyOnlyFindings(BASE, after, 'Thing', 'create', 'a.ts')).toEqual([]);
  const range = bodyRange(BASE, 'Thing', 'create');
  expect(BASE.slice(range.start, range.end)).toContain('notImplemented');
});

test('bytes fora do corpo e contagem de linhas reprovam', () => {
  expect(
    bodyOnlyFindings(
      BASE,
      body('    return 1;').replace('./x', './y'),
      'Thing',
      'create',
      'a.ts',
    ),
  ).toEqual(['Bytes outside assigned body changed: a.ts']);
  expect(
    bodyOnlyFindings(
      BASE,
      body('    const a = 1;\n    return a;'),
      'Thing',
      'create',
      'a.ts',
    ),
  ).toEqual(['Body line count changed: a.ts']);
  expect(
    bodyOnlyFindings(
      BASE,
      BASE.replace('other() {\n    return 1;', 'other() {\n    return 2;'),
      'Thing',
      'create',
      'a.ts',
    ),
  ).toEqual(['Bytes outside assigned body changed: a.ts']);
});

test('sintaxe inválida e método ausente viram finding', () => {
  expect(bodyOnlyFindings(BASE, 'class {', 'Thing', 'create', 'a.ts')).toEqual([
    expect.stringContaining('Submission syntax invalid'),
  ]);
  expect(bodyOnlyFindings(BASE, BASE, 'Thing', 'inexistente', 'a.ts')).toEqual([
    expect.stringContaining('Assigned method body missing'),
  ]);
});

test('extrai imports, export-from e import() dinâmico', () => {
  expect(
    importSpecifiers(
      `import a from './a'; import type { B } from "../b"; export * from './c'; const d = import('./d');`,
    ).sort(),
  ).toEqual(['../b', './a', './c', './d']);
});

test('domínio não importa application, operators, infraestrutura, Nest nem o runtime', () => {
  const file = 'src/orders/domain/order.ts';
  const bad = [
    `import { Injectable } from '@nestjs/common';`,
    `import { r } from '@agentic-ddd/runtime';`,
    `import { n } from '@agentic-ddd/nestjs';`,
    `import { u } from '../application/create-order';`,
    `import type { o } from '../operators/order-operator';`,
    `import { db } from '../../infrastructure/db';`,
    `const x = import('../infra/repo');`,
  ];
  for (const line of bad)
    expect(importDirectionFindings(file, line, 'domain')).toHaveLength(1);
  const good = `import { z } from 'zod'; import { c } from '@agentic-ddd/core'; import { id } from './order-id'; import { fs } from 'node:fs'; import { e } from '../shared/event';`;
  expect(importDirectionFindings(file, good, 'domain')).toEqual([]);
});

test('aplicação importa o domínio, mas não operators nem infraestrutura', () => {
  const file = 'src/orders/application/create-order.ts';
  expect(
    importDirectionFindings(
      file,
      `import { o } from '../domain/order';`,
      'application',
    ),
  ).toEqual([]);
  expect(
    importDirectionFindings(
      file,
      `import { o } from '../operators/x';`,
      'application',
    ),
  ).toHaveLength(1);
  expect(
    importDirectionFindings(
      file,
      `import { i } from '@nestjs/common';`,
      'application',
    ),
  ).toHaveLength(1);
  expect(
    importDirectionFindings(
      file,
      `import x from '@nestjs/common';`,
      'operators',
    ),
  ).toEqual([]);
});

test('o domínio e a aplicação reais do exemplo orders respeitam a direção', async () => {
  for (const [dir, layer] of [
    ['examples/orders/domain', 'domain'],
    ['examples/orders/application', 'application'],
  ] as const)
    for (const file of new Bun.Glob('*.ts').scanSync({
      cwd: join(ROOT, dir),
    })) {
      if (file.endsWith('.test.ts')) continue;
      const path = `${dir}/${file}`;
      expect(
        importDirectionFindings(
          path,
          await Bun.file(join(ROOT, path)).text(),
          layer,
        ),
      ).toEqual([]);
    }
});

test('CLI: imports e body-only devolvem 0, 1 ou 2', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentic-gates-'));
  try {
    const before = join(dir, 'before.ts');
    const good = join(dir, 'good.ts');
    const bad = join(dir, 'bad.ts');
    await writeFile(before, BASE);
    await writeFile(good, body('    return 1;'));
    await writeFile(bad, body('    return 1;').replace('./x', './y'));
    const imports = join(dir, 'domain', 'order.ts');
    await Bun.write(imports, `import { a } from '../application/x';`);
    const quiet = console.error;
    console.error = () => {};
    try {
      expect(
        main([
          'body-only',
          '--before',
          before,
          '--after',
          good,
          '--class',
          'Thing',
          '--method',
          'create',
        ]),
      ).toBe(0);
      expect(
        main([
          'body-only',
          '--before',
          before,
          '--after',
          bad,
          '--class',
          'Thing',
          '--method',
          'create',
        ]),
      ).toBe(1);
      expect(main(['imports', '--layer', 'domain', imports])).toBe(1);
      expect(main(['imports', '--layer', 'domain'])).toBe(2);
      expect(main(['imports', '--layer', 'nada', imports])).toBe(2);
      expect(main(['outro'])).toBe(2);
      expect(main(['imports', '--layer', 'infrastructure', imports])).toBe(0);
      expect(main(['class-scope', '--before', before, '--after', before])).toBe(
        2,
      );
      for (const [after, code] of [
        [bad, 1],
        [good, 0],
      ] as const)
        expect(
          main([
            'class-scope',
            '--before',
            before,
            '--after',
            after,
            '--class',
            'Thing',
          ]),
        ).toBe(code);
    } finally {
      console.error = quiet;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('require(), import = require() e import() não literal não contornam o gate', () => {
  const file = 'src/orders/domain/order.ts';
  const forbidden = [
    `const a = require('../application/x');`,
    `import a = require('../operators/x');`,
    'const a = import(`../infra/x`);',
    `const a = require('@nestjs/common');`,
  ];
  for (const line of forbidden)
    expect(importDirectionFindings(file, line, 'domain')).toHaveLength(1);
  expect(
    importSpecifiers(`import a = require('./a'); const b = require('./b');`),
  ).toEqual(['./a', './b']);
  for (const line of [
    `const p = '../application/x'; const a = import(p);`,
    `const a = require(path);`,
    `import a = require(path);`,
  ])
    expect(importDirectionFindings(file, line, 'domain')).toEqual([
      expect.stringContaining('não literal'),
    ]);
  expect(
    importDirectionFindings(file, `const a = require('./order-id');`, 'domain'),
  ).toEqual([]);
});

test('diretório acima do módulo chamado infra/operators não gera falso positivo', () => {
  for (const base of [
    'src/infra',
    'src/operators',
    'packages/infrastructure/orders',
  ]) {
    const file = `${base}/domain/order.ts`;
    expect(
      importDirectionFindings(
        file,
        `import { a } from './order-id'; import { b } from '../shared/event'; import { c } from './sub/x';`,
        'domain',
      ),
    ).toEqual([]);
    expect(
      importDirectionFindings(
        `${base}/application/create.ts`,
        `import { o } from '../domain/order';`,
        'application',
      ),
    ).toEqual([]);
    expect(
      importDirectionFindings(
        file,
        `import { a } from '../application/create';`,
        'domain',
      ),
    ).toHaveLength(1);
    expect(
      importDirectionFindings(
        `${base}/domain/sub/deep.ts`,
        `import { a } from '../../infrastructure/db';`,
        'domain',
      ),
    ).toHaveLength(1);
  }
});

test('limitação conhecida: especificadores não relativos (aliases) não são resolvidos', () => {
  // Um alias de `paths` do tsconfig para uma camada externa não é detectado: só
  // @nestjs/* e o runtime do framework são barrados fora de imports relativos.
  expect(
    importDirectionFindings(
      'src/orders/domain/order.ts',
      `import { a } from '@app/orders/application/create';`,
      'domain',
    ),
  ).toEqual([]);
});

test('outerFolders com o padrão reproduz as pastas externas históricas', () => {
  expect({
    domain: outerFolders(DEFAULT_CONVENTIONS, 'domain'),
    application: outerFolders(DEFAULT_CONVENTIONS, 'application'),
  }).toEqual({
    domain: ['application', 'operators', 'infrastructure', 'infra'],
    application: ['operators', 'infrastructure', 'infra'],
  });
});

test('conventions: nomes de camada configurados valem para a direção de import', () => {
  const conventions = {
    ...DEFAULT_CONVENTIONS,
    layers: {
      domain: 'model',
      application: 'use-cases',
      operators: 'operators',
    },
  };
  const file = 'src/shop/core/model/x.ts';
  expect(
    importDirectionFindings(
      file,
      `import { y } from '../use-cases/y';`,
      'domain',
      conventions,
    ),
  ).toHaveLength(1);
  expect(
    importDirectionFindings(
      file,
      `import { y } from '../application/y';`,
      'domain',
      conventions,
    ),
  ).toEqual([]);
});

test('conventions: infraestrutura configurada é barrada no domínio', () => {
  const conventions = { ...DEFAULT_CONVENTIONS, infrastructure: ['adapters'] };
  expect(
    importDirectionFindings(
      'src/shop/domain/x.ts',
      `import { db } from '../adapters/db';`,
      'domain',
      conventions,
    ),
  ).toHaveLength(1);
});

const VO = `import { x } from './x';
@Decorated()
export class Money extends Base implements Eq {
  @Field() readonly amount: number = 1;
  #cache = 0;
  constructor(amount: number) {
    super();
    this.#cache = amount;
  }
  static of(amount: number): Money {
    return notImplemented();
  }
  get label(): string {
    return 'a';
  }
  #helper(): number {
    return 1;
  }
}
`;
const scope = (after: string) => classScopeFindings(VO, after, 'Money', 'a.ts');

test('escopo de classe: corpos e membros #privados mudam com as mesmas linhas', () => {
  const after = VO.replace('super();', 'super(); // x')
    .replace('this.#cache = amount;', 'this.#cache = amount + 1;')
    .replace('return notImplemented();', 'return new Money(amount);')
    .replace("return 'a';", "return 'b';")
    .replace('#cache = 0;', '#cache: number = 5;')
    .replace('#helper(): number {', '#helper(n = 1): string {');
  expect(scope(after)).toEqual([]);
});

test('escopo de classe: decorators, heritage e assinatura pública reprovam', () => {
  const cases: [string, string][] = [
    ['@Decorated()', '@Other()'],
    ['@Field()', '@Other()'],
    ['extends Base', 'extends Other'],
    ['implements Eq', 'implements Eq, Ord'],
    ['constructor(amount: number)', 'constructor(amount: string)'],
    ['static of(amount: number)', 'static of(value: number)'],
    [
      'static of(amount: number): Money',
      'static of(amount: number): Money | null',
    ],
    ['get label(): string', 'get title(): string'],
    ['readonly amount: number', 'readonly amount: string'],
    ['= 1;\n  #cache', '= 2;\n  #cache'],
  ];
  for (const [from, to] of cases) {
    expect(VO).toContain(from.replace('\\n', '\n'));
    expect(
      scope(VO.replace(from.replace('\\n', '\n'), to.replace('\\n', '\n'))),
    ).not.toEqual([]);
  }
});

test('escopo de classe: acrescentar membro público, linhas e bytes fora reprovam', () => {
  expect(scope(VO.replace('  #helper', '  extra = 1;\n  #helper'))).toEqual([
    'Class line count changed: a.ts',
    'Public member set changed: a.ts',
  ]);
  expect(scope(VO.replace('  #cache = 0;\n', ''))).toEqual([
    'Class line count changed: a.ts',
  ]);
  expect(scope(VO.replace('./x', './y'))).toEqual([
    'Bytes outside assigned class changed: a.ts',
  ]);
  expect(scope(VO.replace('Money', 'Gone'))).toEqual([
    'Error: Assigned class missing',
  ]);
  expect(scope('class {')).toEqual(['Error: Submission syntax invalid']);
});
