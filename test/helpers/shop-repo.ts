import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { analyzeProject, compile } from '../../src/compiler/compile';
import { DEFAULT_CONVENTIONS } from '../../src/compiler/conventions';
import { baseDelta } from '../../src/compiler/delta/additions-fixture';
import { renderDelta } from '../../src/compiler/delta/render';
import { serializeLock } from '../../src/compiler/lock';

const ROOT = resolve(import.meta.dir, '../..');

export function git(cwd: string, ...args: string[]): string {
  const run = Bun.spawnSync(
    [
      'git',
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.autocrlf=false',
      ...args,
    ],
    { cwd, stdout: 'pipe', stderr: 'pipe' },
  );
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  return run.stdout.toString().trim();
}

/** A committed, compiled `shop` project under `<repo>/.tmp` (so the repo `node_modules` resolves). */
export async function shopRepo(): Promise<{ root: string; work: string }> {
  await mkdir(join(ROOT, '.tmp'), { recursive: true });
  const root = await mkdtemp(join(ROOT, '.tmp', 'mcp-shop-'));
  const rendered = renderDelta(baseDelta(), {
    conventions: DEFAULT_CONVENTIONS,
    existingFiles: [],
  });
  if (!rendered.ok) throw new Error(JSON.stringify(rendered.errors));
  for (const f of rendered.files) {
    const target = join(root, 'src/shop', f.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, f.content);
  }
  await writeFile(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      extends: join(ROOT, 'tsconfig.json').replaceAll('\\', '/'),
    }),
  );
  const configPath = join(root, 'agentic.config.ts');
  await writeFile(
    configPath,
    `import { defineConfig } from '@agentic-ddd/compiler';
export default defineConfig({ mirrors: [], modules: [{ name: 'shop', path: 'src/shop' }] });
`,
  );
  const { ir } = await analyzeProject({ configPath });
  await mkdir(join(root, '.agentic'), { recursive: true });
  await writeFile(
    join(root, '.agentic/domain.lock.json'),
    serializeLock({ lockVersion: 1, ir, changes: [] }),
  );
  const first = await compile({ configPath, mode: 'write' });
  if (!first.ok) throw new Error(JSON.stringify(first.errors));
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  return { root, work: join(root, '.tmp') };
}

/** What a call must leave as it found it: registered worktrees and the bundle temp dirs. */
export async function leftovers(repo: { root: string; work: string }) {
  return {
    dirs: (await readdir(repo.work).catch(() => [])).filter((n) =>
      n.startsWith('bundle-'),
    ),
    worktrees: git(repo.root, 'worktree', 'list', '--porcelain')
      .split('\n')
      .filter((l) => l.startsWith('worktree ')).length,
  };
}
