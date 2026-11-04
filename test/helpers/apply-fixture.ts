import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { additionDelta } from '../../src/compiler/delta/additions-fixture';
import {
  compileBundle,
  type Bundle,
  type BundleFile,
} from '../../src/compiler/bundle/index';
import { buildManifest } from '../../src/compiler/bundle/manifest';
import { git, shopRepo } from './shop-repo';

const ROOT = resolve(import.meta.dir, '../..');
/** Files of a bundle directory that are derived from the others and never hashed. */
const DERIVED = new Set(['bundle.json', 'BUNDLE.md']);

export const PROPOSAL = {
  slug: 'refund-paid-order',
  markdown: [
    '---',
    'id: "0001"',
    'title: Refund a paid order',
    'status: proposed',
    'origin: proposal-first',
    'delta:',
    '  added: []',
    '  modified: []',
    '  removed: []',
    'acceptance: []',
    '---',
    '',
    '## Motivo',
    '',
    'Customers ask for refunds.',
    '',
  ].join('\n'),
};

export async function writeBundle(dir: string, bundle: Bundle) {
  for (const f of bundle.files) {
    const abs = join(dir, f.path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, f.content);
  }
}

/** A clone of `from` at `ref`, under `.tmp` so the repository `node_modules` resolves. */
export async function cloneAt(from: string, ref: string): Promise<string> {
  const target = await mkdtemp(join(ROOT, '.tmp', 'apply-target-'));
  git(target, 'init', '-q');
  git(target, 'fetch', '-q', from, ref);
  git(target, 'checkout', '-q', '--detach', 'FETCH_HEAD');
  return target;
}

/** A shop base repo, its bundle written to a directory, and a fresh clone at the base ref. */
export async function applyFixture() {
  const repo = await shopRepo();
  const ref = git(repo.root, 'rev-parse', 'HEAD');
  const bundle: Bundle = await compileBundle({
    delta: additionDelta(),
    baseRoot: repo.root,
    baseRef: ref,
    proposal: PROPOSAL,
  });
  const dir = await mkdtemp(join(ROOT, '.tmp', 'bundle-dir-'));
  await writeBundle(dir, bundle);
  return { repo, ref, bundle, dir };
}

/**
 * A copy of the fixture bundle whose files went through `edit` and whose manifest (hashes, optional
 * new base) is rebuilt to match: an intact bundle, so only the apply rules can refuse it.
 */
export async function rewriteBundle(
  fx: { bundle: Bundle },
  edit: (files: BundleFile[]) => BundleFile[],
  base: { baseRef?: string; baseLockHash?: string } = {},
): Promise<string> {
  const files = edit(
    fx.bundle.files.filter((f) => !DERIVED.has(f.path)).map((f) => ({ ...f })),
  );
  const {
    files: _files,
    hash: _hash,
    version: _v,
    ...rest
  } = fx.bundle.manifest;
  const manifest = buildManifest({ ...rest, ...base }, files);
  const dir = await mkdtemp(join(ROOT, '.tmp', 'bundle-dir-'));
  await writeBundle(dir, {
    ...fx.bundle,
    files: [
      ...files,
      { path: 'bundle.json', content: JSON.stringify(manifest, null, 2) },
    ],
  });
  return dir;
}

/** The fixture bundle plus `files` (bundle-relative path to content). */
export const bundleWith = (
  fx: { bundle: Bundle },
  files: Record<string, string>,
  base?: { baseRef?: string; baseLockHash?: string },
) =>
  rewriteBundle(
    fx,
    (all) => [
      ...all,
      ...Object.entries(files).map(([path, content]) => ({ path, content })),
    ],
    base,
  );

/**
 * The shop project committed one folder down in a repository (a monorepo), with the fixture bundle
 * rebased on that commit. The project files keep their bytes, so the lock hash is unchanged.
 */
export async function monorepoFixture(fx: {
  bundle: Bundle;
  ref: string;
  repo: { root: string };
}) {
  const clone = await cloneAt(fx.repo.root, fx.ref);
  const root = await mkdtemp(join(ROOT, '.tmp', 'mono-'));
  const project = join(root, 'sub');
  await cp(clone, project, {
    recursive: true,
    filter: (src) => !/(^|[\\/])(\.git|\.tmp)$/.test(src),
  });
  await rm(clone, { recursive: true, force: true });
  // One folder deeper than the fixture: the framework aliases need one more `../`.
  const tsconfig = join(project, 'tsconfig.json');
  const parsed = JSON.parse(await readFile(tsconfig, 'utf8'));
  for (const alias of Object.keys(parsed.compilerOptions.paths))
    parsed.compilerOptions.paths[alias] = [
      `../../../src/${alias.split('/')[1]}/index.ts`,
    ];
  await writeFile(tsconfig, JSON.stringify(parsed));
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'monorepo base');
  const dir = await rewriteBundle(fx, (files) => files, {
    baseRef: git(root, 'rev-parse', 'HEAD'),
  });
  return { root, project, dir };
}

/** Every file of the tree but `.git` and `.tmp`, as bytes. */
export async function snapshot(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const e of entries) {
    const rel = relative(root, join(e.parentPath, e.name)).replaceAll(
      '\\',
      '/',
    );
    if (!e.isFile() || /^(\.git|\.tmp)(\/|$)/.test(rel)) continue;
    out.set(rel, (await readFile(join(root, rel))).toString('latin1'));
  }
  return out;
}
