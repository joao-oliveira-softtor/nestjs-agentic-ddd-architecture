export abstract class ValueObject<P extends object> {
  readonly props: Readonly<P>;

  protected constructor(props: P) {
    this.props = Object.freeze({ ...props });
  }

  equals(other: ValueObject<P> | null | undefined): boolean {
    return (
      other != null &&
      other.constructor === this.constructor &&
      deepEqual(this.props, other.props)
    );
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a === null ||
    b === null
  )
    return false;
  if (a.constructor !== b.constructor) return false;

  // Handle Date
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  // Handle Set
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false;
    const aArray = Array.from(a);
    const bArray = Array.from(b);
    return aArray.every((item, index) => deepEqual(item, bArray[index]));
  }

  // Handle Map
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false;
    const aEntries = Array.from(a.entries());
    const bEntries = Array.from(b.entries());
    return aEntries.every((entry, index) => deepEqual(entry, bEntries[index]));
  }

  // Handle Array
  if (Array.isArray(a)) {
    if (a.length !== (b as unknown[]).length) return false;
    return a.every((item, index) => deepEqual(item, (b as unknown[])[index]));
  }

  // Handle plain objects
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => deepEqual(left[key], right[key]));
}
