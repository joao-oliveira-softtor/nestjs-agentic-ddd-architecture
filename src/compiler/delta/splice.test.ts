import { describe, expect, test } from 'bun:test';
import { splice, type Fragment } from './splice';

const ENTITY = `import { AggregateRoot } from '@agentic-ddd/core';
import { AgentEntity } from '@agentic-ddd/decorators';

@AgentEntity({ description: 'An order.' })
export class Order extends AggregateRoot<string> {
  // hand-written
  pay(): void {
    this.total = 1;
  }
}
`;

const USE_CASE = `import { AgentUseCase } from '@agentic-ddd/decorators';

@AgentUseCase({
  name: 'pay_order',
  uses: ['method:Order.pay'],
  emits: [],
})
export class PayOrder {}
`;

const imp = (spec: string, name: string, typeOnly = false) => ({
  spec,
  name,
  typeOnly,
});

const member: Fragment = {
  path: 'domain/order.ts',
  imports: [
    imp('@agentic-ddd/core', 'notImplemented'),
    imp('@agentic-ddd/decorators', 'AgentMethod'),
    imp('./order.events', 'OrderRefunded'),
  ],
  target: { kind: 'class', name: 'Order' },
  classDecorators: ["@Invariant({ id: 'x', text: 'y' })"],
  members: [
    {
      name: 'refund',
      text: '  @AgentMethod({ description: \'d\' })\n  refund(): void {\n    return notImplemented();\n  }',
    },
  ],
};

const ok = (src: string, f: Fragment): string => {
  const r = splice(src, f);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.source;
};
const refused = (src: string, f: Fragment) => {
  const r = splice(src, f);
  if (r.ok) throw new Error('expected a refusal');
  return r.error;
};

