import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface Solution {
  file?: string;
  /** One body per `notImplemented()` slot of the file, in source order. */
  bodies?: string[];
  test: string;
}

const vo = (cls: string, code: string, label: string, bad: string) => ({
  bodies: [
    `if (!valor.trim()) throw new DomainError('${code}', 'Id de ${label} vazio.');\nreturn new ${cls}({ valor });`,
  ],
  test: `import { expect, test } from 'bun:test';
import { covers } from '@agentic-ddd/testing';
import { ${cls} } from '../domain/${cls === 'AlunoId' ? 'aluno-id' : 'turma-id'}';
test(covers(['valueobject:${cls}', 'invariant:${cls}/${bad}', 'criterion:0001/ids-invalidos'], 'rejeita vazio e compara por valor'), () => {
  expect(() => ${cls}.criar('')).toThrow('Id de ${label} vazio.');
  expect(${cls}.criar('x').props.valor).toBe('x');
  expect(${cls}.criar('x').equals(${cls}.criar('x'))).toBe(true);
  expect(${cls}.criar('x').equals(${cls}.criar('y'))).toBe(false);
});`,
});

export const SOLUTIONS: Record<string, Solution> = {
  'valueobject:AlunoId': {
    file: 'domain/aluno-id.ts',
    ...vo('AlunoId', 'ALUNO_ID_VAZIO', 'aluno', 'aluno-id-nao-vazio'),
  },
  'valueobject:TurmaId': {
    file: 'domain/turma-id.ts',
    ...vo('TurmaId', 'TURMA_ID_VAZIO', 'turma', 'turma-id-nao-vazio'),
  },
  'entity:Aluno': {
    file: 'domain/aluno.ts',
    bodies: [
      "const limpo = nome.trim();\nif (!limpo) throw new DomainError('ALUNO_NOME_OBRIGATORIO', 'Nome obrigatório.');\nreturn new Aluno(id.props.valor, id, limpo, status);",
    ],
    test: `import { expect, test } from 'bun:test';
import { covers } from '@agentic-ddd/testing';
import { Aluno } from '../domain/aluno';
import { AlunoId } from '../domain/aluno-id';
test(covers(['method:Aluno.criar', 'invariant:Aluno/nome-obrigatorio', 'criterion:0001/aluno-e-turma'], 'cria aluno e rejeita nome vazio'), () => {
  const aluno = Aluno.criar(AlunoId.criar('a1'), '  Ana  ', 'inativo');
  expect([aluno.id, aluno.nome, aluno.status]).toEqual(['a1', 'Ana', 'inativo']);
  expect(aluno.alunoId.equals(AlunoId.criar('a1'))).toBe(true);
  for (const nome of ['', '   ']) expect(() => Aluno.criar(AlunoId.criar('a1'), nome, 'ativo')).toThrow('Nome obrigatório.');
});`,
  },
  'entity:Turma': {
    file: 'domain/turma.ts',
    bodies: [
      "if (!(vagas >= 1)) throw new DomainError('TURMA_VAGAS_INVALIDAS', 'Vagas inválidas.');\nreturn new Turma(id.props.valor, id, vagas);",
    ],
    test: `import { expect, test } from 'bun:test';
import { covers } from '@agentic-ddd/testing';
import { Turma } from '../domain/turma';
import { TurmaId } from '../domain/turma-id';
test(covers(['method:Turma.criar', 'invariant:Turma/vagas-positivas', 'criterion:0001/aluno-e-turma'], 'cria turma e rejeita menos de uma vaga'), () => {
  const turma = Turma.criar(TurmaId.criar('t1'), 2);
  expect([turma.id, turma.vagas]).toEqual(['t1', 2]);
  expect(turma.turmaId.equals(TurmaId.criar('t1'))).toBe(true);
  for (const vagas of [0, -1]) expect(() => Turma.criar(TurmaId.criar('t1'), vagas)).toThrow('Vagas inválidas.');
});`,
  },
  'entity:Matricula': {
    file: 'domain/matricula.ts',
    bodies: [
      'const matricula = new Matricula(`${aluno.id}:${turma.id}`);\nmatricula.alunoId = aluno.alunoId;\nmatricula.turmaId = turma.turmaId;\nreturn matricula;',
    ],
    test: `import { expect, test } from 'bun:test';
import { covers } from '@agentic-ddd/testing';
import { Aluno } from '../domain/aluno';
import { AlunoId } from '../domain/aluno-id';
import { Matricula } from '../domain/matricula';
import { Turma } from '../domain/turma';
import { TurmaId } from '../domain/turma-id';
test(covers(['method:Matricula.criar', 'invariant:Matricula/guarda-ids', 'criterion:0001/matricula-guarda-ids'], 'guarda só os ids'), () => {
  const aluno = Aluno.criar(AlunoId.criar('a1'), 'Ana', 'ativo');
  const turma = Turma.criar(TurmaId.criar('t1'), 2);
  const matricula = Matricula.criar(aluno, turma);
  expect(matricula.alunoId.equals(aluno.alunoId)).toBe(true);
  expect(matricula.turmaId.equals(turma.turmaId)).toBe(true);
  expect(Object.values(matricula).some(v => v instanceof Aluno || v instanceof Turma)).toBe(false);
});`,
  },
  'usecase:matricular_aluno': {
    file: 'application/matricular-aluno.ts',
    bodies: [
      `const aluno = await this.alunos.findById(AlunoId.criar(input.aluno_id));
if (!aluno) throw new DomainError('ALUNO_NAO_ENCONTRADO', 'Aluno não encontrado.');
const turma = await this.turmas.findById(TurmaId.criar(input.turma_id));
if (!turma) throw new DomainError('TURMA_NAO_ENCONTRADA', 'Turma não encontrada.');
if (aluno.status !== 'ativo') throw new DomainError('ALUNO_INATIVO', 'Aluno inativo.');
if ((await this.matriculas.contarPorTurma(turma.turmaId)) >= turma.vagas) throw new DomainError('TURMA_CHEIA', 'Turma cheia.');
const matricula = Matricula.criar(aluno, turma);
await this.matriculas.save(matricula);
return { matricula_id: matricula.id };






`,
    ],
    test: `import { expect, test } from 'bun:test';
import { covers, createTestContext } from '@agentic-ddd/testing';
import { MatricularAluno } from '../application/matricular-aluno';
import { Aluno } from '../domain/aluno';
import { AlunoId } from '../domain/aluno-id';
import type { Matricula } from '../domain/matricula';
import { Turma } from '../domain/turma';
import { TurmaId } from '../domain/turma-id';
const setup = (status: 'ativo' | 'inativo', ocupadas: number) => {
  const aluno = Aluno.criar(AlunoId.criar('a1'), 'Ana', status);
  const turma = Turma.criar(TurmaId.criar('t1'), 2);
  const salvas: Matricula[] = [];
  const uc = new MatricularAluno(
    { save: async (m) => { salvas.push(m); }, contarPorTurma: async () => ocupadas },
    { findById: async () => aluno },
    { findById: async () => turma },
  );
  return { uc, salvas, turma };
};
const input = { aluno_id: 'a1', turma_id: 't1' };
test(covers(['usecase:matricular_aluno', 'criterion:0001/turma-cheia', 'invariant:matricular_aluno/turma-com-vaga'], 'recusa turma cheia e salva uma matrícula quando há vaga'), async () => {
  const cheia = setup('ativo', 2);
  await expect(cheia.uc.execute(input, createTestContext())).rejects.toMatchObject({ code: 'TURMA_CHEIA' });
  expect(cheia.salvas).toHaveLength(0);
  const livre = setup('ativo', 1);
  const out = await livre.uc.execute(input, createTestContext());
  expect(livre.salvas).toHaveLength(1);
  expect(out.matricula_id).toBe(livre.salvas[0]!.id);
  expect(livre.turma.vagas).toBe(2);
});
test(covers(['usecase:matricular_aluno', 'criterion:0001/aluno-inativo', 'invariant:matricular_aluno/aluno-ativo'], 'recusa aluno inativo'), async () => {
  const s = setup('inativo', 0);
  await expect(s.uc.execute(input, createTestContext())).rejects.toMatchObject({ code: 'ALUNO_INATIVO' });
  expect(s.salvas).toHaveLength(0);
});`,
  },
  'adapter:InMemoryMatriculaRepository': {
    file: 'infrastructure/in-memory-matricula.repository.ts',
    bodies: [
      'this.#matriculas.push(matricula);',
      'return this.#matriculas.filter((m) => m.turmaId.equals(turmaId)).length;',
    ],
    test: `import { expect, test } from 'bun:test';
import { covers } from '@agentic-ddd/testing';
import { Aluno } from '../domain/aluno';
import { AlunoId } from '../domain/aluno-id';
import { Matricula } from '../domain/matricula';
import { Turma } from '../domain/turma';
import { TurmaId } from '../domain/turma-id';
import { InMemoryMatriculaRepository } from '../infrastructure/in-memory-matricula.repository';
test(covers(['port:MatriculaRepository.save', 'port:MatriculaRepository.contarPorTurma'], 'grava e conta só as matrículas da turma'), async () => {
  const repo = new InMemoryMatriculaRepository();
  const aluno = Aluno.criar(AlunoId.criar('a1'), 'Ana', 'ativo');
  const t1 = Turma.criar(TurmaId.criar('t1'), 5);
  const t2 = Turma.criar(TurmaId.criar('t2'), 5);
  expect(await repo.contarPorTurma(t1.turmaId)).toBe(0);
  await repo.save(Matricula.criar(aluno, t1));
  await repo.save(Matricula.criar(aluno, t2));
  await repo.save(Matricula.criar(aluno, t2));
  expect(await repo.contarPorTurma(t1.turmaId)).toBe(1);
  expect(await repo.contarPorTurma(t2.turmaId)).toBe(2);
});`,
  },
};

