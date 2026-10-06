import { stableStringify } from '../canonical.js';
import type { IR, IREntity, IROperator, IRUseCase } from '../ir.js';
import { GENERATED_HEADER, frontmatter } from './frontmatter.js';
import {
  code,
  guardedBy,
  idList,
  parameterRows,
  stripKind,
  table,
} from './markdown.js';
import { renderStateMachine } from './state-machine.js';

export function relatedEntities(
  ir: IR,
  useCases: readonly IRUseCase[],
): IREntity[] {
  const names = new Set(
    useCases.flatMap((u) => u.uses.map((m) => stripKind(m).split('.')[0]!)),
  );
  return ir.entities.filter((e) => names.has(e.name));
}

export function renderRuntimeSkill(
  ir: IR,
  operator: IROperator,
  hash: string,
): Map<string, string> {
  const useCases = operator.useCases
    .map((id) => ir.useCases.find((u) => u.id === id))
    .filter((u): u is IRUseCase => u !== undefined);
  const entities = relatedEntities(ir, useCases);

  const lines: string[] = [
    frontmatter({
      name: operator.name,
      description: operator.description,
      audience: 'runtime',
      irHash: hash,
    }),
    GENERATED_HEADER(operator.source),
    '',
    `# Operator ${code(operator.name)}`,
    '',
    operator.description,
    '',
    '## Tools',
    '',
  ];
  for (const useCase of useCases) {
    lines.push(
      `### ${code(useCase.name)}`,
      '',
      useCase.description,
      '',
      `- **Quando usar:** ${useCase.whenToUse}`,
    );
    if (useCase.whenNotToUse)
      lines.push(`- **Quando não usar:** ${useCase.whenNotToUse}`);
    lines.push(
      `- **Aciona:** ${idList(useCase.uses)}`,
      `- **Emite:** ${idList(useCase.emits)}`,
      `- **Exige aprovação humana:** ${operator.requiresApproval.includes(useCase.id) ? 'sim' : 'não'}`,
      '',
    );
    const rows = parameterRows(useCase.inputSchema);
    lines.push(
      rows.length > 0
        ? table(['Parâmetro', 'Tipo', 'Obrigatório', 'Descrição'], rows)
        : '_Sem parâmetros._',
      '',
    );
  }

  const invariants = entities.flatMap((e) =>
    e.invariants.map((i) => [code(i.id), i.text, guardedBy(i.on)]),
  );
  if (invariants.length > 0)
    lines.push(
      '## Regras de negócio',
      '',
      table(['Invariante', 'Regra', 'Garantida por'], invariants),
      '',
    );

  const transitions = entities.flatMap((e) =>
    e.methods
      .filter((m) => m.transition !== null)
      .map((m) => [
        code(stripKind(m.id)),
        m.transition!.from.map(code).join(', '),
        code(m.transition!.to),
      ]),
  );
  if (transitions.length > 0)
    lines.push(
      '## Estados e transições',
      '',
      table(['Método', 'De', 'Para'], transitions),
      '',
    );

  lines.push(
    'Detalhes: [schemas das tools](references/tools.schema.json) · [máquina de estados](references/state-machine.md)',
    '',
  );

  const tools = Object.fromEntries(
    useCases.map((u) => [
      u.name,
      { input: u.inputSchema, output: u.outputSchema },
    ]),
  );
  return new Map([
    ['SKILL.md', lines.join('\n')],
    [
      'references/state-machine.md',
      renderStateMachine(entities, operator.source),
    ],
    ['references/tools.schema.json', stableStringify(tools)],
  ]);
}
