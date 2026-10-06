import type { IREntity } from '../ir.js';
import { GENERATED_HEADER } from './frontmatter.js';
import { code, idList, stripKind, table } from './markdown.js';

export function renderStateMachine(
  entities: readonly IREntity[],
  source: string,
): string {
  const lines: string[] = [
    GENERATED_HEADER(source),
    '',
    '# Máquina de estados',
    '',
  ];
  for (const entity of entities) {
    lines.push(
      `## ${entity.name}`,
      '',
      `Estados: ${entity.states.length > 0 ? entity.states.map(code).join(', ') : '—'}`,
      '',
    );
    const rows = entity.methods
      .filter((m) => m.transition !== null)
      .map((m) => [
        code(stripKind(m.id)),
        m.transition!.from.map(code).join(', '),
        code(m.transition!.to),
        idList(m.emits),
      ]);
    lines.push(
      rows.length > 0
        ? table(['Método', 'De', 'Para', 'Emite'], rows)
        : '_Sem transições declaradas._',
      '',
    );
  }
  return lines.join('\n');
}
