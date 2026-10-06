import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { compile } from '@agentic-ddd/compiler';

const ROOT = resolve(import.meta.dir, '../..');
const configPath = join(ROOT, 'agentic.config.ts');

let out: string;

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
});
