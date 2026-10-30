// Local demo of the Domain MCP serving a published lock. Everything runs in this process on 127.0.0.1.
import { resolve } from 'node:path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createPublishedLock } from '../src/compiler/published';
import { checkSnapshot } from '../src/compiler/snapshot';
import { startMcpHttpServer } from '../src/mcp/index';

const ROOT = resolve(import.meta.dir, '..');
const LOOPBACK = '127.0.0.1';

const must = (ok: boolean, what: string): void => {
  if (!ok) throw new Error(`mcp-demo: ${what}`);
};

// The MCP's resource URL must carry its port before the server starts, so a probe picks a free one.
// shortcut: the probed port can be taken between the probe and the bind, fine for a local demo.
const freePort = (): number => {
  const probe = Bun.serve({
    port: 0,
    hostname: LOOPBACK,
    fetch: () => new Response(''),
  });
  const port = probe.port as number;
  void probe.stop(true);
  return port;
};

const snap = await checkSnapshot(ROOT);
if (!snap.ok) {
  console.error(
    snap.code === 'snapshot.missing'
      ? 'No compiled snapshot: run `bun run agentic compile` first.'
      : snap.reason,
  );
  process.exit(1);
}
const published = createPublishedLock('demo', snap.lock, snap.rules);

const { privateKey, publicKey } = await generateKeyPair('ES256', {
  extractable: true,
});
const kid = 'demo-key';
const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };

// The local stand-in for the external authorization server: it only publishes the JWKS.
const issuerServer = Bun.serve({
  port: 0,
  hostname: LOOPBACK,
  fetch(request) {
    if (new URL(request.url).pathname === '/jwks.json')
      return Response.json({ keys: [jwk] });
    return new Response('not found', { status: 404 });
  },
});
const issuer = `http://${LOOPBACK}:${issuerServer.port}`;
const mcpPort = freePort();
const mcpUrl = `http://${LOOPBACK}:${mcpPort}/mcp`;

const mcp = await startMcpHttpServer({
  root: ROOT,
  published,
  port: mcpPort,
  host: LOOPBACK,
  mcp: { issuer, resource: mcpUrl, jwksUri: `${issuer}/jwks.json` },
});

type Reply = { status: number; result?: any; body?: string };

// Stateless Streamable HTTP: one POST per call, no session id, the answer may arrive as SSE.
async function rpc(
  token: string | undefined,
  method: string,
  params: object,
): Promise<Reply> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const response = await fetch(mcpUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await response.text();
  if (response.status !== 200) return { status: response.status, body };
  const line = body.split('\n').find((l) => l.startsWith('data:'));
  return {
    status: 200,
    result: JSON.parse(line ? line.slice(5) : body).result,
  };
}

const mint = (scope: string): Promise<string> =>
  new SignJWT({ scope, client_id: 'demo-client' })
    .setProtectedHeader({ alg: 'ES256', kid })
    .setIssuer(issuer)
    .setAudience(mcpUrl)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);

const tool = (token: string | undefined, name: string) =>
  rpc(token, 'tools/call', { name, arguments: {} });
const textOf = (reply: Reply) => JSON.parse(reply.result.content[0].text);

try {
  console.log(`published lock ${published.version} digest ${published.digest}`);
  console.log(`issuer ${issuer}  mcp ${mcpUrl}`);

  const init = await rpc(await mint('domain:read'), 'initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'mcp-demo', version: '0.0.0' },
  });
  must(init.status === 200, `initialize failed with HTTP ${init.status}`);

  const anonymous = await tool(undefined, 'domain_source');
  must(
    anonymous.status === 401,
    `no token should be 401, got ${anonymous.status}`,
  );
  console.log(`no token                 -> HTTP ${anonymous.status}`);

  for (const scope of ['domain:read:orders', 'domain:read']) {
    const reply = await tool(await mint(scope), 'domain_overview');
    must(
      reply.status === 200,
      `${scope} should pass the gate, got ${reply.status}`,
    );
    const modules = textOf(reply).modules.map((m: { name: string }) => m.name);
    console.log(`${scope.padEnd(24)} -> modules: ${modules.join(', ')}`);
  }

  const source = await tool(await mint('domain:read'), 'domain_source');
  must(
    source.status === 200,
    `domain_source failed with HTTP ${source.status}`,
  );
  const info = textOf(source);
  must(
    info.mode === 'published' && info.digest === published.digest,
    'domain_source disagrees with the lock',
  );
  console.log(`domain_source            -> ${JSON.stringify(info)}`);
} finally {
  await mcp.close();
  await issuerServer.stop(true);
}
console.log('stopped');
