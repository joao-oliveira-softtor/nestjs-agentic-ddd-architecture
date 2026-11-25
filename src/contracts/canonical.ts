import { createHash } from 'node:crypto';

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) result[key] = canonicalize(source[key]);
    }
    return result;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export const toLf = (s: string): string => s.replaceAll('\r\n', '\n');

/** Plain code-unit comparison, so the order never depends on the locale. */
export const compareStrings = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

export function byId<T extends { readonly id: string }>(a: T, b: T): number {
  return compareStrings(a.id, b.id);
}
