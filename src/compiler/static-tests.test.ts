import { expect, test } from 'bun:test';
import { parseStaticTests } from './static-tests';

test('lê só declarações literais de teste, diagnostica dinâmicas, não conta helpers soltos', () => {
  const result = parseStaticTests(
    `
import { covers as cov } from '@agentic-ddd/testing';
const uncalled = covers(['method:A.unused'], 'não é teste');
test(cov(['invariant:A/a', 'method:A.go'], 'literal'), () => { throw Error('nunca executar'); });
it.skip('[covers: usecase:x] skipped', () => {});
test(covers(ids, 'dinâmico'), () => {});
test('[covers: operator:o] literal', () => {});
test(covers(['method:A.x'], title), () => {});
`,
    'a.test.ts',
  );
  expect(result.cases.map((t) => t.covers)).toEqual([
    ['invariant:A/a', 'method:A.go'],
    ['usecase:x'],
    ['operator:o'],
  ]);
  expect(result.diagnostics).toHaveLength(2);
});
