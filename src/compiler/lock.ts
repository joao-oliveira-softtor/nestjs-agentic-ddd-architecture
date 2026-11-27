import { readFile } from 'node:fs/promises';
import { stableStringify } from './canonical';
import type { DiffItem } from './diff';
import { AgenticError, type IR } from './ir';

export const LOCK_VERSION = 1;

export interface LockChange {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly summary: string;
  readonly hash: string;
  readonly items: DiffItem[];
  /** `uses`/`emits` the change added to each modified use-case (#179); absent in locks written before. */
  readonly additions?: Record<string, string[]>;
}

export interface DomainLock {
  readonly lockVersion: 1;
  readonly ir: IR;
  readonly changes: LockChange[];
}

export function serializeLock(lock: DomainLock): string {
  return stableStringify(lock);
}

function isValidAdditions(value: unknown): boolean {
  if (value === undefined) return true;
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  return Object.values(value).every(
    (refs) => Array.isArray(refs) && refs.every((r) => typeof r === 'string'),
  );
}

function isValidChange(change: unknown): boolean {
  if (change === null || typeof change !== 'object' || Array.isArray(change))
    return false;
  const ch = change as Record<string, unknown>;
  return (
    ['id', 'title', 'path', 'summary', 'hash'].every(
      (k) => typeof ch[k] === 'string',
    ) &&
    Array.isArray(ch.items) &&
    isValidAdditions(ch.additions)
  );
}

function isValidLockStructure(lock: unknown): lock is DomainLock {
  if (lock === null || typeof lock !== 'object' || Array.isArray(lock))
    return false;
  const obj = lock as Record<string, unknown>;
  if (obj.lockVersion !== LOCK_VERSION) return false;
  const ir = obj.ir;
  if (ir === null || typeof ir !== 'object' || Array.isArray(ir)) return false;
  const irObj = ir as Record<string, unknown>;
  if (irObj.irVersion !== 1) return false;
  if (
    !Array.isArray(irObj.modules) ||
    !Array.isArray(irObj.entities) ||
    !Array.isArray(irObj.events) ||
    !Array.isArray(irObj.useCases) ||
    !Array.isArray(irObj.operators)
  ) {
    return false;
  }
  if (irObj.valueObjects !== undefined && !Array.isArray(irObj.valueObjects))
    return false;
  if (irObj.ports !== undefined && !Array.isArray(irObj.ports)) return false;
  if (irObj.adapters !== undefined && !Array.isArray(irObj.adapters))
    return false;
  if (!Array.isArray(obj.changes)) return false;
  return obj.changes.every(isValidChange);
}

export function parseLock(text: string, displayPath: string): DomainLock {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AgenticError(
      'lock.malformed',
      `${displayPath}: invalid lock (malformed JSON); restore it from git`,
    );
  }
  if (!isValidLockStructure(data)) {
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
      const obj = data as Record<string, unknown>;
      const lockVersion = obj.lockVersion;
      if (lockVersion !== undefined && lockVersion !== LOCK_VERSION) {
        const versionStr =
          typeof lockVersion === 'number'
            ? lockVersion
            : JSON.stringify(lockVersion);
        throw new AgenticError(
          'lock.version-unsupported',
          `${displayPath}: lockVersion ${versionStr} is not supported (expected 1); update @agentic-ddd or restore the lock from git`,
        );
      }
    }
    throw new AgenticError(
      'lock.incomplete',
      `${displayPath}: incomplete lock (missing ir or changes); restore it from git`,
    );
  }
  return data;
}

export async function readLock(
  absolutePath: string,
  displayPath: string,
): Promise<DomainLock | null> {
  let text: string;
  try {
    text = await readFile(absolutePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return parseLock(text, displayPath);
}