/** Writes the reference body (or `solution`, e.g. a planted wrong one) and the executor test of one item. */
export async function completeItem(
  root: string,
  id: string,
  solution: Solution | undefined = SOLUTIONS[id],
) {
  if (!solution) throw new Error(`No solution: ${id}`);
  if (solution.file) {
    const path = join(root, 'app', solution.file);
    let before = await readFile(path, 'utf8');
    const slot = /\{\s*return notImplemented\(\);\s*\}/;
    for (const body of solution.bodies!) {
      const pending = slot.exec(before)?.[0];
      if (!pending) throw new Error(`No pending body for ${id}`);
      const expanded = `{\n${body}\n}`;
      const spare =
        (pending.match(/\n/g) ?? []).length -
        (expanded.match(/\n/g) ?? []).length;
      if (spare < 0)
        throw new Error(`Body of ${id} needs ${-spare} more lines`);
      before = before.replace(
        pending,
        () => expanded.slice(0, -1) + '\n'.repeat(spare) + '}',
      );
    }
    await writeFile(path, before);
  }
  await mkdir(join(root, 'app/test'), { recursive: true });
  await writeFile(
    join(root, 'app/test', id.replaceAll(/[:.]/g, '-') + '.test.ts'),
    solution.test + '\n',
  );
}
