// Local demo of the Domain MCP serving a published lock. Everything runs in this process on 127.0.0.1.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { publishLockCommand } from '../src/cli/commands/publishLock';
import { readPublishedLock } from '../src/compiler/published';
import { startMcpHttpServer } from '../src/mcp/index';
import { parseSseData } from './sse-data';

const ROOT = resolve(import.meta.dir, '..');
const LOOPBACK = '127.0.0.1';

const must = (ok: boolean, what: string): void => {
  if (!ok) throw new Error(`mcp-demo: ${what}`);
};

// The MCP's resource URL must carry its port before the server starts, so a probe picks a free one.
// shortcut: the probed port can be taken between the probe and the bind, fine for a local demo.
const freePort = async (): Promise<number> => {
  const probe = Bun.serve({
    port: 0,
    hostname: LOOPBACK,
    fetch: () => new Response(''),
  });
  const port = probe.port as number;
  await probe.stop(true);
  return port;
};

const keepAlive = process.argv.includes('--keep-alive');

// Reuse the real `publish-lock` command (it reports a missing or stale snapshot) and read the artifact back.
const artifactDir = await mkdtemp(join(tmpdir(), 'mcp-demo-'));
const artifact = join(artifactDir, 'domain.published.json');
const code = await publishLockCommand([
  '--version',
  'demo',
  '--out',
  artifact,
  '--root',
  ROOT,
]);
if (code !== 0) process.exit(code);
const published = await readPublishedLock(artifact, artifact);
await rm(artifactDir, { recursive: true, force: true });

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
const mcpPort = await freePort();
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
  return { status: 200, result: parseSseData(body).result };
}

const mint = (scope: string, expiresIn = '5m'): Promise<string> =>
  new SignJWT({ scope, client_id: 'demo-client' })
    .setProtectedHeader({ alg: 'ES256', kid })
    .setIssuer(issuer)
    .setAudience(mcpUrl)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(privateKey);

const tool = (token: string | undefined, name: string) =>
  rpc(token, 'tools/call', { name, arguments: {} });
const textOf = (reply: Reply) => JSON.parse(reply.result.content[0].text);

try {
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

  if (keepAlive) {
    console.log(`
keep-alive: MCP ${mcpUrl}`);
    console.log('token (domain:read, valid 10 minutes):');
    console.log(await mint('domain:read', '10m'));
    console.log('Press Ctrl+C to stop.');
    await new Promise<void>((done) => {
      process.once('SIGINT', done);
      process.once('SIGTERM', done);
    });
  }
} finally {
  await mcp.close();
  await issuerServer.stop(true);
}
console.log('stopped');
