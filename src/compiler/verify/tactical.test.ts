import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { compile } from '@agentic-ddd/compiler';
import { canonicalPath } from '@agentic-ddd/decorators';
import { SHOP_MODULE, defineShop } from '../__fixtures__/shop';
import {
  ENROLLMENT_MODULE,
  defineEnrollment,
} from '../__fixtures__/matriculas';
import { analyze } from '../analyze';
import type { IR, IREntity } from '../ir';
import {
  hasTacticalElements,
  tacticalFindings,
  tacticalGate,
  typeNames,
} from './tactical';

const ROOT = resolve(import.meta.dir, '../../..');

const ent = (name: string, contains: string[] = []): IREntity => ({
  id: `entity:${name}`,
  name,
  module: 'm',
  description: '',
  states: [],
  invariants: [],
  methods: [],
  ...(contains.length > 0 ? { contains } : {}),
  source: 'x.ts:1',
});

const vo = (name: string) => ({
  id: `valueobject:${name}`,
  name,
  module: 'm',
  description: '',
  invariants: [],
  source: 'x.ts:1',
});

// Aluno, Turma: raízes; Matricula contém AlunoId; Pedido (raiz) contém Item, que contém Linha; Dinheiro: VO solto.
const IR_FIXTURE = {
  irVersion: 1,
  modules: [],
  entities: [
    ent('Aluno'),
    ent('Turma'),
    ent('Matricula', ['valueobject:AlunoId']),
    ent('Pedido', ['entity:Item', 'entity:Extra', 'valueobject:Dinheiro']),
    ent('Item', ['entity:Linha']),
    ent('Linha'),
    ent('Extra'),
  ],
  valueObjects: [vo('AlunoId'), vo('Dinheiro')],
  events: [],
  useCases: [],
  operators: [],
} as unknown as IR;

function run(owner: string, name: string, body: string) {
  const code = `@AgentEntity({})\nclass ${name} {\n${body}\n}\n`;
  const sf = ts.createSourceFile('x.ts', code, ts.ScriptTarget.Latest, true);
  const cls = sf.statements.find(ts.isClassDeclaration)!;
  const kind = owner.startsWith('valueobject:') ? 'valueobject' : 'entity';
  return tacticalFindings({ sf, cls, owner, kind, ir: IR_FIXTURE });
}
const msgs = (owner: string, name: string, body: string) =>
  run(owner, name, body).map((f) => f.message);

describe('T1', () => {
  test.each([
    ['aluno: Aluno;', 'aluno'],
    ['turmas: Map<string, Turma>;', 'turmas'],
    ['#turma: Turma;', '#turma'],
    ['readonly alunos: Aluno[];', 'alunos'],
    ['constructor(private readonly aluno: Aluno) {}', 'aluno'],
    ['constructor(override readonly aluno: Aluno) {}', 'aluno'],
    ['a: Set<Aluno>;', 'a'],
    ['a: Array<Aluno>;', 'a'],
    ['a: ReadonlyMap<string, Aluno>;', 'a'],
    ['a: Record<string, Aluno>;', 'a'],
    ['a: [Aluno, string];', 'a'],
    ['a: readonly Aluno[];', 'a'],
    ['a?: Aluno | null;', 'a'],
  ])('viola: %s', (body, field) => {
    expect(msgs('entity:Matricula', 'Matricula', body)).toEqual([
      expect.stringMatching(
        new RegExp(
          `^T1: field ${field} holds the root \\w+ of another aggregate$`,
        ),
      ),
    ]);
  });

  test.each([
    'alunoId: AlunoId;',
    'matricular(aluno: Aluno) {}',
    'constructor(aluno: Aluno) {}',
    'aluno = null as unknown as Aluno;',
    'self: Matricula;',
    "a: Aluno['id'];",
    'onChange: (a: Aluno) => void;',
    'tipo: typeof Aluno;',
    'a: Ref<Aluno>;',
    'a: keyof Aluno;',
    'static aluno: Aluno;',
  ])('não viola: %s', (body) => {
    expect(msgs('entity:Matricula', 'Matricula', body)).toEqual([]);
  });

  test('Set<AlunoId> passa', () => {
    expect(msgs('entity:Matricula', 'Matricula', 'a: Set<AlunoId>;')).toEqual(
      [],
    );
  });

  test('filha com pai: raiz do próprio agregado não viola', () => {
    expect(msgs('entity:Item', 'Item', 'pai: Pedido;')).toEqual([]);
  });

  test('fix do T1 e linha do campo, ordenado por linha', () => {
    const found = run('entity:Matricula', 'Matricula', 'a: Turma;\nb: Aluno;');
    expect(found.map((f) => [f.line, f.message])).toEqual([
      [3, 'T1: field a holds the root Turma of another aggregate'],
      [4, 'T1: field b holds the root Aluno of another aggregate'],
    ]);
    expect(found[0]!.fix).toBe(
      'store only the id of Turma (primitive id or id VO in the contains of Matricula); if the field is declared, the manager adjusts the declaration',
    );
  });
});

