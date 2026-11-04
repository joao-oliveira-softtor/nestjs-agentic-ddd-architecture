import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SignJWT } from 'jose';
import { parseLock } from '../src/compiler/lock';
import { writeSnapshot } from '../src/compiler/snapshot';
import { startMcpHttpServer } from '../src/mcp/index';
import {
  type Signer,
  type TestAuthServer,
  makeSigner,
  startAuthServer,
} from './helpers/auth-server';
import { DEFAULT_CONVENTIONS } from '../src/compiler/conventions';
import { additionDelta } from '../src/compiler/delta/additions-fixture';
import { leftovers, shopProposal, shopRepo } from './helpers/shop-repo';

const REPO = resolve(import.meta.dir, '..');
const LOCK = '.agentic/domain.lock.json';
// The port is never contacted: the server binds port 0 and routes on the path only.
const RESOURCE = 'http://127.0.0.1:3333/mcp';
const PRM_PATH = '/.well-known/oauth-protected-resource/mcp';

async function prepareRoot(): Promise<string> {
  const tmp = await mkdtemp(join(tmpdir(), 'agentic-mcp-http-'));
  await mkdir(join(tmp, '.agentic'), { recursive: true });
  await mkdir(join(tmp, 'examples/orders'), { recursive: true });
  await cp(join(REPO, LOCK), join(tmp, LOCK));
  await writeFile(join(tmp, 'agentic.config.ts'), 'config\n');
  await writeFile(join(tmp, 'examples/orders/a.ts'), 'a\n');
  const lock = parseLock(await readFile(join(tmp, LOCK), 'utf8'), LOCK);
  await writeSnapshot(tmp, {
    root: '.',
    config: 'agentic.config.ts',
    lock: LOCK,
    rulesDir: '.ai/rules',
    conventions: DEFAULT_CONVENTIONS,
    rules: [
      { key: 'r', file: '.ai/rules/r.md', paths: ['examples/**'], body: 'R' },
    ],
    modules: lock.ir.modules,
  });
  return tmp;
}

