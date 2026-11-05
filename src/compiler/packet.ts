import { stableStringify } from './canonical';
import { AgenticError } from './ir';
import { itemSpecification, type ItemSpecification } from './item-spec';
import { collectStatus, stateContext } from './project-state';
import type { WorkItemStatus } from './state';

export interface PacketOptions {
  readonly configPath: string;
  readonly item: string;
  /** Lê declarações de teste sem executá-los; nunca certifica `done`. */
  readonly static?: boolean;
}
export const isClassScopeItem = (id: string): boolean =>
  /^(valueobject|adapter):/.test(id);

export const shellQuote = (value: string): string =>
  /^[a-zA-Z0-9_./:-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;

export function renderPacket(
  item: WorkItemStatus,
  specification: ItemSpecification,
  configPath: string,
  mode: 'dynamic' | 'static' = 'dynamic',
): string {
  const state =
    mode === 'static'
      ? `${item.baseState} (static: tests not run; never certifies done)`
      : item.state === 'blocked'
        ? `blocked(${item.baseState})`
        : item.state;
  return [
    '# Identification',
    '',
    `- ID: \`${item.id}\``,
    `- Layer: ${item.layer}`,
    `- Module: ${item.module}`,
    `- source: \`${item.source}\``,
    `- State: ${state}`,
    `- specHash: \`${item.specHash}\``,
    `- Dependencies: ${item.dependsOn.map((id) => `\`${id}\``).join(', ') || '—'}`,
    '',
    '## Specification',
    '',
    'Declaration, construction rules and referenced contracts:',
    '',
    '```json',
    stableStringify({
      declaration: specification.declaration,
      contracts: specification.contracts,
    }).trimEnd(),
    '```',
    '',
    '## Test obligations',
    '',
    ...specification.obligations.map(
      (id) => `- \`${id}\` — test with \`covers\`.`,
    ),
    ...specification.criteria.flatMap((c) => [
      '',
      `### ${c.obligation}`,
      '',
      `Given: ${c.given}`,
      `When: ${c.when}`,
      `Then: ${c.then}`,
    ]),
    '',
    '## Executor rules',
    '',
    isClassScopeItem(item.id)
      ? "- Change only the bodies and #private members of this item's class (same number of lines) and test files. Do not change extends/implements or the public signature."
      : "- Change only this item's body and test files.",
    '- Do not change decorators, declarations, proposals or generated files.',
    '- Do not implement other items. Preserve the contracts and invariant IDs.',
    '',
    '## Verification command',
    '',
    '```bash',
    `bun run agentic verify --item ${shellQuote(item.id)} --spec-hash ${item.specHash} --config ${shellQuote(configPath)} --json`,
    '```',
    '',
  ].join('\n');
}

export async function packet(options: PacketOptions): Promise<string> {
  const context = await stateContext(options.configPath);
  const staticMode = options.static === true;
  const item = (
    await collectStatus(context, staticMode, !staticMode)
  ).items.find((i) => i.id === options.item);
  if (!item)
    throw new AgenticError(
      'state.item-not-found',
      `work item ${options.item} not found`,
    );
  return renderPacket(
    item,
    itemSpecification(context.project.ir, item, context.proposals),
    options.configPath,
    staticMode ? 'static' : 'dynamic',
  );
}
