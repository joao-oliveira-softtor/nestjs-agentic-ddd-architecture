import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SignJWT } from 'jose';
import {
  type DomainLock,
  parseLock,
  serializeLock,
} from '../src/compiler/lock';
import { SNAPSHOT_PATH, writeSnapshot } from '../src/compiler/snapshot';
import { startMcpHttpServer } from '../src/mcp/index';
import {
  type Signer,
  type TestAuthServer,
  makeSigner,
  startAuthServer,
} from './helpers/auth-server';
import { type StdioMcp, startStdioMcp } from './helpers/stdio-mcp';

const REPO = resolve(import.meta.dir, '..');
const LOCK = '.agentic/domain.lock.json';
// The port is never contacted: the server binds port 0 and routes on the path only.
const RESOURCE = 'http://127.0.0.1:3333/mcp';

// Synthetic change ids: far from the sequential ids `compile` hands out to the repo lock.
const CROSS = '0900';
const BILLING_ONLY = '0901';

type Result = { isError?: boolean; content: { text: string }[] };

// The repo lock has only `orders`: `billing` is a renamed copy, linked to orders in both directions.
function twoModuleLock(orders: DomainLock): DomainLock {
  const copy = (xs: unknown[]): any[] =>
    JSON.parse(
      JSON.stringify(xs)
        .replaceAll('examples/orders', 'examples/billing')
        .replaceAll('"module":"orders"', '"module":"billing"')
        .replace(/Order/g, 'Invoice')
        .replace(/order/g, 'invoice'),
    );
  const lock = structuredClone(orders) as any;
  const ir = lock.ir;
  const billing = {
    entities: copy(ir.entities),
    events: copy(ir.events),
    useCases: copy(ir.useCases),
    operators: copy(ir.operators),
  };
  // billing -> orders (a use-case uses an orders method), orders -> billing (a reference).
  billing.useCases[0].uses.push(ir.entities[0].methods[0].id);
  ir.entities[0].references = [billing.entities[0].id];
  ir.modules.push({ name: 'billing', path: 'examples/billing' });
  for (const key of ['entities', 'events', 'useCases', 'operators'] as const)
    ir[key].push(...billing[key]);
  const [ordersOnly] = lock.changes;
  const item = (id: string, module: string) => ({
    classification: 'behavioral',
    id,
    kind: 'changed',
    module,
  });
  lock.changes.push(
    {
      ...ordersOnly,
      id: CROSS,
      title: 'Invoice rules and order totals',
      summary: 'Touches billing and orders together.',
      items: [
        item(ir.entities[0].id, 'orders'),
        item(billing.entities[0].id, 'billing'),
      ],
    },
    {
      ...ordersOnly,
      id: BILLING_ONLY,
      title: 'Invoice only',
      summary: 'Billing only.',
      items: [item(billing.entities[0].id, 'billing')],
    },
  );
  return lock;
}

async function prepareRoot(): Promise<{ tmp: string; repoChanges: string[] }> {
  const tmp = await mkdtemp(join(tmpdir(), 'agentic-mcp-scopes-'));
  const repoLock = parseLock(await readFile(join(REPO, LOCK), 'utf8'), LOCK);
  const lock = twoModuleLock(repoLock);
  await mkdir(join(tmp, '.agentic'), { recursive: true });
  await writeFile(join(tmp, LOCK), serializeLock(lock));
  await writeFile(join(tmp, 'agentic.config.ts'), 'config\n');
  for (const dir of ['orders', 'billing']) {
    await mkdir(join(tmp, 'examples', dir), { recursive: true });
    await writeFile(join(tmp, 'examples', dir, 'a.ts'), 'a\n');
  }
  await writeSnapshot(tmp, {
    root: '.',
    config: 'agentic.config.ts',
    lock: LOCK,
    rulesDir: '.ai/rules',
    rules: [
      { key: 'r', file: '.ai/rules/r.md', paths: ['examples/**'], body: 'R' },
      {
        key: 'multi',
        file: '.ai/rules/multi.md',
        paths: ['examples/orders/**', 'examples/billing/**'],
        body: 'M',
      },
    ],
    modules: lock.ir.modules,
  });
  return { tmp, repoChanges: repoLock.changes.map((c) => c.id) };
}