describe('splice', () => {
  test('adds members before the closing brace, keeps hand-written code, merges imports', () => {
    const out = ok(ENTITY, member);
    expect(out).toContain('    this.total = 1;\n  }\n\n  @AgentMethod');
    expect(out).toContain('return notImplemented();\n  }\n}\n');
    expect(out).toContain(
      "import { AggregateRoot, notImplemented } from '@agentic-ddd/core';",
    );
    expect(out).toContain(
      "import { AgentEntity, AgentMethod } from '@agentic-ddd/decorators';\nimport { OrderRefunded } from './order.events';",
    );
    expect(out).toContain(
      "@AgentEntity({ description: 'An order.' })\n@Invariant({ id: 'x', text: 'y' })\nexport class Order",
    );
    expect(out).toContain('// hand-written');
  });

  test('is deterministic: same input, same bytes, and a second run with the same import order', () => {
    const shuffled = { ...member, imports: [...member.imports].reverse() };
    expect(ok(ENTITY, member)).toBe(ok(ENTITY, member));
    expect(ok(ENTITY, shuffled)).toBe(ok(ENTITY, member));
  });

  test('fills an empty class and creates the first import', () => {
    const out = ok("@AgentEntity({})\nexport class Order {}\n", {
      ...member,
      imports: [imp('@agentic-ddd/core', 'notImplemented')],
      classDecorators: [],
    });
    expect(out.startsWith("import { notImplemented } from '@agentic-ddd/core';\n\n@AgentEntity")).toBe(true);
    expect(out).toContain('export class Order {\n  @AgentMethod');
  });

  test('appends elements to the use-case arrays, empty or not, and is idempotent per element', () => {
    const f: Fragment = {
      path: 'application/pay-order.ts',
      imports: [imp('../domain/order.events', 'OrderRefunded')],
      target: { kind: 'use-case', name: 'pay_order' },
      arrays: [
        { property: 'uses', elements: ["'method:Order.refund'"] },
        { property: 'emits', elements: ['OrderRefunded'] },
      ],
    };
    const out = ok(USE_CASE, f);
    expect(out).toContain("uses: ['method:Order.pay', 'method:Order.refund'],");
    expect(out).toContain('emits: [OrderRefunded],');
    expect(ok(out, f)).toBe(out);
  });

  test('appends top-level statements at the end of the file', () => {
    const out = ok("export const a = 1;", {
      path: 'domain/order.events.ts',
      imports: [],
      target: null,
      appended: ['export const b = 2;'],
    });
    expect(out).toBe('export const a = 1;\n\nexport const b = 2;\n');
  });

  test.each<[string, string, Fragment, string]>([
    ['the class is missing', 'export class Other {}\n', member, 'delta.splice-anchor-missing'],
    ['the class has no decorator to anchor on', 'export class Order {}\n', member, 'delta.splice-anchor-missing'],
    [
      'the use-case is not found by name',
      USE_CASE,
      { path: 'p', imports: [], target: { kind: 'use-case', name: 'other' }, arrays: [{ property: 'uses', elements: ["'a'"] }] },
      'delta.splice-anchor-missing',
    ],
    [
      'the array property is missing',
      USE_CASE.replace("  emits: [],\n", ''),
      { path: 'p', imports: [], target: { kind: 'use-case', name: 'pay_order' }, arrays: [{ property: 'emits', elements: ['X'] }] },
      'delta.splice-anchor-missing',
    ],
    ['the source does not parse', 'export class {{{', member, 'delta.splice-unexpected-shape'],
    [
      'the member already exists',
      ENTITY,
      { ...member, members: [{ name: 'pay', text: '  pay(): void {}' }] },
      'delta.splice-unexpected-shape',
    ],
    [
      'two classes match',
      `${ENTITY}\n@AgentEntity({})\nexport class Order {}\n`.replace('export class Order {}', 'class Order {}'),
      member,
      'delta.splice-unexpected-shape',
    ],
    [
      'a name is imported from another module',
      `import { notImplemented } from './mine';\n${ENTITY}`,
      member,
      'delta.splice-unexpected-shape',
    ],
    [
      'a value is needed but the import is type-only',
      `import type { OrderRefunded } from './order.events';\n${ENTITY}`,
      member,
      'delta.splice-unexpected-shape',
    ],
    [
      'an import name is already declared locally',
      `${ENTITY}\nconst notImplemented = 1;\n`,
      member,
      'delta.splice-unexpected-shape',
    ],
    ['edits without a target', ENTITY, { ...member, target: null }, 'delta.splice-unexpected-shape'],
  ])('refuses when %s', (_title, source, fragment, code) => {
    expect(refused(source, fragment).code as string).toBe(code);
  });

  test('keeps a CRLF file pure CRLF across every kind of insertion', () => {
    const crlf = ENTITY.replace(/\n/g, '\r\n');
    const out = ok(crlf, { ...member, appended: ['export const z = 1;'] });
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
    expect(out).toContain("@Invariant({ id: 'x', text: 'y' })");
    const uc = USE_CASE.replace(/\n/g, '\r\n');
    const arr = ok(uc, {
      path: 'p',
      imports: [imp('../domain/order.events', 'OrderRefunded')],
      target: { kind: 'use-case', name: 'pay_order' },
      arrays: [{ property: 'emits', elements: ['OrderRefunded'] }],
    });
    expect(arr.replace(/\r\n/g, '')).not.toContain('\n');
    expect(arr).toContain('emits: [OrderRefunded],');
  });

  test('keeps a leading BOM and leaves LF files LF', () => {
    const out = ok(`\uFEFF${ENTITY}`, member);
    expect(out.startsWith('\uFEFFimport')).toBe(true);
    expect(ok(ENTITY, member)).not.toContain('\r');
  });

  test('refuses to append a declaration that already exists (also as an import)', () => {
    const f = (code: string): Fragment => ({
      path: 'domain/order.events.ts',
      imports: [],
      target: null,
      appended: [code],
    });
    const payload = 'const orderPaidPayload = 1;\nexport class OrderPaid {}';
    expect(refused('const orderPaidPayload = 0;\n', f(payload)).code as string).toBe(
      'delta.splice-unexpected-shape',
    );
    expect(refused('export class OrderPaid {}\n', f(payload)).code as string).toBe(
      'delta.splice-unexpected-shape',
    );
    expect(
      refused("import { OrderPaid } from './x';\n", f(payload)).code as string,
    ).toBe('delta.splice-unexpected-shape');
  });

  test('refuses a decorator that is already on the class (idempotent)', () => {
    const once = ok(ENTITY, member);
    // Decorator-only fragment: no member collision can fire first, so only the decorator check is tested.
    const decoratorOnly: Fragment = {
      path: 'domain/order.ts',
      imports: [],
      target: { kind: 'class', name: 'Order' },
      classDecorators: ["@Invariant({ id: 'x', text: 'y' })"],
      members: [],
    };
    const error = refused(once, decoratorOnly);
    expect(error.code as string).toBe('delta.splice-unexpected-shape');
    expect(error.message).toContain('already has the decorator');
    expect(error.message).not.toContain('member');
  });

  test('keeps comments and multiline layout of a host import', () => {
    const src = `import {\n  // keep me\n  AggregateRoot, // trailing\n} from '@agentic-ddd/core';\n${ENTITY.split('\n').slice(1).join('\n')}`;
    const out = ok(src, { ...member, imports: [imp('@agentic-ddd/core', 'notImplemented')] });
    expect(out).toContain(
      "import {\n  // keep me\n  AggregateRoot, notImplemented, // trailing\n} from '@agentic-ddd/core';",
    );
  });

  test('inserts at the sorted position when the list is sorted, appends otherwise', () => {
    const f = (names: string): string =>
      ok(`import { ${names} } from '@agentic-ddd/core';\n@AgentEntity({})\nexport class Order {}\n`, {
        path: 'p',
        imports: [imp('@agentic-ddd/core', 'Bravo')],
        target: null,
      });
    expect(f('Alpha, Charlie')).toContain('{ Alpha, Bravo, Charlie }');
    expect(f('Charlie, Alpha')).toContain('{ Charlie, Alpha, Bravo }');
  });

  test('puts new imports after a shebang and header comment when there are none', () => {
    const out = ok(`#!/usr/bin/env bun\n// header\n@AgentEntity({})\nexport class Order {}\n`, {
      ...member,
      imports: [imp('@agentic-ddd/core', 'notImplemented')],
      classDecorators: [],
      members: [],
    });
    expect(out.startsWith('#!/usr/bin/env bun\n// header\nimport {')).toBe(true);
  });

  test('refuses a syntactically broken file', () => {
    expect(refused('export class Order { foo( }\n', member).code as string).toBe(
      'delta.splice-unexpected-shape',
    );
  });

  test('keeps a trailing comment before the closing brace, byte for byte', () => {
    const src = "@AgentEntity({})\nexport class Order {\n  a = 1;\n  // trailing\n}\n";
    const out = ok(src, { ...member, imports: [], classDecorators: [] });
    expect(out).toContain('  a = 1;\n  // trailing\n\n  @AgentMethod');
  });

  test('handles `export default class` and preserves decorators with arguments', () => {
    const src = "@AgentEntity({ description: 'A, b' })\n@Other(1, 'x')\nexport default class Order {}\n";
    const out = ok(src, { ...member, imports: [], classDecorators: [] });
    expect(out.startsWith("@AgentEntity({ description: 'A, b' })\n@Other(1, 'x')\nexport default class Order {")).toBe(true);
    expect(out).toContain('refund(): void');
  });

  test('never touches the source on refusal', () => {
    const r = splice('export class Other {}\n', member);
    expect(r.ok).toBe(false);
  });
});
