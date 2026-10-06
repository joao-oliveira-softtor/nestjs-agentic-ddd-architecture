import { readFile } from 'node:fs/promises';
import { stableStringify } from './canonical';
import type { DiffItem } from './diff';
import type { IR } from './ir';

export const LOCK_VERSION = 1;

export interface LockChange {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly summary: string;
  readonly hash: string;
  readonly items: DiffItem[];
}

export interface DomainLock {
  readonly lockVersion: 1;
  readonly ir: IR;
  readonly changes: LockChange[];
}

export function serializeLock(lock: DomainLock): string {
  return stableStringify(lock);
}

export function parseLock(text: string, displayPath: string): DomainLock {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${displayPath}: lock inválido (JSON malformado); restaure-o pelo git`);
  }
  const lock = (data ?? {}) as Partial<DomainLock>;
  if (lock.lockVersion !== LOCK_VERSION) {
    throw new Error(`${displayPath}: lockVersion ${String(lock.lockVersion)} não suportada (esperado ${LOCK_VERSION})`);
  }
  if (!lock.ir || lock.ir.irVersion !== 1 || !Array.isArray(lock.changes)) {
    throw new Error(`${displayPath}: lock incompleto (faltam ir ou changes)`);
  }
  return lock as DomainLock;
}

export async function readLock(absolutePath: string, displayPath: string): Promise<DomainLock | null> {
  let text: string;
  try {
    text = await readFile(absolutePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return parseLock(text, displayPath);
}
