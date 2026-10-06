export abstract class ValueObject<P extends object> {
  readonly props: Readonly<P>;

  protected constructor(props: P) {
    this.props = Object.freeze({ ...props });
  }

  equals(other: ValueObject<P> | null | undefined): boolean {
    return other != null && other.constructor === this.constructor && deepEqual(this.props, other.props);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => deepEqual(left[key], right[key]));
}
