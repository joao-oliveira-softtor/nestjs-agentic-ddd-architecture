import { stableStringify } from '../canonical';
import type { IR, IREntity, IROperator, IRUseCase } from '../ir';
import { GENERATED_HEADER, frontmatter } from './frontmatter';
import {
  code,
  guardedBy,
  idList,
  parameterRows,
  stripKind,
  table,
} from './markdown';
import { renderStateMachine } from './state-machine';

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
    'Tools marked **Requires human approval: yes** run only after a person approves them; if approval is denied, the tool returns the `approval_denied` error and nothing is changed.',
    '',
  ];
  for (const useCase of useCases) {
    lines.push(
      `### ${code(useCase.name)}`,
      '',
      useCase.description,
      '',
      `- **When to use:** ${useCase.whenToUse}`,
    );
    if (useCase.whenNotToUse)
      lines.push(`- **When not to use:** ${useCase.whenNotToUse}`);
    lines.push(
      `- **Triggers:** ${idList(useCase.uses)}`,
      `- **Emits:** ${idList(useCase.emits)}`,
      `- **Requires human approval:** ${operator.requiresApproval.includes(useCase.id) ? 'yes' : 'no'}`,
      '',
    );
    const rows = parameterRows(useCase.inputSchema);
    lines.push(
      rows.length > 0
        ? table(['Parameter', 'Type', 'Required', 'Description'], rows)
        : '_No parameters._',
      '',
      `Full schema (constraints, nested fields and output): \`references/tools.schema.json\` → \`${useCase.name}\`.`,
      '',
    );
  }

  const invariants = entities.flatMap((e) =>
    e.invariants.map((i) => [code(i.id), i.text, guardedBy(i.on)]),
  );
  if (invariants.length > 0)
    lines.push(
      '## Business rules',
      '',
      table(['Invariant', 'Rule', 'Guaranteed by'], invariants),
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
      '## States and transitions',
      '',
      table(['Method', 'From', 'To'], transitions),
      '',
    );

  lines.push(
    'Details: [tool schemas](references/tools.schema.json) · [state machine](references/state-machine.md)',
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
