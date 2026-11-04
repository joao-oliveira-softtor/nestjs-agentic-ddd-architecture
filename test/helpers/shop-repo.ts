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
    {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      // A fixed date makes the base commit id, and so the bundle hash, the same on every run.
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
        GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
      },
    },
  );
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  return run.stdout.toString().trim();
}

/** A committed, compiled `shop` project under `<repo>/.tmp` (so the repo `node_modules` resolves). */
export async function shopRepo(
  mutateAfterCompile?: (root: string) => Promise<void>,
  prefix = 'mcp-shop-',
): Promise<{ root: string; ref: string; work: string }> {
  await mkdir(join(ROOT, '.tmp'), { recursive: true });
  const root = await mkdtemp(join(ROOT, '.tmp', prefix));
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
  // No absolute `extends`: the committed tree, and so the bundle hash, must not depend on the checkout
  // path. The fixture sits at `<repo>/.tmp/<dir>` and its candidate worktree at `<repo>/.tmp/<dir>/.tmp/<dir>`,
  // so each alias lists the relative path from both depths.
  const alias = (src: string) => [`../../${src}`, `../../../../${src}`];
  await writeFile(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        paths: Object.fromEntries(
          ['core', 'decorators', 'compiler', 'testing', 'runtime'].map((m) => [
            `@agentic-ddd/${m}`,
            alias(`src/${m}/index.ts`),
          ]),
        ),
      },
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
  await mutateAfterCompile?.(root);
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  return { root, ref: git(root, 'rev-parse', 'HEAD'), work: join(root, '.tmp') };
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
