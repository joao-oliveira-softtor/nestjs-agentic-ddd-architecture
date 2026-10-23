import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { compile } from '@agentic-ddd/compiler';
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
  return tacticalFindings({ sf, cls, owner, ir: IR_FIXTURE });
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
        new RegExp(`^T1: campo ${field} guarda a raiz \\w+ de outro agregado$`),
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
      [3, 'T1: campo a guarda a raiz Turma de outro agregado'],
      [4, 'T1: campo b guarda a raiz Aluno de outro agregado'],
    ]);
    expect(found[0]!.fix).toBe(
      'guarde só o id de Turma (id primitivo ou VO de id no contains de Matricula); se o campo é declarado, o gerente ajusta a declaração',
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
        ir: IR_FIXTURE,
      });
    };
    const bad = check(voCode('{ aluno: Aluno }'));
    expect(bad.map((f) => f.message)).toEqual([
      'T2: campo aluno do VO referencia a entidade Aluno',
    ]);
    expect(bad[0]!.fix).toBe(
      'guarde só o id de Aluno; se o campo ou a prop é declarada, o gerente ajusta a declaração',
    );
    expect(check(voCode('{ valor: string }'))).toEqual([]);
    expect(check('class AlunoId { #a: Item; }').map((f) => f.message)).toEqual([
      'T2: campo #a do VO referencia a entidade Item',
    ]);
  });
});

describe('T3', () => {
  test('VO fora do contains viola (a); dentro passa', () => {
    const found = run('entity:Matricula', 'Matricula', 'preco: Dinheiro;');
    expect(found.map((f) => f.message)).toEqual([
      'T3: campo preco usa o VO Dinheiro fora do contains de Matricula',
    ]);
    expect(found[0]!.fix).toBe(
      'declare Dinheiro no contains de Matricula ou troque o tipo do campo; ambos são declaração, ajustados pelo gerente',
    );
    expect(msgs('entity:Pedido', 'Pedido', 'preco: Dinheiro;')).toEqual([]);
  });

  test('aluno: Aluno trocado por alunoId: AlunoId sem contains gera T3(a)', () => {
    expect(msgs('entity:Pedido', 'Pedido', 'alunoId: AlunoId;')).toEqual([
      'T3: campo alunoId usa o VO AlunoId fora do contains de Pedido',
    ]);
  });

  test('filha de outro agregado viola (b) com o fix do caso', () => {
    const found = run('entity:Matricula', 'Matricula', 'linha: Linha;');
    expect(found.map((f) => f.message)).toEqual([
      'T3: campo linha usa Linha, filha de outro agregado',
    ]);
    expect(found[0]!.fix).toBe(
      'guarde só o id de Linha ou passe pela raiz dela; se o campo é declarado, o gerente ajusta a declaração',
    );
  });

  test('mesmo agregado não viola; VO só no contains da raiz viola (a)', () => {
    expect(msgs('entity:Extra', 'Extra', 'i: Item;')).toEqual([]);
    expect(msgs('entity:Pedido', 'Pedido', 'l: Linha;')).toEqual([]);
    expect(msgs('entity:Item', 'Item', 'l: Linha; e: Extra;')).toEqual([]);
    expect(msgs('entity:Item', 'Item', 'd: Dinheiro;')).toEqual([
      'T3: campo d usa o VO Dinheiro fora do contains de Item',
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
  const dir = mkdtempSync(join(tmpdir(), 'tactical-'));

  test('arquivo sem decorator na linha informada: fail-closed', () => {
    const file = join(dir, 'a.ts');
    writeFileSync(file, 'class Matricula {}\n');
    const out = tacticalGate({
      ir: IR_FIXTURE,
      record: record(file),
      root: dir,
      owner: 'entity:Matricula',
    });
    expect(out).toEqual([
      {
        message: 'T: classe Matricula não encontrada em a.ts:1',
        fix: 'confira o decorator na linha do source',
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
    });
    expect(out.map((f) => f.message)).toEqual([
      'T: classe Matricula não encontrada em nao-existe.ts:1',
    ]);
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
