import { describe, expect, test } from 'bun:test';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { DEFAULT_CONVENTIONS } from '../compiler/conventions';
import { parseLock } from '../compiler/lock';
import { createPublishedLock } from '../compiler/published';
import { parseSseData } from '../../scripts/sse-data';
import { twoModuleLock } from '../../test/helpers/two-module-lock';
import { catalogue } from './skills';
import { createDomainServer, createShared } from './index';

const root = resolve(import.meta.dir, '../..');
const skillDir = resolve(root, 'skills/agentic-ddd');
const repoLock = parseLock(
  await Bun.file(resolve(root, '.agentic/domain.lock.json')).text(),
  'lock',
);
const snap = {
  ok: true as const,
  lock: repoLock,
  rules: [],
  conventions: DEFAULT_CONVENTIONS,
  root: '/project',
};
const published = createPublishedLock(
  '1',
  twoModuleLock(repoLock),
  [],
  DEFAULT_CONVENTIONS,
);

async function rpc(
  server: ReturnType<typeof createDomainServer>,
  method: string,
  params: object,
  scopes?: string[],
): Promise<any> {
  const response = await createMcpHandler(() => server).fetch(
    new Request('http://127.0.0.1/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
    }),
    scopes && {
      authInfo: {
        token: 't',
        clientId: 'c',
        scopes,
        expiresAt: 9e9,
        resource: new URL('http://127.0.0.1/mcp'),
      },
    },
  );
  return parseSseData(await response.text());
}

const call = (
  server: ReturnType<typeof createDomainServer>,
  name: string,
  args: object = {},
  scopes?: string[],
) => rpc(server, 'tools/call', { name, arguments: args }, scopes);

const overview = (s: ReturnType<typeof createDomainServer>) =>
  call(s, 'domain_overview');
const workingCopy = (shared: ReturnType<typeof createShared>) =>
  createDomainServer({ root: '/project' }, false, undefined, undefined, shared);
const publishedServer = (shared: ReturnType<typeof createShared>) =>
  createDomainServer({ published }, true, undefined, undefined, shared);

// Resolves once `n` calls have reached the shared snapshot, so a test can wait for them instead of sleeping.
function whenCalled(shared: ReturnType<typeof createShared>, n: number) {
  let calls = 0;
  let reached: () => void = () => {};
  const done = new Promise<void>((resolve) => (reached = resolve));
  const real = shared.snapshot;
  shared.snapshot = (root) => {
    if (++calls === n) reached();
    return real(root);
  };
  return done;
}

