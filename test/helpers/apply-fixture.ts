import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { additionDelta } from '../../src/compiler/delta/additions-fixture';
import { compileBundle, type Bundle } from '../../src/compiler/bundle/index';
import { git, shopRepo } from './shop-repo';

const ROOT = resolve(import.meta.dir, '../..');

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
