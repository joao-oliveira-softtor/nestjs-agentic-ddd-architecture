import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MOTIVO_PLACEHOLDER,
  extractMotivo,
  listProposals,
  markApplied,
  nextChangeId,
  parseProposal,
  renderDraft,
  summarize,
} from './proposal';

const VALID = `---
id: "0002"
title: Cancelamento exige motivo
status: proposed
origin: proposal-first
delta:
  added:
    - "invariant:Order/cancelamento-exige-motivo"
  modified:
    - "usecase:cancel_order"
  removed: []
acceptance:
  - id: rejeita-cancelamento-sem-motivo
    covers: ["invariant:Order/cancelamento-exige-motivo"]
    given: pedido pendente
    when: cancelar sem informar motivo
    then: falha com CANCELLATION_REASON_REQUIRED
  - id: revisao-de-copy
    manual: true
    then: mensagem revisada pelo produto
---

## Motivo

O atendimento precisa saber por que o pedido foi cancelado.

Segundo parágrafo com detalhes.
`;

const PATH = 'changes/0002-cancelamento-exige-motivo/proposal.md';
const parse = (raw: string, dir = '0002-cancelamento-exige-motivo') =>
  parseProposal(raw, dir, PATH, false);
const messages = (raw: string, dir?: string) =>
  parse(raw, dir).errors.map((e) => e.message);

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agentic-changes-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parseProposal', () => {
  test('lê uma proposta válida', () => {
    const { proposal, errors } = parse(VALID);
    expect(errors).toEqual([]);
    expect(proposal).toMatchObject({
      id: '0002',
      slug: 'cancelamento-exige-motivo',
      title: 'Cancelamento exige motivo',
      status: 'proposed',
      origin: 'proposal-first',
      delta: {
        added: ['invariant:Order/cancelamento-exige-motivo'],
        modified: ['usecase:cancel_order'],
        removed: [],
      },
      path: PATH,
      archived: false,
    });
    // eslint-disable-next-line unicorn/no-thenable
    expect(proposal!.acceptance).toEqual(
      // eslint-disable-next-line unicorn/no-thenable
      [
        {
          id: 'rejeita-cancelamento-sem-motivo',
          covers: ['invariant:Order/cancelamento-exige-motivo'],
          given: 'pedido pendente',
          when: 'cancelar sem informar motivo',
          // eslint-disable-next-line unicorn/no-thenable
          then: 'falha com CANCELLATION_REASON_REQUIRED',
          manual: false,
        },
        // eslint-disable-next-line unicorn/no-thenable
        {
          id: 'revisao-de-copy',
          covers: [],
          given: null,
          when: null,
          // eslint-disable-next-line unicorn/no-thenable
          then: 'mensagem revisada pelo produto',
          manual: true,
        },
      ],
    );
    expect(proposal!.motivo).toBe(
      'O atendimento precisa saber por que o pedido foi cancelado.\n\nSegundo parágrafo com detalhes.',
    );
  });

  test('sem frontmatter, YAML inválido ou pasta fora do padrão', () => {
    expect(messages('# sem frontmatter\n')).toEqual([
      'frontmatter YAML ausente (o arquivo deve começar com ---)',
    ]);
    expect(messages('---\ndelta: [aberto\n---\n')[0]).toStartWith(
      'frontmatter YAML inválido:',
    );
    expect(messages(VALID, 'cancelamento')).toEqual([
      'nome de pasta "cancelamento" inválido (esperado NNNN-slug-em-kebab-case)',
    ]);
  });

  test('id sem aspas (lido como número) dá erro com dica', () => {
    expect(messages(VALID.replace('id: "0002"', 'id: 0002'))).toEqual([
      'id "2" difere do número da pasta (0002); escreva o id entre aspas: id: "0002"',
    ]);
  });

  test('campos obrigatórios e IDs do delta são validados', () => {
    const raw = VALID.replace('title: Cancelamento exige motivo', 'title: ""')
      .replace('status: proposed', 'status: aberta')
      .replace('"usecase:cancel_order"', '"cancel_order"');
    expect(messages(raw)).toEqual([
      'title é obrigatório',
      'status deve ser proposed ou applied',
      'delta.modified: ID inválido cancel_order (esperado tipo:caminho, ex.: usecase:cancel_order)',
    ]);
  });

  test('critérios: id repetido, automático sem covers/given/when', () => {
    const raw = VALID.replace(
      'id: revisao-de-copy\n    manual: true',
      'id: rejeita-cancelamento-sem-motivo',
    ).replace(
      '    covers: ["invariant:Order/cancelamento-exige-motivo"]\n',
      '',
    );
    expect(messages(raw)).toEqual([
      'acceptance[0]: critério automático precisa de covers',
      'acceptance[1]: id "rejeita-cancelamento-sem-motivo" repetido',
      'acceptance[1]: critério automático precisa de covers',
      'acceptance[1]: critério automático precisa de given e when',
    ]);
  });
});

