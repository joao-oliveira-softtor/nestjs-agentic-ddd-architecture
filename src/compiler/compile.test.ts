import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { compile } from '@agentic-ddd/compiler';
import { checkSnapshot } from './snapshot';
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
    expect((await checkSnapshot(out)).ok).toBe(false);
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
    expect((await checkSnapshot(out)).ok).toBe(false);
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
    const snap = await checkSnapshot(out);
    expect(snap.ok).toBe(true);
    if (snap.ok) {
      expect(snap.rules.length).toBeGreaterThan(0);
      expect(snap.rules.some((r) => r.body.includes('{{'))).toBe(false);
    }
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

  test('mudança de domínio sem proposta remove o snapshot existente', async () => {
    await bootstrapChanges(out);
    expect((await checkSnapshot(out)).ok).toBe(true);
    const lockPath = join(out, '.agentic/domain.lock.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    lock.ir.useCases.shift(); // o código passa a ter um use-case a mais que o lock
    await writeFile(lockPath, JSON.stringify(lock));
    const write = await compile({ configPath, outRoot: out, mode: 'write' });
    expect(write.pending.length).toBeGreaterThan(0);
    expect((await checkSnapshot(out)).ok).toBe(false);
    expect(
      await failure(access(join(out, '.agentic/mcp/snapshot.json'))),
    ).toContain('ENOENT');
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

  test('isola o registry entre configurações no mesmo processo', () => {
    const longConfig = join(
      ROOT,
      'test/fixtures/long-description/agentic.config.ts',
    );
    // subprocesso: a fixture long-description nunca é importada no processo de teste
    const script = `
      import { compile } from '@agentic-ddd/compiler';
      const first = await compile({
        configPath: ${JSON.stringify(longConfig)},
        outRoot: ${JSON.stringify(join(out, 'first'))},
        mode: 'check',
      });
      const second = await compile({
        configPath: ${JSON.stringify(configPath)},
        outRoot: ${JSON.stringify(join(out, 'second'))},
        mode: 'check',
      });
      console.log(JSON.stringify({
        first: first.ir?.operators.map((o) => o.id) ?? [],
        second: second.errors.map((e) => e.message),
        operators: second.ir?.operators.map((o) => o.id) ?? [],
      }));
    `;
    const proc = Bun.spawnSync(['bun', '-e', script], {
      cwd: ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(proc.stderr.toString()).toBe('');
    const result = JSON.parse(proc.stdout.toString()) as {
      first: string[];
      second: string[];
      operators: string[];
    };
    expect(result.first).toEqual(['operator:long-operator']);
    expect(result.second).not.toContain(
      'elemento declarado fora dos módulos de agentic.config.ts',
    );
    expect(result.operators).toEqual(['operator:order-operator']);
  });
});

describe('compile (regras do time)', () => {
  let proj: string;
  let rulesDir: string;
  const cfg = () => join(proj, 'agentic.config.ts');
  const run = (mode: 'write' | 'check') =>
    compile({ configPath: cfg(), outRoot: out, mode });

  beforeEach(async () => {
    await mkdir(join(ROOT, '.tmp'), { recursive: true });
    proj = await mkdtemp(join(ROOT, '.tmp', 'rules-'));
    rulesDir = join(proj, 'rules');
    await mkdir(rulesDir);
    await writeFile(
      cfg(),
      `import { defineConfig } from '@agentic-ddd/compiler';
export default defineConfig({
  root: '../..',
  modules: [{ name: 'orders', path: 'examples/orders' }],
  rules: { dir: '.tmp/${basename(proj)}/rules' },
});
`,
    );
    await writeFile(join(rulesDir, 'x.md'), '- Regra X.\n');
    await writeFile(
      join(rulesDir, 'y.md'),
      "---\npaths: ['examples/orders/domain/**']\n---\n- Regra Y.\n",
    );
  });

  afterEach(async () => {
    await rm(proj, { recursive: true, force: true });
  });

  test('é idempotente e o check reprova regra editada (com ou sem paths)', async () => {
    await bootstrapChanges(out);
    expect((await run('write')).ok).toBe(true);
    const agents = await readFile(join(out, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('- Regra X.');
    expect(agents).toContain('### Regras por caminho');
    expect((await run('check')).ok).toBe(true);
    await writeFile(
      join(rulesDir, 'y.md'),
      "---\npaths: ['examples/orders/domain/**']\n---\n- Regra Y editada.\n",
    );
    expect((await run('check')).ok).toBe(false);
    await run('write');
    expect((await run('check')).ok).toBe(true);
    await writeFile(join(rulesDir, 'x.md'), '- Regra X editada.\n');
    expect((await run('check')).ok).toBe(false);
  });

  test('regra inválida falha o compile com source = arquivo da regra', async () => {
    await writeFile(join(rulesDir, 'x.md'), '# título proibido\n');
    const result = await run('write');
    expect(result.ok).toBe(false);
    expect(result.errors[0]!.source).toBe(`.tmp/${basename(proj)}/rules/x.md`);
  });

  test('regra inválida com --draft-change não grava rascunho', async () => {
    await writeFile(join(rulesDir, 'x.md'), '# título proibido\n');
    const result = await compile({
      configPath: cfg(),
      outRoot: out,
      mode: 'write',
      draftChange: 'com-regra-invalida',
    });
    expect(result.ok).toBe(false);
    expect(result.drafted).toBeNull();
    const changes = await readdir(join(out, 'changes')).catch(() => []);
    expect(changes.some((d) => d.endsWith('com-regra-invalida'))).toBe(false);
  });
});