const ELEMENTS = [
  'entity:Order',
  'method:Order.cancel',
  'invariant:Order/ao-menos-um-item',
  'event:OrderCancelled',
  'usecase:cancel_order',
  'operator:order-operator',
  'entity:Invoice',
  'usecase:cancel_invoice',
];
const HIDDEN = [
  'entity:Invoice',
  'method:Invoice.cancel',
  'invariant:Invoice/ao-menos-um-item',
  'event:InvoiceCancelled',
  'usecase:cancel_invoice',
  'operator:invoice-operator',
];

describe('domain MCP: module scopes, transport parity, no leak', () => {
  let root: string;
  let signer: Signer;
  let auth: TestAuthServer;
  let handle: Awaited<ReturnType<typeof startMcpHttpServer>>;
  let stdio: StdioMcp;
  let repoChanges: string[]; // the repo's own changes: all orders-only
  const seen: string[] = []; // every HTTP tool text, scanned for leaks at the end

  const mint = (scope: string): Promise<string> => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ scope, client_id: 'client-1' })
      .setProtectedHeader({ alg: signer.alg, kid: signer.kid })
      .setIssuer(auth.issuer)
      .setAudience(RESOURCE)
      .setIssuedAt(now - 600)
      .setExpirationTime(now + 300)
      .sign(signer.privateKey);
  };

  const rpc = (message: object, token: string) =>
    fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', ...message }),
    });

  const http = async (
    scope: string,
    name: string,
    args: object = {},
  ): Promise<Result> => {
    const response = await rpc(
      { id: 1, method: 'tools/call', params: { name, arguments: args } },
      await mint(scope),
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    const line = body.split('\n').find((l) => l.startsWith('data:'));
    const result = JSON.parse(line ? line.slice(5) : body).result as Result;
    seen.push(result.content[0]!.text);
    return result;
  };
  const text = (r: Result) => r.content[0]!.text;
  const data = (r: Result) => JSON.parse(text(r));
  const ids = (r: Result): string[] => data(r).changes.map((c: any) => c.id);
  const names = (r: Result): string[] =>
    data(r).modules.map((m: any) => m.name);

  beforeAll(async () => {
    ({ tmp: root, repoChanges } = await prepareRoot());
    signer = await makeSigner('RS256', 'k1');
    auth = startAuthServer('oauth');
    auth.published.push(signer.jwk);
    handle = await startMcpHttpServer({
      root,
      port: 0,
      host: '127.0.0.1',
      mcp: { issuer: auth.issuer, resource: RESOURCE },
    });
    stdio = await startStdioMcp(root);
  }, 60000);

  afterAll(async () => {
    // Independent cleanups: one failing must not skip the others.
    await Promise.allSettled([
      stdio?.close(),
      handle?.close(),
      rm(root, { recursive: true, force: true }),
    ]);
    auth?.stop();
  });

  test('stdio and HTTP with domain:read return identical results', async () => {
    const calls: [string, object, boolean][] = [
      ['domain_overview', {}, false],
      ...ELEMENTS.map((id): [string, object, boolean] => [
        'domain_element',
        { id },
        false,
      ]),
      ['domain_changes', {}, false],
      ['domain_changes', { id: 'entity:Order' }, false],
      ['rules_for_path', { path: 'examples/orders/a.ts' }, false],
      ['rules_for_path', { path: 'examples/billing/a.ts' }, false],
      ['domain_element', { id: 'entity:Nope' }, true],
      ['rules_for_path', { path: '../x' }, true],
    ];
    for (const [name, args, expectError] of calls) {
      const remote = await http('domain:read', name, args);
      const local = (await stdio.call(name, args)) as Result;
      // Both sides must also be the intended kind of answer, not the same wrong error.
      expect({ name, args, error: Boolean(remote.isError) }).toEqual({
        name,
        args,
        error: expectError,
      });
      expect({ name, args, error: Boolean(local.isError) }).toEqual({
        name,
        args,
        error: expectError,
      });
      expect({
        name,
        args,
        isError: remote.isError,
        text: text(remote),
      }).toEqual({ name, args, isError: local.isError, text: text(local) });
    }
    // Guards the loop above against comparing two empty or failing answers.
    expect(names(await http('domain:read', 'domain_overview'))).toHaveLength(2);
    const outside = await http('domain:read', 'rules_for_path', {
      path: '../x',
    });
    expect(text(outside)).toContain('[mcp.path-outside-root]');
  });

  describe('domain:read:orders', () => {
    const scope = 'domain:read:orders';

    test('the overview lists only orders and never says billing', async () => {
      const overview = await http(scope, 'domain_overview');
      expect(names(overview)).toEqual(['orders']);
      expect(text(overview).toLowerCase()).not.toContain('billing');
      expect(text(overview).toLowerCase()).not.toContain('invoice');
    });

    test.each(HIDDEN)(
      'hidden %s is indistinguishable from an unknown id',
      async (id) => {
        const hidden = await http(scope, 'domain_element', { id });
        const prefix = id.slice(0, id.indexOf(':'));
        const unknown = await http(scope, 'domain_element', {
          id: `${prefix}:Nope`,
        });
        expect(hidden.isError).toBe(true);
        expect(text(hidden)).toContain('[mcp.element-unknown]');
        expect(text(hidden).replace(id, 'X')).toBe(
          text(unknown).replace(`${prefix}:Nope`, 'X'),
        );
        // The id exists with the full scope, so the refusal above is the filter.
        const full = await http('domain:read', 'domain_element', { id });
        expect(full.isError).toBeUndefined();
      },
    );

    test('orders elements carry no billing relations', async () => {
      for (const id of [
        'entity:Order',
        'method:Order.cancel',
        'usecase:cancel_order',
      ]) {
        const scoped = text(
          await http(scope, 'domain_element', { id }),
        ).toLowerCase();
        expect(scoped).not.toContain('invoice');
        expect(scoped).not.toContain('billing');
      }
      const entity = await http('domain:read', 'domain_element', {
        id: 'entity:Order',
      });
      expect(data(entity).references).toEqual(['entity:Invoice']);
      const method = await http('domain:read', 'domain_element', {
        id: 'method:Order.cancel',
      });
      expect(data(method).usedBy).toContain('usecase:cancel_invoice');
    });

    test('changes: only changes wholly inside orders are visible', async () => {
      expect(ids(await http(scope, 'domain_changes'))).toEqual(repoChanges);
      const byOrder = await http(scope, 'domain_changes', {
        id: 'entity:Order',
      });
      expect(ids(byOrder)).toContain(repoChanges[0]!);
      expect(ids(byOrder)).not.toContain(CROSS);
      expect(
        ids(
          await http('domain:read', 'domain_changes', { id: 'entity:Order' }),
        ),
      ).toContain(CROSS);
      const byInvoice = await http(scope, 'domain_changes', {
        id: 'entity:Invoice',
      });
      expect(ids(byInvoice)).toEqual([]);
      const full = await http('domain:read', 'domain_changes');
      expect(ids(full)).toEqual([...repoChanges, CROSS, BILLING_ONLY]);
    });

    test('rules_for_path narrows a rule to the globs that match the path', async () => {
      const globs = async (token: string) =>
        (
          (await data(
            await http(token, 'rules_for_path', {
              path: 'examples/orders/a.ts',
            }),
          )) as { rules: { key: string; paths: string[] }[] }
        ).rules.find((r) => r.key === 'multi')?.paths;
      expect(await globs(scope)).toEqual(['examples/orders/**']);
      expect(await globs('domain:read')).toEqual([
        'examples/orders/**',
        'examples/billing/**',
      ]);
    });

    test('rules_for_path refuses paths outside the orders module', async () => {
      for (const path of [
        'examples/orders/a.ts',
        'examples/billing/../orders/a.ts',
      ]) {
        const ok = await http(scope, 'rules_for_path', { path });
        expect(ok.isError).toBeUndefined();
        expect(JSON.stringify(data(ok))).toContain('"r"');
      }
      for (const path of [
        'examples/billing/a.ts',
        'examples/billing',
        'README.md',
        'examples/orders/../billing/a.ts',
        'examples/orders-extra/a.ts',
        'examples/a.ts',
      ]) {
        const refused = await http(scope, 'rules_for_path', { path });
        expect(refused.isError).toBe(true);
        expect(text(refused)).toContain('[mcp.path-out-of-scope]');
        // The message echoes the client's own path and nothing else.
        const rest = text(refused).replace(path, '').toLowerCase();
        expect(rest).not.toContain('billing');
      }
    });
  });

  describe('other grants', () => {
    test('two module scopes see both modules and the cross-module change', async () => {
      const both = 'domain:read:orders domain:read:billing';
      const overview = await http(both, 'domain_overview');
      expect(names(overview).sort()).toEqual(['billing', 'orders']);
      expect(ids(await http(both, 'domain_changes'))).toEqual([
        ...repoChanges,
        CROSS,
        BILLING_ONLY,
      ]);
    });

    test('the bare capability beats a module suffix', async () => {
      const full = text(await http('domain:read', 'domain_overview'));
      const mixed = await http(
        'domain:read domain:read:orders',
        'domain_overview',
      );
      expect(text(mixed)).toBe(full);
      expect(full.toLowerCase()).toContain('billing');
    });

    test('a scope naming a missing module sees nothing and is not an error', async () => {
      const ghost = 'domain:read:ghost';
      const overview = await http(ghost, 'domain_overview');
      expect(overview.isError).toBeUndefined();
      expect(data(overview).modules).toEqual([]);
      expect(ids(await http(ghost, 'domain_changes'))).toEqual([]);
      const element = await http(ghost, 'domain_element', {
        id: 'entity:Order',
      });
      expect(element.isError).toBe(true);
      const path = await http(ghost, 'rules_for_path', {
        path: 'examples/orders/a.ts',
      });
      expect(path.isError).toBe(true);
    });

    test('a token without any domain:read scope gets 403', async () => {
      for (const scope of [
        'other:scope',
        'domain:write:orders',
        'domain:readx',
      ]) {
        const token = await mint(scope);
        const response = await rpc({ id: 1, method: 'tools/list' }, token);
        expect(response.status).toBe(403);
        const body = (await response.json()) as any;
        expect(body.error_description).toStartWith('auth.scope-missing:');
      }
    });
  });

  describe('no leak over HTTP', () => {
    test('a missing snapshot gives a generic remote message', async () => {
      const file = join(root, SNAPSHOT_PATH);
      const saved = await readFile(file, 'utf8');
      await rm(file);
      try {
        for (const scope of ['domain:read', 'domain:read:orders']) {
          const result = await http(scope, 'domain_overview');
          expect(result.isError).toBe(true);
          expect(text(result)).toBe(
            'no snapshot on the server; run `bun run agentic compile` at the project root there [snapshot.missing]',
          );
        }
      } finally {
        await writeFile(file, saved);
      }
      const back = await http('domain:read', 'domain_overview');
      expect(back.isError).toBeUndefined();
    });

    test('no tool answer, full or scoped, contains a filesystem path', async () => {
      const scopes = ['domain:read', 'domain:read:orders', 'domain:read:ghost'];
      const paths = [
        'examples/orders/a.ts',
        'examples/billing/a.ts',
        'README.md',
        '../x',
      ];
      for (const scope of scopes) {
        await http(scope, 'domain_overview');
        for (const id of [...ELEMENTS, 'entity:Nope', '../x'])
          await http(scope, 'domain_element', { id });
        await http(scope, 'domain_changes');
        for (const path of paths) await http(scope, 'rules_for_path', { path });
      }
      // Depends on the tests above having filled `seen`: a guard against scanning nothing.
      expect(seen.length).toBeGreaterThan(50);
      const forms = [
        root,
        root.replaceAll('\\', '/'),
        root.replaceAll('/', '\\'),
        'agentic-mcp-scopes-',
      ];
      for (const body of seen) {
        for (const form of forms) expect(body).not.toContain(form);
        expect(body).not.toMatch(/[A-Za-z]:[\\/]/);
        // A POSIX absolute path: a slash right after a quote, space or paren.
        expect(body).not.toMatch(/["'\s(]\/[\w.-]+\//);
      }
    });
  });
});