describe('agentic mcp --http', () => {
  let root: string;
  let signer: Signer;
  let auth: TestAuthServer;
  let handle: Awaited<ReturnType<typeof startMcpHttpServer>>;
  let base: string;

  const mint = (
    claims: { aud?: string; scope?: string; exp?: number } = {},
  ): Promise<string> => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      scope: claims.scope ?? 'domain:read',
      client_id: 'client-1',
    })
      .setProtectedHeader({ alg: signer.alg, kid: signer.kid })
      .setIssuer(auth.issuer)
      .setAudience(claims.aud ?? RESOURCE)
      .setIssuedAt(now - 600)
      .setExpirationTime(claims.exp ?? now + 300)
      .sign(signer.privateKey);
  };

  // Raw Streamable HTTP: the MCP client package is not installed.
  const rpc = (
    message: object,
    token?: string,
    extra: Record<string, string> = {},
  ) =>
    fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...extra,
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ jsonrpc: '2.0', ...message }),
    });

  const json = async (response: Response) => {
    const text = await response.text();
    const data = text
      .split('\n')
      .find((line) => line.startsWith('data:'))
      ?.slice(5);
    return JSON.parse(data ?? text);
  };

  const expectRefused = async (
    response: Response,
    status: number,
    code: string,
  ) => {
    expect(response.status).toBe(status);
    expect(response.headers.get('www-authenticate')).toContain(
      'resource_metadata=',
    );
    expect(((await response.json()) as any).error_description).toStartWith(
      `${code}:`,
    );
  };

  beforeAll(async () => {
    root = await prepareRoot();
    signer = await makeSigner('RS256', 'k1');
    auth = startAuthServer('oauth');
    auth.published.push(signer.jwk);
    handle = await startMcpHttpServer({
      root,
      port: 0,
      host: '127.0.0.1',
      mcp: { issuer: auth.issuer, resource: RESOURCE },
    });
    base = `http://127.0.0.1:${handle.port}`;
  });

  afterAll(async () => {
    await handle.close();
    auth.stop();
    await rm(root, { recursive: true, force: true });
  });

  test('a request without a token is challenged before any tool code runs', async () => {
    await expectRefused(
      await rpc({ id: 1, method: 'tools/list' }),
      401,
      'auth.token-missing',
    );
  });

  test('a token for another audience is refused', async () => {
    const token = await mint({ aud: 'http://127.0.0.1:3333/other' });
    await expectRefused(
      await rpc({ id: 1, method: 'tools/list' }, token),
      401,
      'auth.audience-mismatch',
    );
  });

  test('an expired token is refused', async () => {
    const token = await mint({ exp: Math.floor(Date.now() / 1000) - 300 });
    await expectRefused(
      await rpc({ id: 1, method: 'tools/list' }, token),
      401,
      'auth.token-expired',
    );
  });

  test('a valid token without domain:read gets 403', async () => {
    const token = await mint({ scope: 'other:scope' });
    await expectRefused(
      await rpc({ id: 1, method: 'tools/list' }, token),
      403,
      'auth.scope-missing',
    );
  });

  test('the protected resource metadata is public and names the issuer', async () => {
    const response = await fetch(`${base}${PRM_PATH}`);
    expect(response.status).toBe(200);
    const doc = (await response.json()) as any;
    expect(doc.resource).toBe(RESOURCE);
    expect(doc.authorization_servers).toEqual([auth.issuer]);
  });

  test('a token with domain:read calls domain_overview', async () => {
    const token = await mint();
    const init = await rpc(
      {
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '0' },
        },
      },
      token,
    );
    expect(init.status).toBe(200);
    const call = await rpc(
      {
        id: 2,
        method: 'tools/call',
        params: { name: 'domain_overview', arguments: {} },
      },
      token,
    );
    expect(call.status).toBe(200);
    const result = (await json(call)).result;
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('orders');
  });

  test('every other path is 404', async () => {
    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/mcp/extra`)).status).toBe(404);
  });

  describe('Host and Origin validation', () => {
    const list = { id: 1, method: 'tools/list' };

    test('an allowed Origin reaches the gate', async () => {
      const origin = { origin: `http://127.0.0.1:${handle.port}` };
      await expectRefused(
        await rpc(list, undefined, origin),
        401,
        'auth.token-missing',
      );
      const ok = await rpc(list, await mint(), origin);
      expect(ok.status).toBe(200);
    });

    test('the configured resource origin is allowed', async () => {
      await expectRefused(
        await rpc(list, undefined, { origin: 'http://127.0.0.1:3333' }),
        401,
        'auth.token-missing',
      );
    });

    test('a foreign Origin is refused with 403 before the gate', async () => {
      const response = await rpc(list, await mint(), {
        origin: 'http://evil.example',
      });
      expect(response.status).toBe(403);
      const body = await response.text();
      expect(body).toContain('[mcp.origin-denied]');
      expect(body).not.toContain('evil.example');
    });

    test('the same foreign Origin is refused on the metadata path', async () => {
      const response = await fetch(`${base}${PRM_PATH}`, {
        headers: { origin: 'http://evil.example' },
      });
      expect(response.status).toBe(403);
      expect(await response.text()).toContain('[mcp.origin-denied]');
    });

    test('a foreign Host header is refused with 403', async () => {
      const response = await rpc(list, await mint(), { host: 'evil.example' });
      expect(response.status).toBe(403);
      const body = await response.text();
      expect(body).toContain('[mcp.host-denied]');
      expect(body).not.toContain('evil.example');
    });

    test('loopback aliases with the bound port are allowed as Host', async () => {
      await expectRefused(
        await rpc(list, undefined, { host: `localhost:${handle.port}` }),
        401,
        'auth.token-missing',
      );
    });
  });
});

