import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  checkSnapshot,
  SNAPSHOT_PATH,
  sourceLines,
  writeSnapshot,
} from './snapshot';

const LOCK = JSON.stringify({
  lockVersion: 1,
  ir: {
    irVersion: 1,
    modules: [{ name: 'm', path: 'mod' }],
    entities: [],
    events: [],
    useCases: [],
    operators: [],
  },
  changes: [],
});

let dir: string; // outRoot
let proj: string; // root do projeto (dir ou subpasta)

async function setup(sub = '') {
  proj = join(dir, sub);
  await mkdir(join(proj, 'mod'), { recursive: true });
  await mkdir(join(proj, '.ai/rules'), { recursive: true });
  await writeFile(join(proj, 'mod/a.ts'), 'export const a = 1;\n');
  await writeFile(join(proj, '.ai/rules/r.md'), '- regra\n');
  await writeFile(join(proj, 'agentic.config.ts'), 'export default {};\n');
  await mkdir(join(dir, '.agentic'), { recursive: true });
  await writeFile(join(dir, '.agentic/domain.lock.json'), LOCK);
  await writeSnapshot(dir, {
    root: sub === '' ? '.' : sub,
    config: sub === '' ? 'agentic.config.ts' : `${sub}/agentic.config.ts`,
    lock: '.agentic/domain.lock.json',
    rulesDir: '.ai/rules',
    rules: [],
    modules: [{ path: 'mod' }],
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agentic-snap-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('snapshot do MCP', () => {
  test('em dia logo após gravar; .gitignore ao lado', async () => {
    await setup();
    expect((await checkSnapshot(dir)).ok).toBe(true);
    expect(await Bun.file(join(dir, '.agentic/mcp/.gitignore')).text()).toBe(
      '*\n',
    );
  });

  test('root diferente do outRoot (caminho com ..)', async () => {
    await mkdir(join(dir, 'out'));
    await mkdir(join(dir, 'proj'));
    const out = join(dir, 'out');
    proj = join(dir, 'proj');
    await mkdir(join(proj, 'mod'));
    await writeFile(join(proj, 'mod/a.ts'), 'x\n');
    await writeFile(join(proj, 'agentic.config.ts'), 'c\n');
    await mkdir(join(out, '.agentic'), { recursive: true });
    await writeFile(join(out, '.agentic/domain.lock.json'), LOCK);
    await writeSnapshot(out, {
      root: '../proj',
      config: '../proj/agentic.config.ts',
      lock: '.agentic/domain.lock.json',
      rulesDir: '.ai/rules',
      rules: [],
      modules: [{ path: 'mod' }],
    });
    expect((await checkSnapshot(out)).ok).toBe(true);
    await writeFile(join(proj, 'mod/a.ts'), 'y\n');
    expect((await checkSnapshot(out)).ok).toBe(false);
  });

  test('fonte editada depois do hash do compile: snapshot nasce desatualizado', async () => {
    await setup();
    const place = {
      root: '.',
      config: 'agentic.config.ts',
      rulesDir: '.ai/rules',
    };
    const sources = await sourceLines(dir, place, [{ path: 'mod' }]);
    await writeFile(join(proj, 'mod/a.ts'), 'export const a = 2;\n');
    await writeSnapshot(
      dir,
      {
        ...place,
        lock: '.agentic/domain.lock.json',
        rules: [],
        modules: [{ path: 'mod' }],
      },
      sources,
    );
    expect((await checkSnapshot(dir)).ok).toBe(false);
  });

  test('projeto sem pasta de regras fica em dia', async () => {
    await setup();
    await rm(join(proj, '.ai'), { recursive: true });
    await writeSnapshot(dir, {
      root: '.',
      config: 'agentic.config.ts',
      lock: '.agentic/domain.lock.json',
      rulesDir: '.ai/rules',
      rules: [],
      modules: [{ path: 'mod' }],
    });
    expect((await checkSnapshot(dir)).ok).toBe(true);
  });

  const stale: [string, () => Promise<void>][] = [
    ['arquivo de módulo muda', () => writeFile(join(proj, 'mod/a.ts'), 'z\n')],
    ['arquivo novo no módulo', () => writeFile(join(proj, 'mod/b.ts'), 'b\n')],
    [
      'arquivo renomeado',
      () => rename(join(proj, 'mod/a.ts'), join(proj, 'mod/c.ts')),
    ],
    ['regra muda', () => writeFile(join(proj, '.ai/rules/r.md'), '- outra\n')],
    ['regra nova', () => writeFile(join(proj, '.ai/rules/n.md'), '- n\n')],
    ['config muda', () => writeFile(join(proj, 'agentic.config.ts'), '// x\n')],
    [
      'lock muda',
      () => writeFile(join(dir, '.agentic/domain.lock.json'), `${LOCK}\n`),
    ],
    [
      'rules editadas à mão no snapshot',
      async () => {
        const f = join(dir, SNAPSHOT_PATH);
        const j = JSON.parse(await readFile(f, 'utf8'));
        j.rules = [{ key: 'x', file: null, paths: [], body: 'x' }];
        await writeFile(f, JSON.stringify(j));
      },
    ],
    [
      // snapshot adulterado não pode travar o servidor lendo um dispositivo
      'config apontando para /dev/zero',
      async () => {
        const f = join(dir, SNAPSHOT_PATH);
        const j = JSON.parse(await readFile(f, 'utf8'));
        j.config = relative(dir, '/dev/zero');
        await writeFile(f, JSON.stringify(j));
      },
    ],
    ['snapshot ausente', () => rm(join(dir, SNAPSHOT_PATH))],
    ['JSON inválido', () => writeFile(join(dir, SNAPSHOT_PATH), '{')],
  ];
  for (const [name, mutate] of stale)
    test(`desatualizado: ${name}`, async () => {
      await setup();
      await mutate();
      const r = await checkSnapshot(dir);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain('agentic compile');
    });
});
