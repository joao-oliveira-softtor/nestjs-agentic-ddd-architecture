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

// Compara sem depender da ordem: cada elemento de `a` consome um elemento
// ainda não usado de `b` (a igualdade profunda é uma equivalência, então o
// pareamento guloso basta). O(n²).
function unorderedEqual<T>(
  a: readonly T[],
  b: readonly T[],
  same: (x: T, y: T) => boolean,
): boolean {
  if (a.length !== b.length) return false;
  const used = new Set<number>();
  return a.every((item) => {
    const index = b.findIndex((other, i) => !used.has(i) && same(item, other));
    if (index === -1) return false;
    used.add(index);
    return true;
  });
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
    return unorderedEqual(Array.from(a), Array.from(b), deepEqual);
  }

  // Handle Map
  if (a instanceof Map && b instanceof Map) {
    return unorderedEqual(
      Array.from(a.entries()),
      Array.from(b.entries()),
      ([ak, av], [bk, bv]) => deepEqual(ak, bk) && deepEqual(av, bv),
    );
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
