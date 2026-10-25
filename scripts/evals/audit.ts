import { lstat, opendir, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { AuditReport } from './contracts';
import { bodyOnlyFindings, classScopeFindings } from '../boundary-gates';
import { isClassScopeItem } from '../../src/compiler/packet';
import { sha256 } from './isolation';
import { findItem } from './tutorials';
import { readPrivateBytes } from './private-files';

export const AUDIT_FILE_LIMIT_BYTES = 256 * 1024;
export const AUDIT_TREE_LIMIT_BYTES = 4 * 1024 * 1024;
export const AUDIT_ENTRY_LIMIT = 1024;
export const AUDIT_PATCH_LIMIT_BYTES = 8 * 1024 * 1024;

export { TASK_ITEMS } from './tutorials';
export interface TreeEntry {
  kind: 'file' | 'link' | 'directory';
  mode: number;
  hash: string;
  content: string;
}
export async function readTree(root: string): Promise<Map<string, TreeEntry>> {
  const tree = new Map<string, TreeEntry>();
  let entries = 0,
    totalBytes = 0;
  async function visit(directory: string) {
    const handle = await opendir(join(root, directory));
    const names: string[] = [];
    try {
      let entry;
      while ((entry = await handle.read())) {
        if (++entries > AUDIT_ENTRY_LIMIT)
          throw Error('Submission entry limit');
        names.push(entry.name);
      }
    } finally {
      await handle.close();
    }
    for (const name of names.sort()) {
      const path = directory ? `${directory}/${name}` : name;
      const full = join(root, path);
      const stat = await lstat(full);
      const kind = stat.isSymbolicLink()
        ? 'link'
        : stat.isDirectory()
          ? 'directory'
          : 'file';
      if (kind === 'file' && !stat.isFile())
        throw Error(`Unsupported file type: ${path}`);
      if (kind === 'file' && stat.size > AUDIT_FILE_LIMIT_BYTES)
        throw Error('Submission per-file limit');
      if (kind === 'file' && stat.size > AUDIT_TREE_LIMIT_BYTES - totalBytes)
        throw Error('Submission aggregate limit');
      const bytes =
        kind === 'file'
          ? await readPrivateBytes(
              root,
              full,
              Math.min(
                AUDIT_FILE_LIMIT_BYTES,
                AUDIT_TREE_LIMIT_BYTES - totalBytes,
              ),
            )
          : Buffer.from(kind === 'link' ? await readlink(full) : '');
      totalBytes += bytes.byteLength;
      if (totalBytes > AUDIT_TREE_LIMIT_BYTES)
        throw Error('Submission aggregate limit');
      tree.set(path, {
        kind,
        mode: stat.mode,
        hash: sha256(bytes),
        content: bytes.toString('utf8'),
      });
      if (kind === 'directory') await visit(path);
    }
  }
  await visit('');
  return tree;
}
export async function treeHash(root: string): Promise<string> {
  return sha256(
    JSON.stringify(
      [...(await readTree(root))].map(([path, e]) => [
        path,
        e.kind,
        e.mode,
        e.hash,
      ]),
    ),
  );
}
/** Escopo de classe (VO/adapter) ou só o corpo do método. */
export function scopeFindings(
  item: string,
  before: string,
  after: string,
  className: string,
  method: string,
  path: string,
): string[] {
  return isClassScopeItem(item)
    ? classScopeFindings(before, after, className, path)
    : bodyOnlyFindings(before, after, className, method, path);
}
export async function auditSubmission(
  baselineRoot: string,
  submissionRoot: string,
  item: string,
): Promise<AuditReport> {
  const assignment = findItem(item);
  if (!assignment) throw Error(`Unknown assignment: ${item}`);
  const baseline = await readTree(baselineRoot);
  let submission: Map<string, TreeEntry>;
  try {
    submission = await readTree(submissionRoot);
  } catch (error) {
    return {
      ok: false,
      findings: [`Unsafe submission tree: ${String(error)}`],
      changedFiles: [],
      patch: '[]',
    };
  }
  const findings: string[] = [];
  const changedFiles: string[] = [];
  const changes: string[] = [];
  let patchBytes = 4;
  for (const path of [
    ...new Set([...baseline.keys(), ...submission.keys()]),
  ].sort()) {
    const before = baseline.get(path),
      after = submission.get(path);
    if (
      before?.kind === after?.kind &&
      before?.mode === after?.mode &&
      before?.hash === after?.hash
    )
      continue;
    changedFiles.push(path);
    const change = JSON.stringify(
      { path, before: before ?? null, after: after ?? null },
      null,
      2,
    ).replace(/^/gm, '  ');
    patchBytes += Buffer.byteLength(change) + (changes.length ? 2 : 0);
    if (patchBytes > AUDIT_PATCH_LIMIT_BYTES)
      return {
        ok: false,
        findings: [...findings, 'Submission patch limit'],
        changedFiles,
        patch: '[]',
      };
    changes.push(change);
    if (path === 'app/test' && !before && after?.kind === 'directory') continue;
    if (
      path === assignment.test &&
      !before &&
      after?.kind === 'file' &&
      (after.mode & 0o111) === 0
    )
      continue;
    if (
      path !== assignment.file ||
      before?.kind !== 'file' ||
      after?.kind !== 'file' ||
      before.mode !== after.mode
    ) {
      findings.push(`Forbidden file change: ${path}`);
      continue;
    }
    findings.push(
      ...scopeFindings(
        item,
        before.content,
        after.content,
        assignment.className!,
        assignment.method!,
        path,
      ),
    );
  }
  return {
    ok: findings.length === 0,
    findings,
    changedFiles,
    patch: changes.length ? `[\n${changes.join(',\n')}\n]` : '[]',
  };
}
