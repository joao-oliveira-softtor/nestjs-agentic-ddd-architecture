import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { compile } from '@agentic-ddd/compiler';
import { bootstrapChanges } from '../../test/helpers/bootstrap';

const ROOT = resolve(import.meta.dir, '../..');
const configPath = join(ROOT, 'agentic.config.ts');

let out: string;

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return '';
  } catch (error) {
    return (error as Error).message;
  }
}

beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), 'agentic-compile-'));
});

afterEach(async () => {
  await rm(out, { recursive: true, force: true });
});

describe('compile (exemplo orders)', () => {
  test('escreve skills de dev e de runtime, AGENTS.md e CLAUDE.md', async () => {
    const result = await compile({ configPath, outRoot: out, mode: 'write' });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.ir?.operators.map((o) => o.id)).toEqual([
      'operator:order-operator',
    ]);
    const runtime = await readFile(
      join(out, '.agentic/runtime/order-operator/SKILL.md'),
      'utf8',
    );
    expect(runtime).toContain('### `cancel_order`');
    expect(runtime).toContain('| `invariant:Order/total-nao-negativo` |');
    const dev = await readFile(
      join(out, '.agents/skills/orders-dev/SKILL.md'),
      'utf8',
    );
    expect(dev).toContain('name: orders-dev');
    expect(dev).toContain('`examples/orders/domain/order.ts:');
    expect(await readFile(join(out, 'AGENTS.md'), 'utf8')).toContain(
      '| orders | `examples/orders` |',
    );
  });

  test('é idempotente e o check passa depois de escrever', async () => {
    await bootstrapChanges(out);
    await compile({ configPath, outRoot: out, mode: 'write' });
    const first = await readFile(
      join(out, '.agents/skills/orders-dev/SKILL.md'),
      'utf8',
    );
    await compile({ configPath, outRoot: out, mode: 'write' });
    expect(
      await readFile(join(out, '.agents/skills/orders-dev/SKILL.md'), 'utf8'),
    ).toBe(first);
    const check = await compile({ configPath, outRoot: out, mode: 'check' });
    expect(check.drift).toEqual([]);
    expect(check.ok).toBe(true);
  });

  test('check acusa arquivo gerado editado à mão', async () => {
    await compile({ configPath, outRoot: out, mode: 'write' });
    const skillPath = join(out, '.agentic/runtime/order-operator/SKILL.md');
    await writeFile(
      skillPath,
      `${await readFile(skillPath, 'utf8')}\neditado\n`,
    );
    const check = await compile({ configPath, outRoot: out, mode: 'check' });
    expect(check.ok).toBe(false);
    expect(check.drift).toEqual([
      { path: '.agentic/runtime/order-operator/SKILL.md', reason: 'changed' },
    ]);
  });

  test('avisa quando CLAUDE.md existe sem @AGENTS.md', async () => {
    await writeFile(join(out, 'CLAUDE.md'), 'meu arquivo\n');
    const result = await compile({ configPath, outRoot: out, mode: 'write' });
    expect(result.warnings).toContain(
      'CLAUDE.md existe mas não contém @AGENTS.md',
    );
  });

  test('sem lock e sem proposta: write segue com pendência; check falha', async () => {
    const write = await compile({ configPath, outRoot: out, mode: 'write' });
    expect(write.ok).toBe(true);
    expect(write.pending[0]).toContain('mudança(s) de domínio sem proposta');
    const check = await compile({ configPath, outRoot: out, mode: 'check' });
    expect(check.ok).toBe(false);
    expect(check.pending[0]).toContain('--draft-change');
  });

  test('--draft-change cria a proposta; sem Motivo ela não é aplicada', async () => {
    const draft = await compile({
      configPath,
      outRoot: out,
      mode: 'write',
      draftChange: 'estado-inicial',
    });
    expect(draft.drafted).toBe('changes/0001-estado-inicial/proposal.md');
    expect(draft.pending).toEqual([
      'proposta 0001: a seção ## Motivo está vazia',
    ]);
    expect(draft.applied).toBeNull();
    const raw = await readFile(join(out, draft.drafted!), 'utf8');
    expect(raw).toContain('origin: code-first');
    expect(raw).toContain('    - "usecase:cancel_order"');
  });

  test('proposta com Motivo é aplicada: arquivo arquivado, lock e histórico', async () => {
    await bootstrapChanges(out);
    const archived = await readFile(
      join(out, 'changes/archive/0001-estado-inicial/proposal.md'),
      'utf8',
    );
    expect(archived).toContain('status: applied');
    expect(
      await failure(access(join(out, 'changes/0001-estado-inicial'))),
    ).toContain('ENOENT');
    const lock = JSON.parse(
      await readFile(join(out, '.agentic/domain.lock.json'), 'utf8'),
    ) as {
      changes: { id: string; path: string; summary: string }[];
    };
    expect(lock.changes.map((c) => [c.id, c.path, c.summary])).toEqual([
      [
        '0001',
        'changes/archive/0001-estado-inicial/proposal.md',
        'Estado inicial do domínio.',
      ],
    ]);
    const history = await readFile(
      join(out, '.agents/skills/orders-dev/references/history.md'),
      'utf8',
    );
    expect(history).toContain(
      '[0001](../../../../changes/archive/0001-estado-inicial/proposal.md)',
    );
    const check = await compile({ configPath, outRoot: out, mode: 'check' });
    expect(check.pending).toEqual([]);
    expect(check.drift).toEqual([]);
    expect(check.ok).toBe(true);
  });

  test('diff só de docs atualiza o lock sem proposta', async () => {
    await bootstrapChanges(out);
    const lockPath = join(out, '.agentic/domain.lock.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    lock.ir.useCases[0].description = 'Descrição antiga.';
    await writeFile(lockPath, JSON.stringify(lock));
    const write = await compile({ configPath, outRoot: out, mode: 'write' });
    expect(write.pending).toEqual([]);
    expect(write.diff.map((i) => i.classification)).toEqual(['docs']);
    expect(
      (await compile({ configPath, outRoot: out, mode: 'check' })).ok,
    ).toBe(true);
  });

  test('proposta arquivada editada à mão quebra o write e o check', async () => {
    await bootstrapChanges(out);
    const path = join(out, 'changes/archive/0001-estado-inicial/proposal.md');
    await writeFile(path, `${await readFile(path, 'utf8')}\nEditado.\n`);
    for (const mode of ['write', 'check'] as const) {
      const result = await compile({ configPath, outRoot: out, mode });
      expect(result.ok).toBe(false);
      expect(result.errors[0]!.message).toContain(
        'propostas arquivadas são imutáveis',
      );
    }
  });

  test('--draft-change sem mudança ou com proposta aberta é recusado', async () => {
    await bootstrapChanges(out);
    expect(
      await failure(
        compile({
          configPath,
          outRoot: out,
          mode: 'write',
          draftChange: 'nada',
        }),
      ),
    ).toContain('não há mudança de domínio para propor');
    const otherOut = await mkdtemp(join(tmpdir(), 'agentic-compile-'));
    try {
      await compile({
        configPath,
        outRoot: otherOut,
        mode: 'write',
        draftChange: 'a',
      });
      expect(
        await failure(
          compile({
            configPath,
            outRoot: otherOut,
            mode: 'write',
            draftChange: 'b',
          }),
        ),
      ).toContain('já existe uma proposta aberta');
    } finally {
      await rm(otherOut, { recursive: true, force: true });
    }
    expect(
      await failure(
        compile({
          configPath,
          outRoot: out,
          mode: 'write',
          draftChange: 'Slug Ruim',
        }),
      ),
    ).toContain('--draft-change: o slug "Slug Ruim" deve ser kebab-case');
  });
});
