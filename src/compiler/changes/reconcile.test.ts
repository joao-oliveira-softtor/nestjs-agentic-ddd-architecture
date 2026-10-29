import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from '../__fixtures__/shop';
import { analyze } from '../analyze';
import { sha256 } from '../canonical';
import { semanticDiff, EMPTY_IR } from '../diff';
import type { IR } from '../ir';
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
    covers?: string[];
  } = {},
): Proposal {
  const id = options.id ?? '0001';
  const slug = 'estado-inicial';
  let raw = renderDraft({ id, slug, delta: options.delta ?? allAdded });
  if (options.covers)
    raw = raw.replace(
      'acceptance: []',
      [
        'acceptance:',
        '  - id: criterio',
        `    covers: ${JSON.stringify(options.covers)}`,
        '    given: um estado',
        '    when: uma ação',
        '    then: um resultado',
      ].join('\n'),
    );
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
  test('without a lock or a proposal: nothing is applied and it stays pending', () => {
    const plan = reconcile(input(null, []));
    expect(plan.nextLock).toBeNull();
    expect(plan.apply).toBeNull();
    expect(plan.errors).toEqual([]);
    expect(plan.pending).toEqual([
      {
        code: 'compile.change-without-proposal',
        message: expect.stringContaining(
          'there are 10 domain change(s) without a proposal',
        ),
      },
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

  test('an empty Motivo and delta divergences stay pending', () => {
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
      {
        code: 'proposal.delta-mismatch',
        message:
          'proposal 0001: code change outside the delta: added entity:Product',
      },
      {
        code: 'proposal.delta-mismatch',
        message:
          'proposal 0001: ID in the delta with no matching code change: added entity:Fantasma',
      },
      {
        code: 'proposal.motivo-empty',
        message: 'proposal 0001: the ## Motivo section is empty',
      },
    ]);
  });

  test('a docs-only diff updates the lock without a proposal', () => {
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

  test('only a port description changes, without a proposal: stays pending', () => {
    const port = {
      id: 'port:Repo',
      name: 'Repo',
      module: 'shop',
      description: 'Antes.',
      root: 'entity:Product',
      methods: [],
      source: 'x.ts:1',
    };
    const applied = proposal({
      motivo: 'Base.',
      archived: true,
      applied: true,
    });
    const before: IR = { ...structuredClone(ir), ports: [port] };
    const lock: DomainLock = {
      lockVersion: 1,
      ir: before,
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
    const current: IR = {
      ...structuredClone(ir),
      ports: [{ ...port, description: 'Depois.' }],
    };
    const plan = reconcile(input(lock, [applied], current));
    expect(plan.errors).toEqual([]);
    expect(plan.apply).toBeNull();
    expect(plan.pending).toEqual([
      {
        code: 'compile.change-without-proposal',
        message: expect.stringContaining(
          'there are 1 domain change(s) without a proposal',
        ),
      },
    ]);
    expect(plan.nextLock).toBe(lock);
  });

  test('an open proposal with no code change stays pending', () => {
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
      {
        code: 'proposal.open-without-change',
        message: expect.stringContaining('the proposal 0002 is open'),
      },
    ]);
    expect(plan.nextLock).toEqual(lock);
  });

  test('an archived proposal that was edited, missing or unregistered is a hard error', () => {
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
    expect(reconcile(input(lock, [applied])).errors.map((e) => e.code)).toEqual(
      ['proposal.applied-edited'],
    );
    expect(reconcile(input(lock, [])).errors.map((e) => e.code)).toEqual([
      'proposal.applied-not-archived',
    ]);
    expect(reconcile(input(null, [applied])).errors.map((e) => e.code)).toEqual(
      ['proposal.archived-not-in-lock'],
    );
  });

  test('two open proposals and an inconsistent status are hard errors', () => {
    const plan = reconcile(
      input(null, [proposal({ id: '0001' }), proposal({ id: '0002' })]),
    );
    expect(plan.errors.map((e) => e.code)).toEqual(['proposal.multiple-open']);
    expect(plan.errors[0]?.message).toContain('0001, 0002');
    expect(
      reconcile(input(null, [proposal({ applied: true })])).errors.map(
        (e) => e.code,
      ),
    ).toEqual(['proposal.applied-outside-archive']);
  });

  describe('covers of the open proposal acceptance criteria', () => {
    const codes = (plan: ReturnType<typeof reconcile>) =>
      plan.errors.map((e) => e.code);

    test('an ID that is in neither the IR nor delta.added is an error', () => {
      const open = proposal({
        motivo: 'Base.',
        covers: ['usecase:fantasma'],
      });
      const plan = reconcile(input(null, [open]));
      expect(codes(plan)).toEqual(['proposal.covers-unknown']);
      expect(plan.errors[0]?.message).toContain('usecase:fantasma');
      expect(plan.errors[0]?.source).toBe(open.path);
      expect(plan.apply).toBeNull();
    });

    test('ID da IR ou de delta.added (proposal-first) é aceito', () => {
      const nova = 'invariant:Product/nova-regra';
      const delta: Delta = { ...allAdded, added: [...allAdded.added, nova] };
      const open = proposal({
        motivo: 'Base.',
        delta,
        covers: ['invariant:Product/preco-positivo', nova],
      });
      expect(codes(reconcile(input(null, [open])))).toEqual([]);
    });

    test('port:X.method covers of an IR adapter are accepted', () => {
      const withAdapter: IR = {
        ...structuredClone(ir),
        ports: [
          {
            id: 'port:Repo',
            name: 'Repo',
            module: 'shop',
            description: 'Persistência.',
            root: 'entity:Product',
            methods: [{ name: 'salvar', description: 'Grava.' }],
            source: 'x.ts:1',
          },
        ],
        adapters: [
          {
            id: 'adapter:MemoryRepo',
            name: 'MemoryRepo',
            module: 'shop',
            description: 'Em memória.',
            implements: 'port:Repo',
            source: 'x.ts:2',
          },
        ],
      };
      const open = proposal({ motivo: 'Base.', covers: ['port:Repo.salvar'] });
      expect(
        codes(reconcile({ ...input(null, [open]), ir: withAdapter })),
      ).toEqual([]);
    });

    test('an archived proposal is not checked against the current IR', () => {
      const archived = proposal({
        motivo: 'Base.',
        archived: true,
        applied: true,
        covers: ['usecase:fantasma'],
      });
      expect(codes(reconcile(input(null, [archived])))).not.toContain(
        'proposal.covers-unknown',
      );
    });
  });

  test('a status that cannot be rewritten becomes a reconcile error instead of an exception', () => {
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
    expect(plan.errors.map((e) => e.code)).toEqual([
      'proposal.mark-applied-failed',
    ]);
    expect(plan.nextLock).toBeNull();
    expect(plan.apply).toBeNull();
  });

  describe('mudanças de documentação com proposta aberta', () => {
    const archivedBase = () =>
      proposal({ motivo: 'Base.', archived: true, applied: true });
    const baseLock = (): DomainLock => {
      const applied = archivedBase();
      return {
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
    };
    const edited = (change: (useCase: (name: string) => any) => void): IR => {
      const current = JSON.parse(JSON.stringify(ir));
      change((name) => current.useCases.find((u: any) => u.name === name));
      return current;
    };

    test('delta que declara a mudança só de docs aplica e registra o item', () => {
      const current = edited((useCase) => {
        useCase('create_product').description = 'Descrição nova.';
      });
      const open = proposal({
        id: '0002',
        delta: {
          added: [],
          modified: ['usecase:create_product'],
          removed: [],
        },
        motivo: 'Reescreve a descrição.',
      });
      const plan = reconcile(
        input(baseLock(), [archivedBase(), open], current),
      );
      expect(plan.errors).toEqual([]);
      expect(plan.pending).toEqual([]);
      expect(plan.apply?.id).toBe('0002');
      expect(plan.nextLock?.changes).toHaveLength(2);
      const applied = plan.nextLock!.changes[1]!;
      expect(applied.id).toBe('0002');
      expect(applied.items).toEqual([
        expect.objectContaining({
          kind: 'modified',
          id: 'usecase:create_product',
          classification: 'docs',
        }),
      ]);
    });

    test('item docs não declarado fica fora do histórico da change', () => {
      const current = edited((useCase) => {
        useCase('create_product').description = 'Descrição nova.';
        useCase('publish_product').uses = [];
      });
      const open = proposal({
        id: '0002',
        delta: {
          added: [],
          modified: ['usecase:publish_product'],
          removed: [],
        },
        motivo: 'Publicar não usa mais o método.',
      });
      const plan = reconcile(
        input(baseLock(), [archivedBase(), open], current),
      );
      expect(plan.pending).toEqual([]);
      expect(plan.apply?.id).toBe('0002');
      expect(
        plan.nextLock!.changes[1]!.items.map((i) => `${i.kind} ${i.id}`),
      ).toEqual(['modified usecase:publish_product']);
      expect(plan.nextLock!.ir).toEqual(current);
    });

    test('delta que não bate com o diff só de docs continua pendente', () => {
      const lock = baseLock();
      const current = edited((useCase) => {
        useCase('publish_product').description = 'Descrição nova.';
      });
      const open = proposal({
        id: '0002',
        delta: {
          added: [],
          modified: ['usecase:create_product'],
          removed: [],
        },
        motivo: 'X.',
      });
      const plan = reconcile(input(lock, [archivedBase(), open], current));
      expect(plan.apply).toBeNull();
      expect(plan.pending).toEqual([
        {
          code: 'proposal.open-without-change',
          message: expect.stringContaining('the proposal 0002 is open'),
        },
      ]);
      // current behavior: the lock absorbs the docs-only diff and records no change
      expect(plan.nextLock).toEqual({
        lockVersion: 1,
        ir: current,
        changes: lock.changes,
      });
    });
  });
});
