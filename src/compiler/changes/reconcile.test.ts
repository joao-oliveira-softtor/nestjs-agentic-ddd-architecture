import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from '../__fixtures__/shop';
import { analyze } from '../analyze';
import { sha256 } from '../canonical';
import { semanticDiff, EMPTY_IR } from '../diff';
import type { DomainLock } from '../lock';
import {
  markApplied,
  parseProposal,
  renderDraft,
  type Delta,
  type Proposal,
} from './proposal';
import { reconcile } from './reconcile';

const ROOT = resolve(import.meta.dir, '../../..');
const ir = analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] }).ir;
const allAdded: Delta = {
  added: semanticDiff(EMPTY_IR, ir).map((i) => i.id),
  modified: [],
  removed: [],
};

function proposal(
  options: {
    id?: string;
    delta?: Delta;
    motivo?: string;
    archived?: boolean;
    applied?: boolean;
  } = {},
): Proposal {
  const id = options.id ?? '0001';
  const slug = 'estado-inicial';
  let raw = renderDraft({ id, slug, delta: options.delta ?? allAdded });
  if (options.motivo !== undefined)
    raw = raw.replace(/<!--[\s\S]*?-->/, options.motivo);
  if (options.applied) raw = markApplied(raw);
  const base = options.archived
    ? `changes/archive/${id}-${slug}`
    : `changes/${id}-${slug}`;
  return parseProposal(
    raw,
    `${id}-${slug}`,
    `${base}/proposal.md`,
    options.archived ?? false,
  ).proposal!;
}

const input = (
  lock: DomainLock | null,
  proposals: Proposal[],
  current = ir,
) => ({ ir: current, lock, proposals, changesDir: 'changes' });

