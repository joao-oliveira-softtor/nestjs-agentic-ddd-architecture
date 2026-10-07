import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CompileError } from '../ir';

export const ELEMENT_ID =
  /^(entity|invariant|method|event|usecase|operator):\S+$/;
export const MOTIVO_PLACEHOLDER =
  '<!-- Escreva aqui por que esta mudança existe (obrigatório). O compilador só aplica a proposta com o Motivo preenchido. -->';

const CHANGE_DIR = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;

export interface Delta {
  readonly added: string[];
  readonly modified: string[];
  readonly removed: string[];
}

// eslint-disable-next-line unicorn/no-thenable
export interface AcceptanceCriterion {
  readonly id: string;
  readonly covers: string[];
  readonly given: string | null;
  readonly when: string | null;
  readonly then: string;
  readonly manual: boolean;
}

export interface Proposal {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly status: 'proposed' | 'applied';
  readonly origin: 'proposal-first' | 'code-first';
  readonly delta: Delta;
  readonly acceptance: AcceptanceCriterion[];
  readonly motivo: string;
  readonly path: string;
  readonly archived: boolean;
  readonly raw: string;
}

export interface ParsedProposal {
  readonly proposal: Proposal | null;
  readonly errors: CompileError[];
}

export function extractMotivo(body: string): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Motivo\s*$/.test(line.trim()));
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  return (end === -1 ? rest : rest.slice(0, end))
    .join('\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
}

export function summarize(motivo: string): string {
  return (motivo.split(/\n\s*\n/)[0] ?? '').replace(/\s+/g, ' ').trim();
}

const nonEmpty = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

function stringList(
  value: unknown,
  field: string,
  err: (message: string) => void,
): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    err(`${field} deve ser uma lista de strings`);
    return [];
  }
  return value as string[];
}

export function parseProposal(
  raw: string,
  dirName: string,
  path: string,
  archived: boolean,
): ParsedProposal {
  const errors: CompileError[] = [];
  const err = (message: string): void => {
    errors.push({ message, source: path });
  };
  const dir = CHANGE_DIR.exec(dirName);
  if (!dir) {
    err(
      `nome de pasta "${dirName}" inválido (esperado NNNN-slug-em-kebab-case)`,
    );
    return { proposal: null, errors };
  }
  const match = FRONTMATTER.exec(raw);
  if (!match) {
    err('frontmatter YAML ausente (o arquivo deve começar com ---)');
    return { proposal: null, errors };
  }
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = Bun.YAML.parse(match[1]!);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('o frontmatter não é um objeto');
    data = parsed as Record<string, unknown>;
  } catch (error) {
    err(`frontmatter YAML inválido: ${(error as Error).message}`);
    return { proposal: null, errors };
  }

  const id = String(
    typeof data.id === 'string' || typeof data.id === 'number' ? data.id : '',
  );
  if (id !== dir[1])
    err(
      `id "${id}" difere do número da pasta (${dir[1]!}); escreva o id entre aspas: id: "${dir[1]!}"`,
    );
  const title = nonEmpty(data.title);
  if (!title) err('title é obrigatório');
  const status = data.status;
  if (status !== 'proposed' && status !== 'applied')
    err('status deve ser proposed ou applied');
  const origin = data.origin;
  if (origin !== 'proposal-first' && origin !== 'code-first')
    err('origin deve ser proposal-first ou code-first');

  const deltaData = (data.delta ?? {}) as Record<string, unknown>;
  const delta: Delta = {
    added: stringList(deltaData.added, 'delta.added', err),
    modified: stringList(deltaData.modified, 'delta.modified', err),
    removed: stringList(deltaData.removed, 'delta.removed', err),
  };
  for (const [field, ids] of Object.entries(delta) as [string, string[]][]) {
    for (const elementId of ids) {
      if (!ELEMENT_ID.test(elementId))
        err(
          `delta.${field}: ID inválido ${elementId} (esperado tipo:caminho, ex.: usecase:cancel_order)`,
        );
    }
  }

  const acceptance: AcceptanceCriterion[] = [];
  const acceptanceData = data.acceptance ?? [];
  if (!Array.isArray(acceptanceData)) {
    err('acceptance deve ser uma lista');
  } else {
    const seen = new Set<string>();
    acceptanceData.forEach((item: unknown, index: number) => {
      const where = `acceptance[${index}]`;
      if (item === null || typeof item !== 'object') {
        err(`${where} deve ser um objeto`);
        return;
      }
      const c = item as Record<string, unknown>;
      const criterionId = String(typeof c.id === 'string' ? c.id : '');
      if (!KEBAB.test(criterionId))
        err(`${where}: id "${criterionId}" deve ser kebab-case`);
      else if (seen.has(criterionId))
        err(`${where}: id "${criterionId}" repetido`);
      seen.add(criterionId);
      const manual = c.manual === true;
      const covered = stringList(c.covers, `${where}.covers`, err);
      for (const elementId of covered) {
        if (!ELEMENT_ID.test(elementId))
          err(`${where}.covers: ID inválido ${elementId}`);
      }
      const given = nonEmpty(c.given);
      const when = nonEmpty(c.when);
      // eslint-disable-next-line unicorn/no-thenable
      const then = nonEmpty(c.then);
      if (!then) err(`${where}: then é obrigatório`);
      if (!manual) {
        if (covered.length === 0)
          err(`${where}: critério automático precisa de covers`);
        if (!given || !when)
          err(`${where}: critério automático precisa de given e when`);
      }
      // eslint-disable-next-line unicorn/no-thenable
      acceptance.push({
        id: criterionId,
        covers: covered,
        given,
        when,
        // eslint-disable-next-line unicorn/no-thenable
        then: then ?? '',
        manual,
      });
    });
  }

  if (errors.length > 0) return { proposal: null, errors };
  return {
    proposal: {
      id,
      slug: dir[2]!,
      title: title!,
      status: status as Proposal['status'],
      origin: origin as Proposal['origin'],
      delta,
      acceptance,
      motivo: extractMotivo(match[2]!),
      path,
      archived,
      raw,
    },
    errors,
  };
}

