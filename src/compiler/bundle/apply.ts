import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { sha256, stableStringify } from '../canonical';
import { loadConfig } from '../config';
import { AgenticError, toPosix } from '../ir';
import { defaultCliEntry, quote } from './candidate';
import { buildManifest, toLf, type BundleManifest } from './manifest';

export interface ApplyOptions {
  /** A directory holding the files of a bundle, `bundle.json` included. */
  readonly bundleDir: string;
  /** The root of the target git repository (the one with `agentic.config.ts`). */
  readonly projectRoot: string;
  /** TEST-ONLY: replaces the CLI entry that runs `compile`. */
  readonly cliEntry?: string;
  /** TEST-ONLY: called before each file is moved into place; a throw simulates a failed write. */
  readonly beforeMove?: (index: number) => void;
}

export interface ApplyResult {
  /** `NNNN-slug` of the change directory written, when the bundle carries a proposal. */
  readonly change?: string;
  /** Project-relative paths written (compile outputs not included). */
  readonly written: readonly string[];
}

const CONFIG = 'agentic.config.ts';
const DERIVED = new Set(['bundle.json', 'BUNDLE.md']);
const SKELETON = 'target/skeleton/';
const CHANGES = 'target/changes/';

async function exec(cwd: string, cmd: readonly string[]) {
  const child = Bun.spawn([...cmd], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

const git = (cwd: string, ...args: string[]) => exec(cwd, ['git', ...args]);

const text = (path: string): Promise<string | null> =>
  readFile(path, 'utf8')
    .then(toLf)
    .catch(() => null);

async function readBundle(dir: string): Promise<{
  manifest: BundleManifest;
  files: Map<string, string>;
}> {
  const mismatch = (why: string) =>
    new AgenticError('apply.hash-mismatch', `the bundle is not intact: ${why}`);
  const manifestText = await text(join(dir, 'bundle.json'));
  if (manifestText === null) throw mismatch('bundle.json is missing');
  const files = new Map<string, string>();
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    const rel = toPosix(relative(dir, join(e.parentPath, e.name)));
    if (!DERIVED.has(rel))
      files.set(rel, toLf(await readFile(join(e.parentPath, e.name), 'utf8')));
  }
  let manifest: BundleManifest;
  let rebuilt: BundleManifest;
  try {
    manifest = JSON.parse(manifestText) as BundleManifest;
    const { files: _files, hash: _hash, version: _version, ...rest } = manifest;
    rebuilt = buildManifest(
      rest,
      [...files].map(([path, content]) => ({ path, content })),
    );
  } catch {
    throw mismatch('bundle.json is not a manifest');
  }
  const listed = new Map(manifest.files.map((f) => [f.path, f.sha256]));
  const offending =
    [...files.keys()].find((p) => !listed.has(p)) ??
    [...listed.keys()].find((p) => !files.has(p)) ??
    rebuilt.files.find((f) => listed.get(f.path) !== f.sha256)?.path;
  if (offending !== undefined)
    throw mismatch(`${quote(offending)} differs from the manifest`);
  if (rebuilt.hash !== manifest.hash)
    throw mismatch('the manifest does not match its hash');
  return { manifest, files };
}

interface Planned {
  /** Project-relative, forward slashes. */
  readonly rel: string;
  readonly content: string;
}

/** Skeleton files, the change directory and its `examples.json`, as project-relative writes. */
function plan(
  manifest: BundleManifest,
  files: Map<string, string>,
  changesRel: string,
): { planned: Planned[]; change?: string } {
  const planned: Planned[] = [];
  const changes = new Set<string>();
  for (const [path, content] of [...files].sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    if (path.startsWith(SKELETON))
      planned.push({ rel: path.slice(SKELETON.length), content });
    else if (path.startsWith(CHANGES)) {
      const sub = path.slice(CHANGES.length);
      changes.add(sub.split('/')[0]!);
      planned.push({ rel: `${changesRel}/${sub}`, content });
    }
  }
  const [change] = [...changes];
  if (change !== undefined)
    planned.push({
      rel: `${changesRel}/${change}/examples.json`,
      content: toLf(stableStringify(manifest.examples)),
    });
  return { planned, change };
}

async function checkBase(
  root: string,
  manifest: BundleManifest,
  lockRel: string,
  planned: readonly Planned[],
): Promise<void> {
  const mismatch = (why: string) =>
    new AgenticError('apply.base-mismatch', why);
  const ref = manifest.baseRef;
  const known =
    !ref.startsWith('-') &&
    (await git(root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`))
      .code === 0;
  if (!known)
    throw mismatch(`base ref ${quote(ref)} is not a commit of this repository`);
  const lock = await git(root, 'show', `HEAD:${lockRel}`);
  if (lock.code !== 0 || sha256(toLf(lock.stdout)) !== manifest.baseLockHash)
    throw mismatch(
      `the committed ${lockRel} at HEAD is not the lock the bundle was compiled against`,
    );
  for (const { rel } of planned) {
    const base = await git(root, 'show', `${ref}:${rel}`);
    const atBase = base.code === 0 ? toLf(base.stdout) : null;
    if ((await text(join(root, rel))) !== atBase)
      throw mismatch(
        `${quote(rel)} differs from its content at the base ref (the bundle would overwrite local work)`,
      );
  }
}

/** Moves staged files into place; on any failure puts back every original and removes the rest. */
async function moveAll(
  stage: string,
  root: string,
  planned: readonly Planned[],
  beforeMove?: (index: number) => void,
): Promise<() => Promise<void>> {
  const done: { abs: string; backup?: string }[] = [];
  const dirs: string[] = [];
  const rollback = async () => {
    for (const { abs, backup } of done.reverse()) {
      await rm(abs, { force: true });
      if (backup) await rename(backup, abs);
    }
    for (const dir of dirs.reverse())
      await rm(dir, { recursive: true, force: true });
  };
  try {
    for (const [i, { rel }] of planned.entries()) {
      beforeMove?.(i);
      const abs = join(root, rel);
      const created = await mkdir(dirname(abs), { recursive: true });
      if (created) dirs.push(created);
      const original = await readFile(abs).then(
        () => true,
        () => false,
      );
      let backup: string | undefined;
      if (original) {
        backup = join(stage, 'backup', rel);
        await mkdir(dirname(backup), { recursive: true });
        await rename(abs, backup);
      }
      done.push({ abs, backup });
      await rename(join(stage, 'new', rel), abs);
    }
  } catch (error) {
    await rollback();
    throw new AgenticError(
      'apply.write-failed',
      `could not write the bundle, nothing was changed: ${(error as Error).message}`,
    );
  }
  return rollback;
}

/**
 * Applies a bundle written by `compileBundle` to the project at its base: verifies the content
 * hash, checks the base (committed lock, base ref, untouched target files), stages every write
 * under `<project>/.tmp`, moves it into place all-or-nothing, then runs `compile`. A compile
 * failure puts every file back.
 */
export async function applyBundle(options: ApplyOptions): Promise<ApplyResult> {
  const root = resolve(options.projectRoot);
  const { manifest, files } = await readBundle(options.bundleDir);
  const config = await loadConfig(join(root, CONFIG));
  const rel = (abs: string) => toPosix(relative(root, abs));
  const changesAbs = join(config.outRoot, config.changesDir);
  const { planned, change } = plan(manifest, files, rel(changesAbs));
  for (const { rel: p } of planned) {
    const back = relative(root, resolve(root, p));
    if (back === '' || back.startsWith('..') || isAbsolute(back))
      throw new AgenticError(
        'apply.path-escape',
        `bundle path ${quote(p)} resolves outside the project`,
      );
  }
  if (change !== undefined) {
    const id = change.slice(0, 4);
    const existing = (await readdir(changesAbs).catch(() => [])).find(
      (n) => n === id || n.startsWith(`${id}-`),
    );
    if (existing !== undefined)
      throw new AgenticError(
        'apply.change-exists',
        `change ${id} already exists as ${quote(`${rel(changesAbs)}/${existing}`)}`,
      );
  }
  await checkBase(
    root,
    manifest,
    rel(join(config.outRoot, config.out.lock)),
    planned,
  );

  await mkdir(join(root, '.tmp'), { recursive: true });
  const stage = await mkdtemp(join(root, '.tmp', 'apply-'));
  try {
    for (const { rel: p, content } of planned) {
      await mkdir(dirname(join(stage, 'new', p)), { recursive: true });
      await Bun.write(join(stage, 'new', p), content);
    }
    const rollback = await moveAll(stage, root, planned, options.beforeMove);
    const compiled = await exec(root, [
      process.execPath,
      '--no-install',
      options.cliEntry ?? defaultCliEntry(),
      'compile',
      '--config',
      CONFIG,
    ]);
    if (compiled.code !== 0) {
      await rollback();
      throw new AgenticError(
        'apply.compile-failed',
        `compile failed after writing the bundle, nothing was changed: ${quote(compiled.stderr.trim(), 2000)}`,
      );
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  return { change, written: planned.map((p) => p.rel) };
}
