import { afterEach, expect, test } from 'bun:test';
import {
  lstat,
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
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
function run(root: string, ...args: string[]) {
  const p = Bun.spawnSync(
    [
      'bun',
      join(ROOT, 'src/cli/main.ts'),
      ...args,
      '--config',
      join(root, 'agentic.config.ts'),
    ],
    { cwd: root, stdout: 'pipe', stderr: 'pipe' },
  );
  return {
    code: p.exitCode,
    stdout: p.stdout.toString(),
    stderr: p.stderr.toString(),
  };
}
async function create(symlinkedAncestor = false) {
  const base = await mkdtemp(join(tmpdir(), 'agentic-tutorial-'));
  dirs.push(base);
  const alias = join(base, 'alias');
  if (symlinkedAncestor) await symlink(base, alias, 'dir');
  const root = join(symlinkedAncestor ? alias : base, 'tasks');
  const p = Bun.spawnSync(
    ['bun', join(ROOT, 'scripts/create-skills-example.ts'), '--root', root],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  expect({ code: p.exitCode, error: p.stderr.toString() }).toEqual({
    code: 0,
    error: '',
  });
  return root;
}
async function outputs(root: string) {
  const paths = ['AGENTS.md', '.agentic/domain.lock.json'];
  for (const prefix of ['.agentic/runtime', '.agents/skills/tasks-dev'])
    for await (const file of new Bun.Glob('**/*').scan({
      cwd: join(root, prefix),
      onlyFiles: true,
    }))
      paths.push(`${prefix}/${file}`);
  return Object.fromEntries(
    await Promise.all(
      paths
        .sort()
        .map(
          async (path) =>
            [path, await readFile(join(root, path), 'utf8')] as const,
        ),
    ),
  );
}

test('example cria tutorial completo sob ancestral simbólico', async () => {
  const root = await create(true);
  for (const folder of ['.agents', '.claude'])
    expect(await realpath(join(root, folder, 'skills/agentic-ddd'))).toBe(
      join(ROOT, 'skills/agentic-ddd'),
    );
  const physicalRoot = await realpath(root);
  expect(run(physicalRoot, 'compile')).toMatchObject({ code: 0 });
  expect(run(physicalRoot, 'compile', '--check')).toMatchObject({ code: 0 });
});

test('example recusa destino existente e opções inválidas sem alterar arquivos', async () => {
  const root = await create();
  const config = await readFile(join(root, 'agentic.config.ts'), 'utf8');
  const p = Bun.spawnSync(
    ['bun', join(ROOT, 'scripts/create-skills-example.ts'), '--root', root],
    { stderr: 'pipe' },
  );
  expect(p.exitCode).toBe(1);
  expect(await readFile(join(root, 'agentic.config.ts'), 'utf8')).toBe(config);
  expect(
    Bun.spawnSync([
      'bun',
      join(ROOT, 'scripts/create-skills-example.ts'),
      '--bad',
    ]).exitCode,
  ).toBe(2);
});

test('tutorial tasks: sem testes → ondas → hash/gerados estáveis → verify change done; instalação preservada', async () => {
  const root = await create();
  expect([
    ...new Bun.Glob('**/*.test.ts').scanSync({ cwd: root, onlyFiles: true }),
  ]).toEqual([]);
  expect(
    await lstat(join(root, 'changes/0001-tasks/proposal.md')),
  ).toBeDefined();
  expect(run(root, 'compile').code).toBe(0);
  expect(
    await lstat(join(root, 'changes/archive/0001-tasks/proposal.md')),
  ).toBeDefined();
  const initial = await outputs(root);
  const adapters = Object.fromEntries(
    await Promise.all(
      ['cursor', 'codex', 'claude']
        .flatMap((target) =>
          ['manager', 'executor'].map(
            (role) =>
              `.${target}/agents/agentic-ddd-${role}.${target === 'codex' ? 'toml' : 'md'}`,
          ),
        )
        .map(
          async (path) =>
            [path, await readFile(join(root, path), 'utf8')] as const,
        ),
    ),
  );
  const status = run(root, 'status', '--json');
  expect(status.code).toBe(0);
  expect(
    JSON.parse(status.stdout).items.every(
      (item: { baseState: string }) => item.baseState !== 'done',
    ),
  ).toBe(true);
  const waves = [
    ['entity:Task'],
    ['method:Task.complete', 'usecase:create_task'],
    ['usecase:complete_task'],
    ['operator:task-operator'],
  ];
  expect(
    JSON.parse(run(root, 'next', '--change', '0001', '--json').stdout).waves,
  ).toEqual(waves);
  const hashes = new Map<string, string>();
  for (const id of waves.flat()) {
    const packet = run(root, 'packet', id);
    expect(packet.code).toBe(0);
    hashes.set(id, /specHash: `([a-f0-9]{64})`/.exec(packet.stdout)![1]!);
  }
  expect(
    run(
      root,
      'verify',
      '--item',
      'entity:Task',
      '--spec-hash',
      hashes.get('entity:Task')!,
      '--json',
    ).code,
  ).toBe(1);
  // Test-only solutions are never copied into a user's initial tutorial workspace.
  const { completeItem } = await import('./helpers/tasks-solution');
  for (let n = 0; n < waves.length; n++) {
    for (const id of waves[n]!) {
      await completeItem(root, id);
      const report = run(
        root,
        'verify',
        '--item',
        id,
        '--spec-hash',
        hashes.get(id)!,
        '--json',
      );
      expect({
        id,
        code: report.code,
        status: JSON.parse(report.stdout).status,
      }).toEqual({ id, code: 0, status: 'done' });
    }
    expect(
      JSON.parse(run(root, 'next', '--change', '0001', '--json').stdout).waves,
    ).toEqual(waves.slice(n + 1));
    expect(run(root, 'compile', '--check').code).toBe(0);
    expect(await outputs(root)).toEqual(initial);
  }
  const path = join(root, 'app/domain/task.ts');
  const original = await readFile(path, 'utf8');
  await writeFile(
    path,
    original.replace(
      'Toda tarefa precisa de título não vazio.',
      'Toda tarefa precisa de um novo título.',
    ),
  );
  const altered = run(
    root,
    'verify',
    '--item',
    'entity:Task',
    '--spec-hash',
    hashes.get('entity:Task')!,
    '--json',
  );
  expect(altered.code).toBe(1);
  expect(
    JSON.parse(altered.stdout).gates.find((g: { id: string }) => g.id === 'I3')
      .status,
  ).toBe('failed');
  await writeFile(path, original);
  const final = run(root, 'verify', '0001');
  expect({ code: final.code, status: JSON.parse(final.stdout).status }).toEqual(
    { code: 0, status: 'done' },
  );
  for (const [path, text] of Object.entries(adapters))
    expect(await readFile(join(root, path), 'utf8')).toBe(text);
  const check = Bun.spawnSync([
    'bun',
    join(ROOT, 'scripts/install-skills.ts'),
    '--root',
    root,
    '--check',
  ]);
  expect(check.exitCode).toBe(0);
}, 120_000);
