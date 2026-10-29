import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgenticError } from '../ir';
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
const codes = (raw: string, dir?: string) =>
  parse(raw, dir).errors.map((e) => e.code);

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agentic-changes-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parseProposal', () => {
  test('reads a valid proposal', () => {
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

  test('missing frontmatter, invalid YAML or a non-standard folder name', () => {
    expect(codes('# sem frontmatter\n')).toEqual([
      'proposal.frontmatter-missing',
    ]);
    expect(codes('---\ndelta: [aberto\n---\n')).toEqual([
      'proposal.frontmatter-invalid',
    ]);
    expect(codes(VALID, 'cancelamento')).toEqual([
      'proposal.folder-name-invalid',
    ]);
    expect(messages(VALID, 'cancelamento')[0]).toContain('"cancelamento"');
  });

  test('an unquoted id (read as a number) reports id-mismatch with a hint', () => {
    expect(codes(VALID.replace('id: "0002"', 'id: 0002'))).toEqual([
      'proposal.id-mismatch',
    ]);
    expect(messages(VALID.replace('id: "0002"', 'id: 0002'))[0]).toContain(
      'id: "0002"',
    );
  });

  test('required fields and delta IDs are validated', () => {
    const raw = VALID.replace('title: Cancelamento exige motivo', 'title: ""')
      .replace('status: proposed', 'status: aberta')
      .replace('"usecase:cancel_order"', '"cancel_order"');
    expect(codes(raw)).toEqual([
      'proposal.title-missing',
      'proposal.status-invalid',
      'proposal.element-id-invalid',
    ]);
    expect(messages(raw)[2]).toContain('cancel_order');
  });

  test('delta accepts a value object ID', () => {
    const raw = VALID.replace(
      '    - "invariant:Order/cancelamento-exige-motivo"',
      '    - "valueobject:Dinheiro"',
    );
    const { proposal, errors } = parse(raw);
    expect(errors).toEqual([]);
    expect(proposal!.delta.added).toEqual(['valueobject:Dinheiro']);
  });

  test('delta accepts a port ID', () => {
    const raw = VALID.replace(
      '    - "invariant:Order/cancelamento-exige-motivo"',
      '    - "port:PedidoRepository"',
    );
    const { proposal, errors } = parse(raw);
    expect(errors).toEqual([]);
    expect(proposal!.delta.added).toEqual(['port:PedidoRepository']);
  });

  test('delta accepts an adapter ID', () => {
    const raw = VALID.replace(
      '    - "invariant:Order/cancelamento-exige-motivo"',
      '    - "adapter:PedidoRepositoryMemoria"',
    );
    const { proposal, errors } = parse(raw);
    expect(errors).toEqual([]);
    expect(proposal!.delta.added).toEqual(['adapter:PedidoRepositoryMemoria']);
  });

  test('delta with an unknown key is rejected', () => {
    const raw = VALID.replace('  removed: []', '  removed: []\n  renamed: []');
    expect(codes(raw)).toEqual(['proposal.delta-key-unknown']);
    expect(messages(raw)[0]).toContain('"renamed"');
  });

  test('an archived proposal with a malformed delta is still accepted (immutable)', () => {
    const extra = VALID.replace(
      '  removed: []',
      '  removed: []\n  renamed: []',
    );
    const lista = VALID.replace(/delta:\n(?: {2}.*\n)+/, 'delta: [a, b]\n');
    for (const raw of [extra, lista]) {
      expect(
        parseProposal(raw, '0002-cancelamento-exige-motivo', PATH, true).errors,
      ).toEqual([]);
    }
  });

  test('a delta that is not an object is rejected', () => {
    const lista = VALID.replace(/delta:\n(?: {2}.*\n)+/, 'delta: [a, b]\n');
    expect(codes(lista)).toEqual(['proposal.delta-invalid']);
    const texto = VALID.replace(/delta:\n(?: {2}.*\n)+/, 'delta: nada\n');
    expect(codes(texto)).toEqual(['proposal.delta-invalid']);
  });

  test('criteria: duplicate id, automatic criterion without covers/given/when', () => {
    const raw = VALID.replace(
      'id: revisao-de-copy\n    manual: true',
      'id: rejeita-cancelamento-sem-motivo',
    ).replace(
      '    covers: ["invariant:Order/cancelamento-exige-motivo"]\n',
      '',
    );
    expect(codes(raw)).toEqual([
      'proposal.criterion-covers-missing',
      'proposal.criterion-id-duplicate',
      'proposal.criterion-covers-missing',
      'proposal.criterion-given-when-missing',
    ]);
    expect(messages(raw)[1]).toContain('"rejeita-cancelamento-sem-motivo"');
  });
});