describe('T2', () => {
  const voCode = (body: string) =>
    `class AlunoId extends ValueObject<${body}> {}`;
  test('VO extends ValueObject<{ aluno: Aluno }> viola; { valor: string } passa', () => {
    const check = (code: string) => {
      const sf = ts.createSourceFile(
        'x.ts',
        code,
        ts.ScriptTarget.Latest,
        true,
      );
      return tacticalFindings({
        sf,
        cls: sf.statements.find(ts.isClassDeclaration)!,
        owner: 'valueobject:AlunoId',
        kind: 'valueobject',
        ir: IR_FIXTURE,
      });
    };
    const bad = check(voCode('{ aluno: Aluno }'));
    expect(bad.map((f) => f.message)).toEqual([
      'T2: field aluno of the VO references the entity Aluno',
    ]);
    expect(bad[0]!.fix).toBe(
      'store only the id of Aluno; if the field or prop is declared, the manager adjusts the declaration',
    );
    expect(check(voCode('{ valor: string }'))).toEqual([]);
    expect(check('class AlunoId { #a: Item; }').map((f) => f.message)).toEqual([
      'T2: field #a of the VO references the entity Item',
    ]);
  });
});

describe('T3', () => {
  test('VO fora do contains viola (a); dentro passa', () => {
    const found = run('entity:Matricula', 'Matricula', 'preco: Dinheiro;');
    expect(found.map((f) => f.message)).toEqual([
      'T3: field preco uses the VO Dinheiro outside the contains of Matricula',
    ]);
    expect(found[0]!.fix).toBe(
      'declare Dinheiro in the contains of Matricula or change the field type; both are declarations, adjusted by the manager',
    );
    expect(msgs('entity:Pedido', 'Pedido', 'preco: Dinheiro;')).toEqual([]);
  });

  test('aluno: Aluno trocado por alunoId: AlunoId sem contains gera T3(a)', () => {
    expect(msgs('entity:Pedido', 'Pedido', 'alunoId: AlunoId;')).toEqual([
      'T3: field alunoId uses the VO AlunoId outside the contains of Pedido',
    ]);
  });

  test('filha de outro agregado viola (b) com o fix do caso', () => {
    const found = run('entity:Matricula', 'Matricula', 'linha: Linha;');
    expect(found.map((f) => f.message)).toEqual([
      'T3: field linha uses Linha, a child of another aggregate',
    ]);
    expect(found[0]!.fix).toBe(
      'store only the id of Linha or go through its root; if the field is declared, the manager adjusts the declaration',
    );
  });

  test('mesmo agregado não viola; VO só no contains da raiz viola (a)', () => {
    expect(msgs('entity:Extra', 'Extra', 'i: Item;')).toEqual([]);
    expect(msgs('entity:Pedido', 'Pedido', 'l: Linha;')).toEqual([]);
    expect(msgs('entity:Item', 'Item', 'l: Linha; e: Extra;')).toEqual([]);
    expect(msgs('entity:Item', 'Item', 'd: Dinheiro;')).toEqual([
      'T3: field d uses the VO Dinheiro outside the contains of Item',
    ]);
  });
});

describe('typeNames', () => {
  test('qualificado usa a parte direita', () => {
    const sf = ts.createSourceFile(
      'x.ts',
      'let a: ns.Aluno[];',
      ts.ScriptTarget.Latest,
      true,
    );
    const decl = (sf.statements[0] as ts.VariableStatement).declarationList
      .declarations[0]!;
    expect(typeNames(decl.type!)).toEqual(['Aluno']);
  });
});

describe('tacticalGate', () => {
  const record = (file: string) => ({
    target: class Matricula {},
    source: { file, line: 1 },
  });
  // SourceLoc à mão não passa pelo captureSource: a pasta já vem na forma canônica.
  const dir = canonicalPath(mkdtempSync(join(tmpdir(), 'tactical-')));

  test('arquivo sem decorator na linha informada: fail-closed', () => {
    const file = join(dir, 'a.ts');
    writeFileSync(file, 'class Matricula {}\n');
    const out = tacticalGate({
      ir: IR_FIXTURE,
      record: record(file),
      root: dir,
      owner: 'entity:Matricula',
      kind: 'entity',
    });
    expect(out).toEqual([
      {
        code: 'verify.tactical-class-missing',
        message: 'T: class Matricula not found in a.ts:1',
        fix: 'check the decorator on the source line',
        source: 'a.ts:1',
      },
    ]);
  });

  test('arquivo inexistente: fail-closed', () => {
    const out = tacticalGate({
      ir: IR_FIXTURE,
      record: record(join(dir, 'nao-existe.ts')),
      root: dir,
      owner: 'entity:Matricula',
      kind: 'entity',
    });
    expect(out.map((f) => f.message)).toEqual([
      'T: could not read nao-existe.ts: ENOENT',
    ]);
    expect(out[0]?.message).toContain('could not read');
  });

  test('achado usa o source relativo e a linha do campo', () => {
    const file = join(dir, 'b.ts');
    writeFileSync(
      file,
      '@AgentEntity({})\nclass Matricula {\n  a: Aluno;\n}\n',
    );
    const out = tacticalGate({
      ir: IR_FIXTURE,
      record: record(file),
      root: dir,
      owner: 'entity:Matricula',
      kind: 'entity',
    });
    expect(out.map((f) => f.source)).toEqual(['b.ts:3']);
  });
});

describe('hasTacticalElements', () => {
  test('falso para shop e orders, verdadeiro para matriculas', async () => {
    const shop = analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] });
    const orders = await compile({
      configPath: join(ROOT, 'agentic.config.ts'),
      mode: 'check',
    });
    const enrollment = analyze(defineEnrollment(), {
      root: ROOT,
      modules: [ENROLLMENT_MODULE],
    });
    expect(hasTacticalElements(shop.ir)).toBe(false);
    expect(hasTacticalElements(orders.ir!)).toBe(false);
    expect(hasTacticalElements(enrollment.ir)).toBe(true);
  });
});
