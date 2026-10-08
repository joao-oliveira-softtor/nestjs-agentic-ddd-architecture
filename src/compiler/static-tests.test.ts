import { expect, test } from 'bun:test';
import { parseStaticTests } from './static-tests';

test('lê só declarações literais de teste, diagnostica dinâmicas, não conta helpers soltos', () => {
  const result = parseStaticTests(
    `
import { covers as cov } from '@agentic-ddd/testing';
import { test, it } from 'bun:test';
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

test('não conta função local como teste; each dinâmico é diagnosticado e todo literal é evidência skipped', () => {
  const fake = parseStaticTests(
    `function test(...args: unknown[]) {} test('[covers: method:A.fake] fake', () => {});`,
    'fake.test.ts',
  );
  expect(fake.cases).toEqual([]);
  const actual = parseStaticTests(
    `import { test } from 'bun:test'; import { covers } from '@agentic-ddd/testing';
test.each(rows)(covers(['method:A.each'], 'dinâmico'), () => {});
test.todo(covers(['method:A.todo'], 'pendente'));
`,
    'real.test.ts',
  );
  expect(actual.cases.map((c) => c.covers)).toEqual([['method:A.todo']]);
  expect(actual.diagnostics).toHaveLength(1);
});
