export abstract class ValueObject<P extends object> {
  readonly props: Readonly<P>;

  protected constructor(props: P) {
    this.props = copyRecord(props, new WeakMap()) as Readonly<P>;
  }

  equals(other: ValueObject<P> | null | undefined): boolean {
    return (
      other != null &&
      other.constructor === this.constructor &&
      deepEqual(this.props, other.props)
    );
  }
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function copyRecord(
  source: object,
  seen: WeakMap<object, unknown>,
): Record<string, unknown> {
  const copy = Object.create(Object.getPrototypeOf(source)) as Record<
    string,
    unknown
  >;
  seen.set(source, copy);
  for (const [key, value] of Object.entries(source)) {
    copy[key] = copyDeep(value, seen);
  }
  return Object.freeze(copy);
}

// Copia objetos simples, arrays, Date, Map e Set e congela o que for copiado.
// Instâncias de outras classes (como outro ValueObject) ficam por referência.
function copyDeep(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value);
  if (value instanceof Map) {
    const copy = new Map<unknown, unknown>();
    seen.set(value, copy);
    for (const [k, v] of value) copy.set(copyDeep(k, seen), copyDeep(v, seen));
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set<unknown>();
    seen.set(value, copy);
    for (const item of value) copy.add(copyDeep(item, seen));
    return copy;
  }
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(copyDeep(item, seen));
    return Object.freeze(copy);
  }
  if (isPlainObject(value)) return copyRecord(value, seen);
  return value;
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