describe('Motivo, rascunho e numeração', () => {
  test('extractMotivo ignora comentários HTML e para no próximo ##', () => {
    expect(extractMotivo(`\n## Motivo\n\n${MOTIVO_PLACEHOLDER}\n`)).toBe('');
    expect(
      extractMotivo('## Motivo\n\nPorque sim.\n\n## Notas\n\nOutra coisa.\n'),
    ).toBe('Porque sim.');
    expect(extractMotivo('sem seção\n')).toBe('');
  });

  test('summarize devolve o primeiro parágrafo numa linha', () => {
    expect(summarize('Linha um\ncontinua.\n\nOutro parágrafo.')).toBe(
      'Linha um continua.',
    );
  });

  test('renderDraft gera uma proposta code-first que o parser aceita, com Motivo vazio', () => {
    const raw = renderDraft({
      id: '0001',
      slug: 'estado-inicial',
      delta: { added: ['entity:Order'], modified: [], removed: [] },
    });
    const { proposal, errors } = parseProposal(
      raw,
      '0001-estado-inicial',
      'changes/0001-estado-inicial/proposal.md',
      false,
    );
    expect(errors).toEqual([]);
    expect(proposal).toMatchObject({
      id: '0001',
      title: 'estado inicial',
      status: 'proposed',
      origin: 'code-first',
      delta: { added: ['entity:Order'], modified: [], removed: [] },
      acceptance: [],
      motivo: '',
    });
    expect(raw).toContain(MOTIVO_PLACEHOLDER);
  });

  test('markApplied troca só a linha de status', () => {
    expect(markApplied(VALID)).toBe(
      VALID.replace('status: proposed', 'status: applied'),
    );
  });

  test('nextChangeId usa o maior número + 1, com 4 dígitos', () => {
    expect(nextChangeId([])).toBe('0001');
    expect(nextChangeId([{ id: '0001' }, { id: '0009' }] as never)).toBe(
      '0010',
    );
  });
});

describe('listProposals', () => {
  test('lê abertas e arquivadas; acusa proposal.md ausente e número repetido', async () => {
    await mkdir(join(dir, '0002-cancelamento-exige-motivo'), {
      recursive: true,
    });
    await writeFile(
      join(dir, '0002-cancelamento-exige-motivo', 'proposal.md'),
      VALID,
    );
    await mkdir(join(dir, 'archive', '0001-estado-inicial'), {
      recursive: true,
    });
    await writeFile(
      join(dir, 'archive', '0001-estado-inicial', 'proposal.md'),
      markApplied(
        renderDraft({
          id: '0001',
          slug: 'estado-inicial',
          delta: { added: ['entity:Order'], modified: [], removed: [] },
        }),
      ),
    );
    await mkdir(join(dir, '0003-vazia'), { recursive: true });
    await mkdir(join(dir, 'archive', '0002-duplicada'), { recursive: true });
    await writeFile(
      join(dir, 'archive', '0002-duplicada', 'proposal.md'),
      markApplied(VALID),
    );

    const { proposals, errors } = await listProposals(dir, 'changes');
    expect(proposals.map((p) => [p.path, p.archived])).toEqual([
      ['changes/0002-cancelamento-exige-motivo/proposal.md', false],
      ['changes/archive/0001-estado-inicial/proposal.md', true],
      ['changes/archive/0002-duplicada/proposal.md', true],
    ]);
    expect(errors).toEqual([
      { message: 'proposal.md ausente', source: 'changes/0003-vazia' },
      {
        message:
          'número 0002 repetido (também em changes/0002-cancelamento-exige-motivo/proposal.md)',
        source: 'changes/archive/0002-duplicada/proposal.md',
      },
    ]);
  });

  test('pasta changes inexistente não é erro', async () => {
    expect(await listProposals(join(dir, 'nao-existe'), 'changes')).toEqual({
      proposals: [],
      errors: [],
    });
  });
});
