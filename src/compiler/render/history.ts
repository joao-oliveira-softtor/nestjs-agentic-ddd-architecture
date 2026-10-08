import { posix } from 'node:path';
import type { DiffItem } from '../diff';
import type { IR, IRModule } from '../ir';
import type { LockChange } from '../lock';
import { GENERATED_HEADER } from './frontmatter';
import { code, table } from './markdown';

const HEADERS = ['Change', 'Título', 'Mudanças', 'Motivo'];

function entityOf(id: string): string | null {
  const match =
    /^(?:entity:([^/.]+)$|invariant:([^/]+)\/|method:([^.]+)\.)/.exec(id);
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}

export function renderHistory(
  ir: IR,
  module: IRModule,
  changes: readonly LockChange[],
  historyPath: string,
): string {
  const lines = [
    GENERATED_HEADER(module.path),
    '',
    `# Histórico do módulo ${code(module.name)}`,
    '',
  ];
  const relevant = changes
    .map((change) => ({
      change,
      items: change.items.filter((item) => item.module === module.name),
    }))
    .filter((entry) => entry.items.length > 0);
  if (relevant.length === 0) {
    lines.push('_Nenhuma mudança registrada._', '');
    return lines.join('\n');
  }
  const link = (change: LockChange): string =>
    `[${change.id}](${posix.relative(posix.dirname(historyPath), change.path)})`;
  const rowsFor = (predicate: (item: DiffItem) => boolean): string[][] =>
    relevant
      .map(({ change, items }) => ({ change, items: items.filter(predicate) }))
      .filter((entry) => entry.items.length > 0)
      .map(({ change, items }) => [
        link(change),
        change.title,
        items
          .map(
            (item) => `${item.kind} ${code(item.id)} (${item.classification})`,
          )
          .join('; '),
        change.summary || '—',
      ]);

  const entities = [
    ...new Set([
      ...ir.entities
        .filter((entity) => entity.module === module.name)
        .map((entity) => entity.name),
      ...relevant.flatMap(({ items }) =>
        items
          .map((item) => entityOf(item.id))
          .filter((name): name is string => name !== null),
      ),
    ]),
  ].sort();
  for (const name of entities) {
    const rows = rowsFor((item) => entityOf(item.id) === name);
    lines.push(
      `## ${name}`,
      '',
      rows.length > 0 ? table(HEADERS, rows) : '_Nenhuma mudança registrada._',
      '',
    );
  }
  const others = rowsFor((item) => entityOf(item.id) === null);
  if (others.length > 0)
    lines.push(
      '## Eventos, use-cases e operators',
      '',
      table(HEADERS, others),
      '',
    );
  return lines.join('\n');
}
