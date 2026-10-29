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
  const rpc = (message: object, token?: string) =>
    fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
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
});
