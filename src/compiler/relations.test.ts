import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { defineOrdering, ORDERING_MODULE } from './__fixtures__/pedido';
import { defineEnrollment, ENROLLMENT_MODULE } from './__fixtures__/matriculas';
import { analyze } from './analyze';
import { aggregateRoots, workItems } from './graph';
import { itemSpecification } from './item-spec';
import { renderPacket } from './packet';
import { evaluateStatus, waves } from './state';
import { relationWarnings } from './validate';

const root = resolve(import.meta.dir, '../..');
const build = (
  registry: ReturnType<typeof defineOrdering>,
  module: typeof ORDERING_MODULE | typeof ENROLLMENT_MODULE,
) => {
  const { ir, errors } = analyze(registry, { root, modules: [module] });
  const report = evaluateStatus({
    ir,
    implemented: new Map(),
    proposals: [],
    mode: 'dynamic',
    evidence: { exitCode: 0, cases: [] },
  });
  return { registry, ir, errors, report };
};
const ordering = build(defineOrdering(), ORDERING_MODULE);
const enrollment = build(defineEnrollment(), ENROLLMENT_MODULE);

const contractIds = ({ ir, report }: typeof ordering, id: string) => {
  const item = report.items.find((i) => i.id === id)!;
  return (itemSpecification(ir, item, []).contracts as { id: string }[]).map(
    (c) => c.id,
  );
};

test('ondas do pedido seguem contains, com nada implementado', () => {
  expect(waves(ordering.report).waves).toEqual([
    ['valueobject:Dinheiro', 'valueobject:Quantidade'],
    ['entity:ItemDoPedido'],
    ['entity:Pedido'],
    ['method:Pedido.adicionarItem'],
  ]);
});

test('matrículas: ciclo de references é aceito e não vira dependência', () => {
  expect(enrollment.errors).toEqual([]);
  const matricula = workItems(enrollment.ir).find(
    (i) => i.id === 'entity:Matricula',
  )!;
  expect(matricula.dependsOn).toEqual([
    'valueobject:AlunoId',
    'valueobject:TurmaId',
  ]);
  expect([...aggregateRoots(enrollment.ir)].sort()).toEqual([
    'entity:Aluno',
    'entity:Matricula',
    'entity:Turma',
  ]);
});

test('packets trazem os contratos das entidades relacionadas', () => {
  expect(contractIds(enrollment, 'entity:Matricula')).toEqual(
    expect.arrayContaining([
      'entity:Aluno',
      'entity:Turma',
      'valueobject:AlunoId',
      'valueobject:TurmaId',
    ]),
  );
  const matricula = enrollment.report.items.find(
    (i) => i.id === 'entity:Matricula',
  )!;
  const packet = renderPacket(
    matricula,
    itemSpecification(enrollment.ir, matricula, []),
    'agentic.config.ts',
  );
  expect(packet).toContain('entity:Aluno');
  expect(packet).toContain('entity:Turma');
  expect(contractIds(ordering, 'method:Pedido.adicionarItem')).toEqual(
    expect.arrayContaining(['entity:ItemDoPedido', 'valueobject:Dinheiro']),
  );
});

test('sem avisos de relação nem erros de compilação nas duas fixtures', () => {
  for (const f of [ordering, enrollment]) {
    expect(relationWarnings(f.ir, f.registry)).toEqual([]);
    expect(f.errors).toEqual([]);
  }
});