describe('the snapshot check is shared while it runs', () => {
  test('simultaneous calls on two servers run it once; one that arrives after it finished runs it again', async () => {
    let runs = 0;
    let finish: () => void = () => {};
    const gate = new Promise<void>((done) => (finish = done));
    const shared = createShared(skillDir, {
      check: async () => {
        runs++;
        await gate;
        return snap;
      },
    });
    const bothArrived = whenCalled(shared, 2);
    const both = Promise.all([
      overview(workingCopy(shared)),
      overview(workingCopy(shared)),
    ]);
    await bothArrived;
    expect(runs).toBe(1);
    finish();
    const [a, b] = await both;
    expect(a.result.isError).toBeUndefined();
    expect(b.result.isError).toBeUndefined();
    expect(runs).toBe(1);
    await overview(workingCopy(shared));
    expect(runs).toBe(2);
  });

  test('callers with different access share the check and each gets its own scope', async () => {
    const twoModules = { ...snap, lock: twoModuleLock(repoLock) };
    let runs = 0;
    let finish: () => void = () => {};
    const gate = new Promise<void>((done) => (finish = done));
    const shared = createShared(skillDir, {
      check: async () => {
        runs++;
        await gate;
        return twoModules;
      },
    });
    const remoteWorkingCopy = () =>
      createDomainServer(
        { root: '/project' },
        true,
        undefined,
        undefined,
        shared,
      );
    const modulesOf = (out: any): string[] =>
      JSON.parse(out.result.content[0].text).modules.map(
        (m: { name: string }) => m.name,
      );
    const bothArrived = whenCalled(shared, 2);
    const both = Promise.all([
      call(remoteWorkingCopy(), 'domain_overview', {}, ['domain:read:orders']),
      call(remoteWorkingCopy(), 'domain_overview', {}, ['domain:read:billing']),
    ]);
    await bothArrived;
    expect(runs).toBe(1);
    finish();
    const [orders, billing] = await both;
    expect(runs).toBe(1);
    expect(modulesOf(orders)).toEqual(['orders']);
    expect(modulesOf(billing)).toEqual(['billing']);
    expect(orders.result.content[0].text).not.toBe(
      billing.result.content[0].text,
    );
    const all = await call(remoteWorkingCopy(), 'domain_overview', {}, [
      'domain:read',
    ]);
    expect(modulesOf(all).sort()).toEqual(['billing', 'orders']);
    expect(runs).toBe(2);
  });

  test('a check that rejects is not kept either', async () => {
    let runs = 0;
    const shared = createShared(skillDir, {
      check: async () => {
        runs++;
        if (runs === 1) throw new Error('disk gone');
        return snap;
      },
    });
    const first = await overview(workingCopy(shared));
    expect(first.result.isError).toBe(true);
    const second = await overview(workingCopy(shared));
    expect(second.result.isError).toBeUndefined();
    expect(runs).toBe(2);
  });

  test('a token with no grant never starts a check', async () => {
    let runs = 0;
    const shared = createShared(skillDir, {
      check: async () => {
        runs++;
        return snap;
      },
    });
    const server = createDomainServer(
      { root: '/project' },
      true,
      undefined,
      undefined,
      shared,
    );
    const out = await call(server, 'domain_overview', {}, ['skill:read']);
    expect(out.result.isError).toBe(true);
    expect(runs).toBe(0);
  });
});