describe('Motivo, draft and numbering', () => {
  test('extractMotivo ignores HTML comments and stops at the next ##', () => {
    expect(extractMotivo(`\n## Motivo\n\n${MOTIVO_PLACEHOLDER}\n`)).toBe('');
    expect(
      extractMotivo('## Motivo\n\nPorque sim.\n\n## Notas\n\nOutra coisa.\n'),
    ).toBe('Porque sim.');
    expect(extractMotivo('sem seção\n')).toBe('');
  });

  test('summarize returns the first paragraph on one line', () => {
    expect(summarize('Linha um\ncontinua.\n\nOutro parágrafo.')).toBe(
      'Linha um continua.',
    );
  });

  test('renderDraft produces a code-first proposal the parser accepts, with an empty Motivo', () => {
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

  test('markApplied only replaces the status line', () => {
    expect(markApplied(VALID)).toBe(
      VALID.replace('status: proposed', 'status: applied'),
    );
  });

  test('markApplied com aspas duplas', () => {
    const raw = VALID.replace('status: proposed', 'status: "proposed"');
    const result = markApplied(raw);
    expect(result).toBe(raw.replace('status: "proposed"', 'status: applied'));
  });

  test('markApplied com aspas simples', () => {
    const raw = VALID.replace('status: proposed', "status: 'proposed'");
    const result = markApplied(raw);
    expect(result).toBe(raw.replace("status: 'proposed'", 'status: applied'));
  });

  test('markApplied com comentário', () => {
    const raw = VALID.replace('status: proposed', 'status: proposed # nota');
    const result = markApplied(raw);
    expect(result).toBe(
      raw.replace('status: proposed # nota', 'status: applied'),
    );
  });

  test('markApplied preserva CRLF', () => {
    const crlfValid = VALID.replace(/\n/g, '\r\n');
    const result = markApplied(crlfValid);
    expect(result).toContain('\r\n');
    expect(result.split('\r\n')[3]).toBe('status: applied');
  });

  test('markApplied preserva linha vazia após status', () => {
    const raw = VALID.replace('status: proposed', 'status: proposed\n');
    const result = markApplied(raw);
    expect(result.includes('\nstatus: applied\n')).toBe(true);
  });

  test('markApplied não toca em status: proposed no corpo', () => {
    const raw = `${VALID}\n\nAlgum texto com status: proposed aqui.`;
    const result = markApplied(raw);
    expect(result.includes('status: applied')).toBe(true);
    expect(result.includes('Algum texto com status: proposed')).toBe(true);
  });

  test('markApplied without a status line throws an AgenticError', () => {
    const raw = VALID.replace('status: proposed', 'status: drafted');
    expect(() => markApplied(raw)).toThrow(AgenticError);
    expect(() => markApplied(raw)).toThrow(
      expect.objectContaining({
        code: 'proposal.mark-applied-status-missing',
      }),
    );
  });

  test('nextChangeId uses the highest number + 1, zero-padded to 4 digits', () => {
    expect(nextChangeId([])).toBe('0001');
    expect(nextChangeId([{ id: '0001' }, { id: '0009' }] as never)).toBe(
      '0010',
    );
  });
});

describe('listProposals', () => {
  test('reads open and archived proposals; reports missing proposal.md and duplicate number', async () => {
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
    expect(errors.map((e) => [e.code, e.source])).toEqual([
      ['proposal.file-missing', 'changes/0003-vazia'],
      [
        'proposal.number-duplicate',
        'changes/archive/0002-duplicada/proposal.md',
      ],
    ]);
    expect(errors[1]?.message).toContain('0002');
  });

  test('a missing changes folder is not an error', async () => {
    expect(await listProposals(join(dir, 'nao-existe'), 'changes')).toEqual({
      proposals: [],
      errors: [],
    });
  });

  test('listProposals throws when a file sits where the folder should be', async () => {
    const filePath = join(dir, 'changes');
    await writeFile(filePath, 'not a folder');
    let thrown = false;
    try {
      await listProposals(filePath, 'changes');
    } catch {
      thrown = true;
    }
    expect(thrown).toBe(true);
  });
});
