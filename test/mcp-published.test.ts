import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SignJWT } from 'jose';
import { parseLock, serializeLock } from '../src/compiler/lock';
import {
  createPublishedLock,
  serializePublishedLock,
  type PublishedLock,
} from '../src/compiler/published';
import { checkSnapshot, writeSnapshot } from '../src/compiler/snapshot';
import { startMcpHttpServer } from '../src/mcp/index';
import {
  type Signer,
  type TestAuthServer,
  makeSigner,
  startAuthServer,
} from './helpers/auth-server';
import { type StdioMcp, startStdioMcp } from './helpers/stdio-mcp';
import { twoModuleLock } from './helpers/two-module-lock';

const REPO = resolve(import.meta.dir, '..');
const LOCK = '.agentic/domain.lock.json';
const RESOURCE = 'http://127.0.0.1:3333/mcp';

type Result = { isError?: boolean; content: { text: string }[] };

describe('domain MCP: published lock source', () => {
  let root: string;
  let publishedFile: string;
  let published: PublishedLock;
  let signer: Signer;
  let auth: TestAuthServer;
  let live: Awaited<ReturnType<typeof startMcpHttpServer>>; // working copy
  let pub: Awaited<ReturnType<typeof startMcpHttpServer>>; // published
  let stdioPub: StdioMcp;

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

  const call = async (
    server: { port: number },
    scope: string,
    name: string,
    args: object = {},
  ): Promise<Result> => {
    const response = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${await mint(scope)}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.text();
    const line = body.split('\n').find((l) => l.startsWith('data:'));
    return JSON.parse(line ? line.slice(5) : body).result as Result;
  };
  const text = (r: Result) => r.content[0]!.text;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'agentic-mcp-published-'));
    const repoLock = parseLock(await readFile(join(REPO, LOCK), 'utf8'), LOCK);
    const lock = twoModuleLock(repoLock);
    await mkdir(join(root, '.agentic'), { recursive: true });
    await writeFile(join(root, LOCK), serializeLock(lock));
    await writeFile(join(root, 'agentic.config.ts'), 'config\n');
    for (const dir of ['orders', 'billing']) {
      await mkdir(join(root, 'examples', dir), { recursive: true });
      await writeFile(join(root, 'examples', dir, 'a.ts'), 'a\n');
    }
    await writeSnapshot(root, {
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
    const snap = await checkSnapshot(root);
    if (!snap.ok) throw new Error(snap.reason);
    published = createPublishedLock('v1.2.3', snap.lock, snap.rules);
    publishedFile = join(root, 'published.json');
    await writeFile(publishedFile, serializePublishedLock(published));

    signer = await makeSigner('RS256', 'k1');
    auth = startAuthServer('oauth');
    auth.published.push(signer.jwk);
    const mcp = { issuer: auth.issuer, resource: RESOURCE };
    live = await startMcpHttpServer({
      root,
      port: 0,
      host: '127.0.0.1',
      mcp,
    });
    pub = await startMcpHttpServer({
      root: join(root, 'does-not-exist'),
      published,
      port: 0,
      host: '127.0.0.1',
      mcp,
    });
    stdioPub = await startStdioMcp(root, ['--published', publishedFile]);
  }, 60000);

  afterAll(async () => {
    const closes = await Promise.allSettled([
      stdioPub?.close(),
      live?.close(),
      pub?.close(),
    ]);
    const removed = await Promise.allSettled([
      rm(root, { recursive: true, force: true }),
    ]);
    auth?.stop();
    const failed = [...closes, ...removed].find((r) => r.status === 'rejected');
    if (failed) throw (failed as PromiseRejectedResult).reason;
  });

  test('a module-scoped token gets byte-identical answers from both sources', async () => {
    const scope = 'domain:read:orders';
    const calls: [string, object, boolean][] = [
      ['domain_overview', {}, false],
      ['domain_element', { id: 'entity:Order' }, false],
      ['domain_element', { id: 'entity:Invoice' }, true],
      ['domain_changes', {}, false],
      ['domain_changes', { id: 'entity:Order' }, false],
      ['rules_for_path', { path: 'examples/orders/a.ts' }, false],
      ['rules_for_path', { path: 'examples/billing/a.ts' }, true],
      ['rules_for_path', { path: '../x' }, true],
    ];
    for (const [name, args, error] of calls) {
      const a = await call(live, scope, name, args);
      const b = await call(pub, scope, name, args);
      expect({ name, args, error: Boolean(b.isError) }).toEqual({
        name,
        args,
        error,
      });
      expect({ name, args, isError: b.isError, text: text(b) }).toEqual({
        name,
        args,
        isError: a.isError,
        text: text(a),
      });
    }
    // Guards against comparing two empty answers.
    const overview = JSON.parse(
      text(await call(pub, scope, 'domain_overview')),
    );
    expect(overview.modules.map((m: any) => m.name)).toEqual(['orders']);
  });

  test('domain_source reports the mode, version and digest, and no path', async () => {
    const a = await call(pub, 'domain:read', 'domain_source');
    expect(JSON.parse(text(a))).toEqual({
      mode: 'published',
      version: 'v1.2.3',
      digest: published.digest,
    });
    const b = await call(live, 'domain:read', 'domain_source');
    expect(JSON.parse(text(b))).toEqual({ mode: 'working-copy' });
    expect(text(a) + text(b)).not.toContain(root);
  });

  test('domain_source still needs the domain:read gate', async () => {
    const response = await fetch(`http://127.0.0.1:${pub.port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'domain_source', arguments: {} },
      }),
    });
    expect(response.status).toBe(401);
  });

  test('an absolute path is refused without echoing it', async () => {
    for (const path of [join(root, 'examples', 'orders', 'a.ts'), '/etc/x']) {
      const r = await call(pub, 'domain:read', 'rules_for_path', { path });
      expect(r.isError).toBe(true);
      expect(text(r)).toContain('[mcp.path-outside-root]');
      expect(text(r)).not.toContain(path);
      expect(text(r)).not.toContain(root);
    }
  });

  test('stdio published: serves without reading the working files', async () => {
    const before = (await stdioPub.call('domain_overview')) as Result;
    const rules = (await stdioPub.call('rules_for_path', {
      path: 'examples/orders/a.ts',
    })) as Result;
    expect(rules.isError).toBeFalsy();
    expect(text(rules)).toContain('"multi"');
    const source = (await stdioPub.call('domain_source')) as Result;
    expect(JSON.parse(text(source)).mode).toBe('published');
    // Break the working copy: a published source must not notice.
    await writeFile(join(root, 'examples', 'orders', 'a.ts'), 'changed\n');
    await rm(join(root, '.agentic', 'mcp'), { recursive: true, force: true });
    expect(text((await stdioPub.call('domain_overview')) as Result)).toBe(
      text(before),
    );
    expect(text(await call(pub, 'domain:read', 'domain_overview'))).toBe(
      text(before),
    );
    // The working-copy server now reports the missing snapshot (a remote client gets no path).
    const stale = await call(live, 'domain:read', 'domain_overview');
    expect(stale.isError).toBe(true);
    expect(text(stale)).toContain('snapshot.missing');
  });
});