describe('agentic mcp --http endpoint path', () => {
  let root: string;
  let signer: Signer;
  let auth: TestAuthServer;
  const handles: Awaited<ReturnType<typeof startMcpHttpServer>>[] = [];

  beforeAll(async () => {
    root = await prepareRoot();
    signer = await makeSigner('RS256', 'k1');
    auth = startAuthServer('oauth');
    auth.published.push(signer.jwk);
  });

  afterAll(async () => {
    for (const h of handles) await h.close();
    auth.stop();
    await rm(root, { recursive: true, force: true });
  });

  test.each(['http://127.0.0.1:3333/mcp', 'http://127.0.0.1:3333/mcp/'])(
    'resource %s routes /mcp and /mcp/ to the gate',
    async (resource) => {
      const handle = await startMcpHttpServer({
        root,
        port: 0,
        host: '127.0.0.1',
        mcp: { issuer: auth.issuer, resource },
      });
      handles.push(handle);
      for (const path of ['/mcp', '/mcp/']) {
        const response = await fetch(`http://127.0.0.1:${handle.port}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        expect(response.status).toBe(401);
      }
      for (const path of [
        '/.well-known/oauth-protected-resource/mcp',
        '/.well-known/oauth-protected-resource/mcp/',
      ]) {
        const response = await fetch(`http://127.0.0.1:${handle.port}${path}`);
        expect(response.status).toBe(200);
      }
    },
  );
});

describe('agentic mcp --http propose_change', () => {
  let repo: Awaited<ReturnType<typeof shopRepo>>;
  let signer: Signer;
  let auth: TestAuthServer;
  let handle: Awaited<ReturnType<typeof startMcpHttpServer>>;

  const mint = async (scope: string): Promise<string> => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ scope, client_id: 'client-1' })
      .setProtectedHeader({ alg: signer.alg, kid: signer.kid })
      .setIssuer(auth.issuer)
      .setAudience(RESOURCE)
      .setIssuedAt(now - 600)
      .setExpirationTime(now + 300)
      .sign(signer.privateKey);
  };
  const raw = async (scope: string, args: unknown, path = '/mcp') =>
    fetch(`http://127.0.0.1:${handle.port}${path}`, {
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
        params: { name: 'propose_change', arguments: args },
      }),
    });
  const propose = async (scope: string, args: unknown) => {
    const response = await raw(scope, args);
    expect(response.status).toBe(200);
    const body = await response.text();
    const line = body.split('\n').find((l) => l.startsWith('data:'));
    return JSON.parse(line ? line.slice(5) : body).result as {
      isError?: boolean;
      content: { text: string }[];
    };
  };

  beforeAll(async () => {
    repo = await shopRepo();
    signer = await makeSigner('RS256', 'k1');
    auth = startAuthServer('oauth');
    auth.published.push(signer.jwk);
    handle = await startMcpHttpServer({
      root: repo.root,
      port: 0,
      host: '127.0.0.1',
      mcp: { issuer: auth.issuer, resource: RESOURCE },
    });
  }, 120_000);

  afterAll(async () => {
    await handle?.close();
    auth?.stop();
    await rm(repo.root, { recursive: true, force: true });
  });

  test('change:propose returns the bundle, the same one twice, and leaves nothing behind', async () => {
    const before = await leftovers(repo);
    const args = { delta: additionDelta(), proposal: shopProposal() };
    const a = await propose('change:propose', args);
    const b = await propose('change:propose:shop', args);
    expect(a.isError).toBeUndefined();
    const first = JSON.parse(a.content[0]!.text);
    expect(first.hash).toBe(JSON.parse(b.content[0]!.text).hash);
    expect(first.manifest.hash).toBe(first.hash);
    const paths = first.files.map((f: { path: string }) => f.path);
    expect(paths).toContain('BUNDLE.md');
    expect(paths).toContain('target/changes/0001-refund-order/proposal.md');
    expect(await leftovers(repo)).toEqual(before);
  }, 180_000);

  test('a token without change:propose, or scoped to another module, is denied', async () => {
    const args = { delta: additionDelta(), proposal: shopProposal() };
    for (const scope of ['domain:read', 'change:propose:billing']) {
      const r = await propose(scope, args);
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toEndWith('[auth.scope-missing]');
    }
  });

  test('the client cannot set the base, conventions or timeout', async () => {
    for (const extra of [
      { baseRef: 'HEAD' },
      { baseRoot: '/tmp' },
      { conventions: {} },
      { existingFiles: [] },
      { timeoutMs: 1 },
    ]) {
      const r = await propose('change:propose', {
        delta: additionDelta(),
        proposal: shopProposal(),
        ...extra,
      });
      expect(r.isError).toBe(true);
    }
  });

  test('an oversized input is refused before any work, without echoing it', async () => {
    const before = await leftovers(repo);
    const r = await propose('change:propose', {
      delta: additionDelta(),
      proposal: { slug: 'big', markdown: 'SECRET-MARKER'.repeat(30_000) },
    });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toEndWith('[mcp.input-too-large]');
    expect(r.content[0]!.text).not.toContain('SECRET-MARKER');
    expect(await leftovers(repo)).toEqual(before);
  });

  test('a body above the transport cap is refused', async () => {
    // Bun either answers 413 or drops the connection; both mean the body never reached the handler.
    const outcome = await raw('change:propose', {
      delta: additionDelta(),
      proposal: { slug: 'big', markdown: 'x'.repeat(2 * 1024 * 1024) },
    }).then(
      (r) => r.status,
      () => 'reset',
    );
    expect(outcome).not.toBe(200);
  });

  test('delta errors come back as a coded tool error with the offending path', async () => {
    const before = await leftovers(repo);
    const bad = additionDelta() as unknown as Record<string, unknown>;
    const r = await propose('change:propose', {
      delta: { ...bad, entities: [{ name: 'not valid' }] },
      proposal: shopProposal(),
    });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toEndWith('[delta.schema-invalid]');
    expect(r.content[0]!.text).toContain('entities[0]');
    expect(await leftovers(repo)).toEqual(before);
  });
});
