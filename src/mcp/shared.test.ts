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

async function call(
  server: ReturnType<typeof createDomainServer>,
  name: string,
  args: object = {},
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
        method: 'tools/call',
        params: { name, arguments: args },
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

const overview = (s: ReturnType<typeof createDomainServer>) =>
  call(s, 'domain_overview');
const workingCopy = (shared: ReturnType<typeof createShared>) =>
  createDomainServer({ root: '/project' }, false, undefined, undefined, shared);
const publishedServer = (shared: ReturnType<typeof createShared>) =>
  createDomainServer({ published }, true, undefined, undefined, shared);

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
    const both = Promise.all([
      overview(workingCopy(shared)),
      overview(workingCopy(shared)),
    ]);
    await Bun.sleep(20);
    expect(runs).toBe(1);
    finish();
    const [a, b] = await both;
    expect(a.result.isError).toBeUndefined();
    expect(b.result.isError).toBeUndefined();
    expect(runs).toBe(1);
    await overview(workingCopy(shared));
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
});
