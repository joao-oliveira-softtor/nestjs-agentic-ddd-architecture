import { describe, expect, test } from 'bun:test';
import { isInModule, moduleOfPath } from './module-path';

describe('isInModule', () => {
  const cases: [string, string, string, boolean][] = [
    ['the exact module path', 'examples/orders', 'examples/orders', true],
    [
      'a nested file',
      'examples/orders',
      'examples/orders/domain/order.ts',
      true,
    ],
    [
      'a sibling sharing the prefix with a dash',
      'examples/orders',
      'examples/orders-extra/a.ts',
      false,
    ],
    [
      'a sibling sharing the prefix without a separator',
      'examples/orders',
      'examples/ordersX/a.ts',
      false,
    ],
    ['a top-level sibling prefix', 'orders', 'orders-archive/a.ts', false],
    ['a path outside the module', 'examples/orders', 'src/core/a.ts', false],
    ['a parent of the module', 'examples/orders', 'examples', false],
    [
      'a file argument with a trailing slash (it starts with the module path and a slash)',
      'examples/orders',
      'examples/orders/',
      true,
    ],
    [
      'a trailing-slash module path (nothing matches the doubled slash)',
      'examples/orders/',
      'examples/orders/a.ts',
      false,
    ],
  ];

  test.each(cases)('%s', (_title, modulePath, file, expected) => {
    expect(isInModule(file, modulePath)).toBe(expected);
  });
});

describe('moduleOfPath', () => {
  const parent = { name: 'root', path: 'examples' };
  const child = { name: 'orders', path: 'examples/orders' };
  const sibling = { name: 'archive', path: 'examples/orders-archive' };

  test('returns undefined for an empty module list', () => {
    expect(moduleOfPath([], 'examples/orders/a.ts')).toBeUndefined();
  });

  test('returns undefined for a path outside every module', () => {
    expect(moduleOfPath([child, sibling], 'src/core/a.ts')).toBeUndefined();
  });

  test('returns the module for its exact path and for nested files', () => {
    expect(moduleOfPath([child], 'examples/orders')).toBe(child);
    expect(moduleOfPath([child], 'examples/orders/domain/o.ts')).toBe(child);
  });

  test('does not match a sibling that only shares a name prefix', () => {
    expect(moduleOfPath([child], 'examples/orders-extra/a.ts')).toBeUndefined();
    expect(moduleOfPath([child], 'examples/ordersX/a.ts')).toBeUndefined();
    expect(moduleOfPath([child, sibling], 'examples/orders-archive/a.ts')).toBe(
      sibling,
    );
  });

  test('does not match a parent of the module', () => {
    expect(moduleOfPath([child], 'examples')).toBeUndefined();
  });

  test('picks the longest module path for nested modules, whatever the order', () => {
    expect(moduleOfPath([parent, child], 'examples/orders/a.ts')).toBe(child);
    expect(moduleOfPath([child, parent], 'examples/orders/a.ts')).toBe(child);
    expect(moduleOfPath([parent, child], 'examples/other/a.ts')).toBe(parent);
    expect(moduleOfPath([child, parent], 'examples/other/a.ts')).toBe(parent);
  });

  test('keeps the shape of the input modules', () => {
    const rich = { name: 'm', path: 'a', extra: 1 };
    expect(moduleOfPath([rich], 'a/x.ts')?.extra).toBe(1);
  });
});
