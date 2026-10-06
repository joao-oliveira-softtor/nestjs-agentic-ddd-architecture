import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../..');

function run(...args: string[]) {
  const result = Bun.spawnSync(['bun', 'src/cli/main.ts', ...args], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

let out: string;

beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), 'agentic-cli-'));
});

afterEach(async () => {
  await rm(out, { recursive: true, force: true });
});

describe('agentic-ddd compile (CLI)', () => {
  test('escreve e depois --check sai com 0', () => {
    expect(run('compile', '--out-root', out).code).toBe(0);
    const check = run('compile', '--check', '--out-root', out);
    expect(check.code).toBe(0);
    expect(check.stdout).toContain('arquivos gerados estão em dia');
  });

  test('--check sai com 1 e lista o arquivo desatualizado', async () => {
    run('compile', '--out-root', out);
    const skillPath = join(out, '.agents/skills/orders-dev/SKILL.md');
    await writeFile(
      skillPath,
      `${await readFile(skillPath, 'utf8')}\neditado\n`,
    );
    const check = run('compile', '--check', '--out-root', out);
    expect(check.code).toBe(1);
    expect(check.stderr).toContain(
      'desatualizado (changed): .agents/skills/orders-dev/SKILL.md',
    );
  });

  test('--check com diretório real no lugar do link do espelho dá dica de remover/renomear', async () => {
    run('compile', '--out-root', out);
    const mirror = join(out, '.claude/skills/orders-dev');
    await rm(mirror, { recursive: true, force: true });
    await mkdir(mirror, { recursive: true });
    const check = run('compile', '--check', '--out-root', out);
    expect(check.code).toBe(1);
    expect(check.stderr).toContain(
      'desatualizado (conflict): .claude/skills/orders-dev',
    );
    expect(check.stderr).toContain('remova ou renomeie o diretório existente');
    expect(check.stderr).not.toContain('rode `bun run agentic compile`');
  });

  test('--check com link do espelho ausente manda rodar o compile', async () => {
    run('compile', '--out-root', out);
    await rm(join(out, '.claude/skills/orders-dev'));
    const check = run('compile', '--check', '--out-root', out);
    expect(check.code).toBe(1);
    expect(check.stderr).toContain(
      'desatualizado (mirror): .claude/skills/orders-dev',
    );
    expect(check.stderr).toContain('rode `bun run agentic compile`');
    expect(check.stderr).not.toContain('remova ou renomeie');
  });

  test('erro de declaração sai com 1 e aponta arquivo:linha', () => {
    const result = run(
      'compile',
      '--config',
      'test/fixtures/broken/agentic.config.ts',
      '--out-root',
      out,
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'domain/thing.ts:5: invariant:Thing/Id Ruim: o id da invariante deve ser kebab-case',
    );
  });

  test('uso incorreto sai com 2', () => {
    expect(run('build').code).toBe(2);
    expect(run('compile', '--nada').code).toBe(2);
  });

  test('--report imprime tokens por arquivo', () => {
    const result = run('compile', '--report', '--out-root', out);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      '| `.agentic/runtime/order-operator/SKILL.md` |',
    );
    expect(result.stdout).toContain('≈tokens');
  });

  test('erro de lint no modo write sai com 1 mas ainda escreve', async () => {
    const result = run(
      'compile',
      '--config',
      'test/fixtures/long-description/agentic.config.ts',
      '--out-root',
      out,
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('lint: description com');
    const skillPath = join(out, '.agentic/runtime/long-operator/SKILL.md');
    try {
      await access(skillPath);
      expect(true).toBe(true); // File exists
    } catch {
      expect.unreachable('File should exist');
    }
  });

  test('erro de lint no modo --check sai com 1', () => {
    run(
      'compile',
      '--config',
      'test/fixtures/long-description/agentic.config.ts',
      '--out-root',
      out,
    );
    const checkResult = run(
      'compile',
      '--check',
      '--config',
      'test/fixtures/long-description/agentic.config.ts',
      '--out-root',
      out,
    );
    expect(checkResult.code).toBe(1);
    expect(checkResult.stderr).toContain('lint: description com');
  });
});