describe('the authoring skill is loaded once for all servers that share it', () => {
  test('two servers read the files once', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'agentic-shared-'));
    try {
      await cp(skillDir, tmp, { recursive: true });
      const shared = createShared(tmp);
      const guide = (s: ReturnType<typeof createDomainServer>) =>
        call(s, 'authoring_guide', { doc: 'SKILL.md' }, ['skill:read']);
      const first = await guide(publishedServer(shared));
      await rm(tmp, { recursive: true, force: true });
      const second = await guide(publishedServer(shared));
      expect(first.result.isError).toBeUndefined();
      expect(second.result.content[0].text).toBe(first.result.content[0].text);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test('a failed read is retried by the next call', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'agentic-shared-'));
    try {
      await Bun.write(join(tmp, 'references'), 'not a directory');
      const shared = createShared(tmp);
      const guide = () =>
        call(publishedServer(shared), 'authoring_guide', { doc: 'SKILL.md' }, [
          'skill:read',
        ]);
      expect((await guide()).result.isError).toBe(true);
      await rm(join(tmp, 'references'));
      await cp(skillDir, tmp, { recursive: true });
      expect((await guide()).result.isError).toBeUndefined();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('the catalogue is memoised by access, in published mode only', () => {
  const counting = () => {
    const keys: unknown[] = [];
    const shared = createShared(skillDir, {
      catalogue: (input) => {
        keys.push(input.skillAccess);
        return catalogue(input);
      },
      check: async () => snap,
    });
    return { shared, builds: () => keys.length };
  };
  const guide = (
    server: ReturnType<typeof createDomainServer>,
    scopes: string[],
  ) => call(server, 'authoring_guide', {}, scopes);

  test('the same access builds once, another access builds its own', async () => {
    const { shared, builds } = counting();
    const orders = ['skill:read:orders'];
    const one = await guide(publishedServer(shared), orders);
    await guide(publishedServer(shared), orders);
    expect(builds()).toBe(1);
    const billing = await guide(publishedServer(shared), [
      'skill:read:billing',
    ]);
    expect(builds()).toBe(2);
    expect(billing.result.content[0].text).not.toBe(one.result.content[0].text);
    await guide(publishedServer(shared), ['skill:read']);
    await guide(publishedServer(shared), ['skill:read']);
    expect(builds()).toBe(3);
  });

  test('module names the lock does not have share one entry', async () => {
    const { shared, builds } = counting();
    await guide(publishedServer(shared), ['skill:read:orders']);
    await guide(publishedServer(shared), [
      'skill:read:orders',
      'skill:read:nothing',
    ]);
    await guide(publishedServer(shared), ['skill:read:orders', 'skill:read:x']);
    expect(builds()).toBe(1);
  });

  test('a working copy rebuilds it on every call', async () => {
    const { shared, builds } = counting();
    await call(workingCopy(shared), 'authoring_guide');
    await call(workingCopy(shared), 'authoring_guide');
    expect(builds()).toBe(2);
  });

  describe('the memo key covers everything that decides the answer', () => {
    // A change that also touched `legacy`, a module the lock no longer has: only a token that reads both sees it.
    const [base] = repoLock.changes;
    const legacyChange = {
      ...base!,
      id: '0902',
      title: 'Legacy retirement',
      summary: 'Touches orders and legacy.',
      items: [
        {
          classification: 'behavioral' as const,
          id: repoLock.ir.entities[0]!.id,
          kind: 'modified' as const,
          module: 'orders',
        },
        {
          classification: 'behavioral' as const,
          id: 'entity:Gone',
          kind: 'removed' as const,
          module: 'legacy',
        },
      ],
    };
    const withLegacy = (version: string) =>
      createPublishedLock(
        version,
        { ...repoLock, changes: [...repoLock.changes, legacyChange] },
        [],
        DEFAULT_CONVENTIONS,
      );
    const serverOf = (
      p: typeof published,
      shared: ReturnType<typeof createShared>,
    ) =>
      createDomainServer({ published: p }, true, undefined, undefined, shared);
    const history = (
      p: typeof published,
      shared: ReturnType<typeof createShared>,
      scopes: string[],
    ) =>
      call(
        serverOf(p, shared),
        'authoring_guide',
        { doc: 'skill://orders-dev/references/history.md' },
        scopes,
      );

    test('a token never gets the catalogue of one that can read a module the lock no longer has', async () => {
      const shared = createShared(skillDir);
      const p = withLegacy('1');
      const both = await history(p, shared, [
        'skill:read:orders',
        'skill:read:legacy',
      ]);
      const ordersOnly = await history(p, shared, ['skill:read:orders']);
      expect(both.result.content[0].text).toContain('Legacy retirement');
      expect(ordersOnly.result.content[0].text).not.toContain(
        'Legacy retirement',
      );
    });

    test('two published locks never share an entry', async () => {
      const keys: unknown[] = [];
      const shared = createShared(skillDir, {
        catalogue: (input) => {
          keys.push(input.fullLock);
          return catalogue(input);
        },
      });
      const scopes = ['skill:read:orders'];
      await history(withLegacy('1'), shared, scopes);
      await history(withLegacy('2'), shared, scopes);
      expect(keys).toHaveLength(2);
    });

    test('the memo is emptied before it passes 256 entries', async () => {
      const shared = createShared(skillDir);
      const fill = (n: number) => {
        shared.catalogues.clear();
        for (let i = 0; i < n; i++) shared.catalogues.set(`k${i}`, []);
      };
      fill(255);
      await history(published, shared, ['skill:read:orders']);
      expect(shared.catalogues.size).toBe(256);
      fill(256);
      await history(published, shared, ['skill:read:orders']);
      expect(shared.catalogues.size).toBe(1);
    });
  });
});

describe('a token without the skill grant does not load the authoring skill', () => {
  test('listing the resources with a broken skill directory still answers nothing', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'agentic-shared-'));
    try {
      // `references` is a file: a load would fail with ENOTDIR.
      await Bun.write(join(tmp, 'references'), 'not a directory');
      const out = await rpc(
        publishedServer(createShared(tmp)),
        'resources/list',
        {},
        ['domain:read'],
      );
      expect(out.error).toBeUndefined();
      expect(out.result.resources).toEqual([]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