export async function listProposals(
  changesAbs: string,
  changesRel: string,
): Promise<{ proposals: Proposal[]; errors: CompileError[] }> {
  const proposals: Proposal[] = [];
  const errors: CompileError[] = [];
  const scan = async (
    dirAbs: string,
    dirRel: string,
    archived: boolean,
  ): Promise<void> => {
    let names: string[];
    try {
      names = (await readdir(dirAbs, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name !== 'archive')
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return;
      }
      throw error;
    }
    for (const name of names) {
      let raw: string;
      try {
        raw = await readFile(join(dirAbs, name, 'proposal.md'), 'utf8');
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          errors.push({
            message: 'proposal.md ausente',
            source: `${dirRel}/${name}`,
          });
          continue;
        }
        throw error;
      }
      const parsed = parseProposal(
        raw,
        name,
        `${dirRel}/${name}/proposal.md`,
        archived,
      );
      errors.push(...parsed.errors);
      if (parsed.proposal) proposals.push(parsed.proposal);
    }
  };
  await scan(changesAbs, changesRel, false);
  await scan(join(changesAbs, 'archive'), `${changesRel}/archive`, true);
  const byNumber = new Map<string, string>();
  for (const proposal of proposals) {
    const previous = byNumber.get(proposal.id);
    if (previous)
      errors.push({
        message: `número ${proposal.id} repetido (também em ${previous})`,
        source: proposal.path,
      });
    else byNumber.set(proposal.id, proposal.path);
  }
  return { proposals, errors };
}

export function nextChangeId(
  proposals: readonly Pick<Proposal, 'id'>[],
): string {
  const max = proposals.reduce(
    (current, proposal) => Math.max(current, Number(proposal.id)),
    0,
  );
  return String(max + 1).padStart(4, '0');
}

export function renderDraft(input: {
  readonly id: string;
  readonly slug: string;
  readonly delta: Delta;
}): string {
  const list = (ids: readonly string[]): string =>
    ids.length === 0
      ? ' []'
      : `\n${ids.map((id) => `    - ${JSON.stringify(id)}`).join('\n')}`;
  return [
    '---',
    `id: ${JSON.stringify(input.id)}`,
    `title: ${JSON.stringify(input.slug.replaceAll('-', ' '))}`,
    'status: proposed',
    'origin: code-first',
    'delta:',
    `  added:${list(input.delta.added)}`,
    `  modified:${list(input.delta.modified)}`,
    `  removed:${list(input.delta.removed)}`,
    'acceptance: []',
    '---',
    '',
    '## Motivo',
    '',
    MOTIVO_PLACEHOLDER,
    '',
  ].join('\n');
}

export function markApplied(raw: string): string {
  const match = FRONTMATTER.exec(raw);
  if (!match) {
    throw new Error('markApplied: frontmatter não encontrado');
  }

  const frontmatter = match[1]!;
  const newFrontmatter = frontmatter.replace(
    /^status:[ \t]*(["']?)proposed\1[ \t]*(#.*)?$/m,
    'status: applied',
  );

  if (newFrontmatter === frontmatter) {
    throw new Error(
      'markApplied: linha "status: proposed" não encontrada no frontmatter',
    );
  }

  const yamlStart = raw.indexOf(frontmatter);
  const yamlEnd = yamlStart + frontmatter.length;
  return raw.substring(0, yamlStart) + newFrontmatter + raw.substring(yamlEnd);
}