describe('reconcile', () => {
  test('sem lock e sem proposta: nada é aplicado e fica pendente', () => {
    const plan = reconcile(input(null, []));
    expect(plan.nextLock).toBeNull();
    expect(plan.apply).toBeNull();
    expect(plan.errors).toEqual([]);
    expect(plan.pending).toEqual([
      'há 10 mudança(s) de domínio sem proposta; escreva changes/NNNN-<slug>/proposal.md ou rode `bun run agentic compile --draft-change <slug>`',
    ]);
  });

  test('proposta que bate com o diff é aplicada e entra no lock', () => {
    const open = proposal({ motivo: 'Base do histórico.\n\nDetalhe.' });
    const plan = reconcile(input(null, [open]));
    expect(plan.pending).toEqual([]);
    expect(plan.apply?.id).toBe('0001');
    expect(plan.archivedPath).toBe(
      'changes/archive/0001-estado-inicial/proposal.md',
    );
    expect(plan.nextLock?.ir).toEqual(ir);
    expect(plan.nextLock?.changes).toEqual([
      {
        id: '0001',
        title: 'estado inicial',
        path: 'changes/archive/0001-estado-inicial/proposal.md',
        summary: 'Base do histórico.',
        hash: sha256(markApplied(open.raw)),
        items: semanticDiff(EMPTY_IR, ir),
      },
    ]);
  });

  test('Motivo vazio e divergências de delta ficam pendentes', () => {
    const delta: Delta = {
      added: [
        ...allAdded.added.filter((id) => id !== 'entity:Product'),
        'entity:Fantasma',
      ],
      modified: [],
      removed: [],
    };
    const plan = reconcile(input(null, [proposal({ delta })]));
    expect(plan.apply).toBeNull();
    expect(plan.nextLock).toBeNull();
    expect(plan.pending).toEqual([
      'proposta 0001: mudança no código fora do delta: added entity:Product',
      'proposta 0001: ID no delta sem mudança correspondente no código: added entity:Fantasma',
      'proposta 0001: a seção ## Motivo está vazia',
    ]);
  });

  test('diff só de docs atualiza o lock sem proposta', () => {
    const applied = proposal({
      motivo: 'Base.',
      archived: true,
      applied: true,
    });
    const lock: DomainLock = {
      lockVersion: 1,
      ir,
      changes: [
        {
          id: '0001',
          title: 'estado inicial',
          path: applied.path,
          summary: 'Base.',
          hash: sha256(applied.raw),
          items: [],
        },
      ],
    };
    const current = JSON.parse(JSON.stringify(ir));
    current.useCases[0].description = 'Descrição nova.';
    const plan = reconcile(input(lock, [applied], current));
    expect(plan.errors).toEqual([]);
    expect(plan.pending).toEqual([]);
    expect(plan.apply).toBeNull();
    expect(plan.nextLock).toEqual({
      lockVersion: 1,
      ir: current,
      changes: lock.changes,
    });
  });

  test('proposta aberta sem mudança no código fica pendente', () => {
    const applied = proposal({
      motivo: 'Base.',
      archived: true,
      applied: true,
    });
    const lock: DomainLock = {
      lockVersion: 1,
      ir,
      changes: [
        {
          id: '0001',
          title: 'estado inicial',
          path: applied.path,
          summary: 'Base.',
          hash: sha256(applied.raw),
          items: [],
        },
      ],
    };
    const open = proposal({
      id: '0002',
      delta: { added: ['invariant:Product/nova'], modified: [], removed: [] },
      motivo: 'X.',
    });
    const plan = reconcile(input(lock, [applied, open]));
    expect(plan.pending).toEqual([
      'a proposta 0002 está aberta, mas o código ainda não tem as mudanças de domínio do delta',
    ]);
    expect(plan.nextLock).toEqual(lock);
  });

  test('proposta arquivada editada, ausente ou não registrada é erro duro', () => {
    const applied = proposal({
      motivo: 'Base.',
      archived: true,
      applied: true,
    });
    const lock: DomainLock = {
      lockVersion: 1,
      ir,
      changes: [
        {
          id: '0001',
          title: 'estado inicial',
          path: applied.path,
          summary: 'Base.',
          hash: 'outro-hash',
          items: [],
        },
      ],
    };
    expect(
      reconcile(input(lock, [applied])).errors.map((e) => e.message),
    ).toEqual([
      'a proposta aplicada 0001 foi editada depois de aplicada; propostas arquivadas são imutáveis (restaure-a pelo git e abra uma nova proposta)',
    ]);
    expect(reconcile(input(lock, [])).errors.map((e) => e.message)).toEqual([
      'a proposta aplicada 0001 não está em changes/archive',
    ]);
    expect(
      reconcile(input(null, [applied])).errors.map((e) => e.message),
    ).toEqual(['a proposta arquivada 0001 não está registrada no lock']);
  });

  test('duas propostas abertas e status incoerente são erro duro', () => {
    const plan = reconcile(
      input(null, [proposal({ id: '0001' }), proposal({ id: '0002' })]),
    );
    expect(plan.errors.map((e) => e.message)).toEqual([
      'há 2 propostas abertas (0001, 0002); o v0 aceita uma por vez',
    ]);
    expect(
      reconcile(input(null, [proposal({ applied: true })])).errors.map(
        (e) => e.message,
      ),
    ).toEqual(['proposta com status applied fora de archive']);
  });

  test('status não reescrevível vira erro de reconciliação em vez de exceção', () => {
    const open = proposal({ motivo: 'Base.', delta: allAdded });
    let raw = open.raw.replace(/^status: proposed$/m, '"status": proposed');
    const parsed = parseProposal(
      raw,
      `${open.id}-${open.slug}`,
      `changes/${open.id}-${open.slug}/proposal.md`,
      false,
    );
    expect(parsed.proposal).not.toBeNull();

    const plan = reconcile(input(null, [parsed.proposal!]));
    expect(plan.errors.map((e) => e.message)).toEqual([
      'não foi possível marcar a proposta 0001 como aplicada; escreva a linha "status: proposed" literalmente no frontmatter',
    ]);
    expect(plan.nextLock).toBeNull();
    expect(plan.apply).toBeNull();
  });
});
