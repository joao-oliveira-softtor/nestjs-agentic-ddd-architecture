import { afterEach, expect, test } from 'bun:test';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const dirs: string[] = [];
async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), 'agentic-install-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
function install(root: string, ...args: string[]) {
  const p = Bun.spawnSync(
    ['bun', join(ROOT, 'scripts/install-skills.ts'), '--root', root, ...args],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  return {
    code: p.exitCode,
    output: p.stdout.toString() + p.stderr.toString(),
  };
}

for (const scope of ['project', 'user'])
  test(`instala ${scope}: formatos nativos, mesma fonte, referências e idempotência`, async () => {
    const root = await workspace();
    expect(install(root, '--scope', scope, '--check').code).toBe(1);
    expect(await lstat(join(root, '.agents')).catch(() => null)).toBeNull();
    expect(install(root, '--scope', scope).code).toBe(0);
    for (const folder of ['.agents', '.claude'])
      expect(await realpath(join(root, folder, 'skills/agentic-ddd'))).toBe(
        join(ROOT, 'skills/agentic-ddd'),
      );
    for (const target of ['cursor', 'codex', 'claude'])
      for (const role of ['manager', 'executor']) {
        const ext = target === 'codex' ? 'toml' : 'md';
        const path = join(root, `.${target}/agents/agentic-ddd-${role}.${ext}`);
        const text = await readFile(path, 'utf8');
        let instructions: string;
        if (target === 'codex') {
          const parsed = Bun.TOML.parse(text) as Record<string, unknown>;
          expect(parsed.name).toBe(`agentic-ddd-${role}`);
          expect(parsed.model).toBeUndefined();
          expect(parsed.model_reasoning_effort).toBeUndefined();
          instructions = parsed.developer_instructions as string;
        } else {
          const fm = Bun.YAML.parse(text.split('---')[1]!) as Record<
            string,
            unknown
          >;
          expect(fm.name).toBe(`agentic-ddd-${role}`);
          expect(fm.model).toBe('inherit');
          if (target === 'claude') expect(fm.skills).toEqual(['agentic-ddd']);
          instructions = text;
        }
        const reference = /\[instruções do papel\]\(([^)]+)\)/.exec(
          instructions,
        )![1]!;
        expect(await readFile(resolve(root, reference), 'utf8')).toContain(
          role === 'manager' ? 'next --change' : '--spec-hash',
        );
        expect(install(root, '--scope', scope).code).toBe(0);
        expect(await readFile(path, 'utf8')).toBe(text);
      }
    expect(install(root, '--scope', scope, '--check').code).toBe(0);
    expect(
      await lstat(join(root, '.codex/config.toml')).catch(() => null),
    ).toBeNull();
  });

for (const target of ['cursor', 'codex', 'claude'])
  test(`target ${target} instala somente adaptadores pedidos`, async () => {
    const root = await workspace();
    expect(install(root, '--target', target).code).toBe(0);
    expect(await lstat(join(root, `.${target}/agents`))).toBeDefined();
    for (const other of ['cursor', 'codex', 'claude'].filter(
      (t) => t !== target,
    ))
      expect(
        await lstat(join(root, `.${other}/agents`)).catch(() => null),
      ).toBeNull();
  });

for (const scope of ['project', 'user'])
  for (const location of ['root', 'ancestor'])
    test(`instala ${scope} com link na ${location} e preserva links válidos ao reinstalar`, async () => {
      const base = await workspace();
      const physical = join(base, 'nested/physical');
      await mkdir(physical, { recursive: true });
      const alias = join(base, 'alias');
      await symlink(physical, alias, 'dir');
      const root = location === 'root' ? alias : join(alias, 'project');
      expect(install(root, '--scope', scope)).toMatchObject({ code: 0 });
      for (const folder of ['.agents', '.claude'])
        expect(await realpath(join(root, folder, 'skills/agentic-ddd'))).toBe(
          join(ROOT, 'skills/agentic-ddd'),
        );
      expect(install(root, '--scope', scope)).toMatchObject({ code: 0 });
      expect(install(root, '--scope', scope, '--check')).toMatchObject({
        code: 0,
      });
    });

test('recusa pais simbólicos dentro da raiz sem escrever fora dela', async () => {
  const root = await workspace();
  const outside = await workspace();
  await symlink(outside, join(root, '.claude'), 'dir');
  expect(install(root).code).toBe(1);
  expect(await lstat(join(root, '.agents')).catch(() => null)).toBeNull();
  expect(await lstat(join(outside, 'agents')).catch(() => null)).toBeNull();
});

test('preflight recusa arquivo alheio sem instalar parcialmente; check não altera conflito', async () => {
  const root = await workspace();
  await mkdir(join(root, '.claude/agents'), { recursive: true });
  const path = join(root, '.claude/agents/agentic-ddd-executor.md');
  await writeFile(path, 'agente do usuário');
  expect(install(root).code).toBe(1);
  expect(await lstat(join(root, '.agents')).catch(() => null)).toBeNull();
  expect(install(root, '--check').code).toBe(1);
  expect(await readFile(path, 'utf8')).toBe('agente do usuário');
});

test('recusa links alheios e pais que não são diretórios antes de escrever', async () => {
  const root = await workspace();
  await mkdir(join(root, '.agents/skills/agentic-ddd'), { recursive: true });
  await writeFile(
    join(root, '.agents/skills/agentic-ddd/SKILL.md'),
    'skill autoral',
  );
  expect(install(root).code).toBe(1);
  expect(await lstat(join(root, '.cursor')).catch(() => null)).toBeNull();
  const other = await workspace();
  await writeFile(join(other, '.claude'), 'arquivo');
  expect(install(other).code).toBe(1);
  expect(await lstat(join(other, '.agents')).catch(() => null)).toBeNull();
});

test('recusa opções inválidas antes de escrever', async () => {
  const root = await workspace();
  for (const args of [
    ['--scope', 'bad'],
    ['--target', 'bad'],
    ['--unknown'],
    ['--target'],
  ])
    expect(install(root, ...args).code).toBe(2);
  expect(await lstat(join(root, '.agents')).catch(() => null)).toBeNull();
});

test('recusa link alheio inclusive dangling e preserva configuração existente', async () => {
  const root = await workspace();
  await mkdir(join(root, '.agents/skills'), { recursive: true });
  await symlink(
    join(root, 'missing-source'),
    join(root, '.agents/skills/agentic-ddd'),
  );
  expect(install(root).code).toBe(1);
  expect(await lstat(join(root, '.cursor')).catch(() => null)).toBeNull();
  await rm(join(root, '.agents/skills/agentic-ddd'));
  await mkdir(join(root, '.codex'), { recursive: true });
  await writeFile(
    join(root, '.codex/config.toml'),
    'model = "session-model"\n',
  );
  expect(install(root).code).toBe(0);
  expect(await readFile(join(root, '.codex/config.toml'), 'utf8')).toBe(
    'model = "session-model"\n',
  );
});

test('compile preserva links e adaptadores instalados em raiz user', async () => {
  const root = await workspace();
  expect(install(root, '--scope', 'user').code).toBe(0);
  const compile = () =>
    Bun.spawnSync(
      [
        'bun',
        join(ROOT, 'src/cli/main.ts'),
        'compile',
        '--config',
        join(ROOT, 'agentic.config.ts'),
        '--out-root',
        root,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
  expect(compile().exitCode).toBe(0);
  expect(compile().exitCode).toBe(0);
  expect(install(root, '--scope', 'user', '--check').code).toBe(0);
}, 15_000);
