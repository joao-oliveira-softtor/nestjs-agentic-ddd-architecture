import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../src/compiler/config';
import { SignJWT } from 'jose';
import { GitHubChangeSink } from '../src/publish/github-sink';
import { startMcpHttpServer, withPublishSlot } from '../src/mcp/index';
import {
  type Signer,
  type TestAuthServer,
  makeSigner,
  startAuthServer,
} from './helpers/auth-server';
import { createFakeGitHost } from './helpers/fake-git-host';
import { CHANGE, GOOD, bundleOf } from './helpers/publish-bundle';
import { shopRepo } from './helpers/shop-repo';

const RESOURCE = 'http://127.0.0.1:3333/mcp';
const TOKEN = 'ghp_SECRET_TOKEN_123';

type ToolResult = { isError?: boolean; content: { text: string }[] };

describe('agentic mcp --http publish_change', () => {
  let repo: Awaited<ReturnType<typeof shopRepo>>;
  let signer: Signer;
  let auth: TestAuthServer;
  let withSink: Awaited<ReturnType<typeof startMcpHttpServer>>;
  let withoutSink: Awaited<ReturnType<typeof startMcpHttpServer>>;
  let host: ReturnType<typeof createFakeGitHost>;

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
  const call = async (
    server: { port: number },
    scope: string,
    args: unknown,
  ): Promise<ToolResult> => {
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
        params: { name: 'publish_change', arguments: args },
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.text();
    const line = body.split('\n').find((l) => l.startsWith('data:'));
    return JSON.parse(line ? line.slice(5) : body).result;
  };
  const publish = (scope: string, args: unknown) => call(withSink, scope, args);

  beforeAll(async () => {
    repo = await shopRepo();
    signer = await makeSigner('RS256', 'k1');
    auth = startAuthServer('oauth');
    auth.published.push(signer.jwk);
    host = createFakeGitHost({ owner: 'acme', repo: 'shop', token: TOKEN });
    const mcp = { issuer: auth.issuer, resource: RESOURCE };
    withSink = await startMcpHttpServer({
      root: repo.root,
      port: 0,
      host: '127.0.0.1',
      mcp,
      publish: {
        config: await loadConfig(join(repo.root, 'agentic.config.ts')),
        sink: new GitHubChangeSink({
          token: TOKEN,
          owner: 'acme',
          repo: 'shop',
          allowedPrefixes: ['src/shop/', 'changes/'],
          fetch: host.fetch,
        }),
      },
    });
    withoutSink = await startMcpHttpServer({
      root: repo.root,
      port: 0,
      host: '127.0.0.1',
      mcp,
    });
  }, 120_000);

  afterAll(async () => {
    await withSink?.close();
    await withoutSink?.close();
    auth?.stop();
    await rm(repo.root, { recursive: true, force: true });
  });

  test('change:publish opens a pull request for the bundle; the token never reaches the client', async () => {
    const r = await publish('change:publish', bundleOf(GOOD));
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0]!.text)).toEqual({
      branch: CHANGE,
      url: 'https://github.com/acme/shop/pull/1',
    });
    expect(r.content[0]!.text).not.toContain(TOKEN);
    expect(host.auth.every((a) => a === `Bearer ${TOKEN}`)).toBe(true);
  });

  test('change:publish:<module> publishes the bundle of that module only', async () => {
    host.refs.delete(`heads/${CHANGE}`);
    const other = await publish('change:publish:billing', bundleOf(GOOD));
    expect(other.isError).toBe(true);
    expect(other.content[0]!.text).toEndWith('[auth.scope-missing]');
    const own = await publish('change:publish:shop', bundleOf(GOOD));
    expect(own.isError).toBeUndefined();
  });

  test('a token with change:propose or domain:read but not change:publish is denied before the host is called', async () => {
    const before = host.requests.length;
    for (const scope of ['change:propose', 'domain:read']) {
      const r = await publish(scope, bundleOf(GOOD));
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toContain(
        'the change:publish scope is needed to publish a change',
      );
      expect(r.content[0]!.text).toEndWith('[auth.scope-missing]');
    }
    expect(host.requests.length).toBe(before);
  });

  test('without a configured sink the tool answers mcp.publish-unavailable', async () => {
    const r = await call(withoutSink, 'change:publish', bundleOf(GOOD));
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toEndWith('[mcp.publish-unavailable]');
  });

  test('the client cannot choose the repository, token or branch', async () => {
    const before = host.requests.length;
    for (const extra of [
      { token: 'x' },
      { repo: 'evil/repo' },
      { owner: 'evil' },
      { branch: 'main' },
    ]) {
      const r = await publish('change:publish', {
        ...bundleOf(GOOD),
        ...extra,
      });
      expect(r.isError).toBe(true);
    }
    expect(host.requests.length).toBe(before);
  });

  test('a body past the transport limit never reaches the host', async () => {
    const before = host.requests.length;
    const big = bundleOf({
      ...GOOD,
      'neutral/big.md': 'SECRET-MARKER'.repeat(100_000),
    });
    // Bun drops the connection past maxRequestBodySize, which is also the publish_change input cap.
    const status = await fetch(`http://127.0.0.1:${withSink.port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${await mint('change:publish')}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'publish_change', arguments: big },
      }),
    }).then(
      (r) => r.status,
      () => 'closed',
    );
    expect(status).not.toBe(200);
    expect(host.requests.length).toBe(before);
  });

  // propose_change returns the whole bundle (packets and neutral model included), which can pass 256 KiB.
  test('a bundle larger than the 256 KiB propose input is still admitted', async () => {
    const big = bundleOf({
      ...GOOD,
      'neutral/big.md': 'x'.repeat(300 * 1024),
    });
    const r = await call(withoutSink, 'change:publish', big);
    expect(r.content[0]!.text).toEndWith('[mcp.publish-unavailable]');
  });

  test('a tampered bundle and a forbidden path are refused before the host is called', async () => {
    const before = host.requests.length;
    const tampered = bundleOf(GOOD);
    tampered.files[0] = { ...tampered.files[0]!, content: 'tampered\n' };
    const bad = bundleOf({
      ...GOOD,
      'target/skeleton/.github/workflows/ci.yml': 'x\n',
    });
    const codes = [
      (await publish('change:publish', tampered)).content[0]!.text,
      (await publish('change:publish', bad)).content[0]!.text,
    ];
    expect(codes[0]).toEndWith('[apply.hash-mismatch]');
    expect(codes[1]).toEndWith('[apply.path-forbidden]');
    expect(host.requests.length).toBe(before);
  });
});

describe('publish_change concurrency', () => {
  test('a second call is refused while one is in flight; the slot frees after success and error', async () => {
    let release = () => {};
    const first = withPublishSlot(
      () => new Promise<string>((done) => (release = () => done('first'))),
    );
    const second = await withPublishSlot(async () => 'ran').catch(
      (e: { code: string }) => e.code,
    );
    expect(second).toBe('mcp.publish-busy');
    release();
    expect(await first).toBe('first');
    expect(
      await withPublishSlot(async () => {
        throw new Error('boom');
      }).catch((e: Error) => e.message),
    ).toBe('boom');
    expect(await withPublishSlot(async () => 'ok')).toBe('ok');
  });
});
