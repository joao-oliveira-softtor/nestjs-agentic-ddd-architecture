import { posix } from 'node:path';
import type { DiffItem } from '../diff';
import type { IR, IRModule } from '../ir';
import type { LockChange } from '../lock';
import { GENERATED_HEADER } from './frontmatter';
import { code, table } from './markdown';

// "Motivo" matches the `## Motivo` section the proposal parser requires.
const HEADERS = ['Change', 'Title', 'Changes', 'Motivo'];

function entityOf(id: string): string | null {
  // dono snake_case = use-case (validate.ts garante PascalCase em entidade), vale também para item já removido
  if (/^invariant:[a-z]/.test(id)) return null;
  const match =
    /^(?:entity:([^/.]+)$|valueobject:([^/.]+)$|invariant:([^/]+)\/|method:([^.]+)\.)/.exec(
      id,
    );
  return match ? (match[1] ?? match[2] ?? match[3] ?? match[4] ?? null) : null;
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
    `# Module ${code(module.name)} history`,
    '',
  ];
  const relevant = changes
    .map((change) => ({
      change,
      items: change.items.filter((item) => item.module === module.name),
    }))
    .filter((entry) => entry.items.length > 0);
  if (relevant.length === 0) {
    lines.push('_No changes recorded._', '');
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
      ...(ir.valueObjects ?? [])
        .filter((vo) => vo.module === module.name)
        .map((vo) => vo.name),
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
      rows.length > 0 ? table(HEADERS, rows) : '_No changes recorded._',
      '',
    );
  }
  const others = rowsFor((item) => entityOf(item.id) === null);
  if (others.length > 0)
    lines.push(
      '## Events, use-cases and operators',
      '',
      table(HEADERS, others),
      '',
    );
  return lines.join('\n');
}
