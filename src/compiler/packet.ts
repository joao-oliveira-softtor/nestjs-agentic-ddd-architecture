import { stableStringify } from './canonical';
import { itemSpecification, type ItemSpecification } from './item-spec';
import { collectStatus, stateContext } from './project-state';
import type { WorkItemStatus } from './state';

export interface PacketOptions {
  readonly configPath: string;
  readonly item: string;
}
export const shellQuote = (value: string): string =>
  /^[a-zA-Z0-9_./:-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;

export function renderPacket(
  item: WorkItemStatus,
  specification: ItemSpecification,
  configPath: string,
): string {
  const state =
    item.state === 'blocked' ? `blocked(${item.baseState})` : item.state;
  return [
    '# Identificação',
    '',
    `- ID: \`${item.id}\``,
    `- Camada: ${item.layer}`,
    `- Módulo: ${item.module}`,
    `- source: \`${item.source}\``,
    `- Estado: ${state}`,
    `- specHash: \`${item.specHash}\``,
    `- Dependências: ${item.dependsOn.map((id) => `\`${id}\``).join(', ') || '—'}`,
    '',
    '## Especificação',
    '',
    'Declaração, regras de construção e contratos referenciados:',
    '',
    '```json',
    stableStringify({
      declaration: specification.declaration,
      contracts: specification.contracts,
    }).trimEnd(),
    '```',
    '',
    '## Obrigações de teste',
    '',
    ...specification.obligations.map(
      (id) => `- \`${id}\` — teste com \`covers\`.`,
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
    '## Regras do executor',
    '',
    '- Altere só o corpo deste item e arquivos de teste.',
    '- Não altere decorators, declarações, propostas nem arquivos gerados.',
    '- Não implemente outros itens. Preserve os contratos e IDs de invariantes.',
    '',
    '## Comando de verificação',
    '',
    '```bash',
    `bun run agentic verify --item ${shellQuote(item.id)} --spec-hash ${item.specHash} --config ${shellQuote(configPath)} --json`,
    '```',
    '',
  ].join('\n');
}

export async function packet(options: PacketOptions): Promise<string> {
  const context = await stateContext(options.configPath);
  const item = (await collectStatus(context)).items.find(
    (i) => i.id === options.item,
  );
  if (!item) throw new Error(`work item ${options.item} não encontrado`);
  return renderPacket(
    item,
    itemSpecification(context.project.ir, item, context.proposals),
    options.configPath,
  );
}
