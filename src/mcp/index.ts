import {
  McpServer,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
} from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { isAbsolute, posix, relative } from 'node:path';
import { z } from 'zod';
import { stableStringify } from '../contracts/canonical';
import { AgenticError, canonicalPath, formatCoded } from '../contracts/ir';
import { moduleAccess, type ModuleAccess } from '../auth/scopes';
import type { McpConfig } from '../compiler/config';
import type { DomainLock } from '../compiler/lock';
import type { PublishedLock } from '../compiler/published';
import type { Rule } from '../compiler/rules';
import { checkSnapshot } from '../compiler/snapshot';
import { narrowRulePaths, pathModule, scopeLock } from './scope';
import { changes, element, overview, rulesForPath } from './tools';

// The one scope the gate requires and the per-module filter narrows.
const CAPABILITY = 'domain:read';

// Where the answers come from: the compiled working copy (revalidated per call) or a published lock (fixed).
type Source = { root: string } | { published: PublishedLock };

// `lock` is already filtered to what the caller may read; `fullLock` is for server-side decisions only.
// `root` is absent for a published lock: it has no filesystem.
type Scoped = {
  lock: DomainLock;
  fullLock: DomainLock;
  access: ModuleAccess;
  rules: Rule[];
  root?: string;
};

// The read-only tools, shared by the stdio (local, sees all) and HTTP (`remote`) transports.
function createDomainServer(source: Source, remote: boolean): McpServer {
  // Every call revalidates the snapshot: nothing serves stale data. An error
  // thrown here returns to the client as a result with isError (SDK).
  const guarded =
    <A>(run: (s: Scoped, args: A) => object) =>
    async (args: A, ctx?: { http?: { authInfo?: { scopes: string[] } } }) => {
      const fail = (text: string) => ({
        isError: true,
        content: [{ type: 'text' as const, text }],
      });
      try {
        let base: { lock: DomainLock; rules: Rule[]; root?: string };
        if ('published' in source) base = source.published;
        else {
          const snap = await checkSnapshot(source.root);
          if (!snap.ok) {
            // The snapshot.missing reason embeds an absolute path: not for remote clients.
            if (remote && snap.code === 'snapshot.missing')
              throw new AgenticError(
                snap.code,
                'no snapshot on the server; run `bun run agentic compile` at the project root there',
              );
            throw new AgenticError(snap.code, snap.reason);
          }
          base = snap;
        }
        // Fail closed: a remote call without a grant sees nothing.
        const access: ModuleAccess = remote
          ? (moduleAccess(ctx?.http?.authInfo?.scopes ?? [], CAPABILITY) ??
            new Set<string>())
          : 'all';
        const scoped: Scoped = {
          lock: scopeLock(base.lock, access),
          fullLock: base.lock,
          access,
          rules: base.rules,
          root: base.root,
        };
        return {
          content: [
            { type: 'text' as const, text: stableStringify(run(scoped, args)) },
          ],
        };
      } catch (error) {
        if (error instanceof AgenticError) return fail(formatCoded(error));
        // The SDK forwards error.message of anything else to the client: keep internals off the wire.
        if (remote) {
          // The client gets a generic message, so the operator must still see the cause.
          console.error(error);
          return fail('Internal server error');
        }
        throw error;
      }
    };
  const annotations = { readOnlyHint: true, openWorldHint: false };
  const server = new McpServer({ name: 'agentic-ddd', version: '0.5.0' });

  server.registerTool(
    'domain_source',
    {
      title: 'Domain source',
      description:
        'Tells whether the answers come from a published lock (with its version and digest) or from the working copy of the project.',
      inputSchema: z.object({}),
      annotations,
    },
    guarded(() =>
      'published' in source
        ? {
            mode: 'published',
            version: source.published.version,
            digest: source.published.digest,
          }
        : { mode: 'working-copy' },
    ),
  );
  server.registerTool(
    'domain_overview',
    {
      title: 'Domain overview',
      description:
        'Lists, per module, entities, events, use-cases and operators, with id and description.',
      inputSchema: z.object({}),
      annotations,
    },
    guarded((s) => overview(s.lock)),
  );
  server.registerTool(
    'domain_element',
    {
      title: 'Element detail',
      description:
        'Returns an element by id, with its relations. Prefixes: entity:, method:, invariant:, event:, usecase:, operator: (method and invariant ids appear in the detail of the entity or use-case).',
      inputSchema: z.object({ id: z.string() }),
      annotations,
    },
    guarded<{ id: string }>((s, { id }) => {
      const r = element(s.lock, id);
      if (!r.ok) throw new AgenticError(r.code, r.error);
      return r.value;
    }),
  );
  server.registerTool(
    'domain_changes',
    {
      title: 'Business rule changes',
      description:
        'Lists the recorded changes, optionally only those that cite an id.',
      inputSchema: z.object({ id: z.string().optional() }),
      annotations,
    },
    guarded<{ id?: string }>((s, { id }) => changes(s.lock, id)),
  );
  server.registerTool(
    'rules_for_path',
    {
      title: 'Team rules for a file',
      description:
        'Rules that apply to a file. path is relative to the project root (e.g. examples/orders/a.ts) or absolute inside it.',
      inputSchema: z.object({ path: z.string() }),
      annotations,
    },
    guarded<{ path: string }>((s, { path }) => {
      // Clients often send absolute paths; the rule globs are relative to the root.
      // `\` becomes `/` before the check, as rulesForPath does: `..\x` is also outside the root.
      // normalize resolves inner `./` and `x/..`: `./../a` and `x/../../a` also leave the root.
      // A published lock has no root to resolve against: an absolute path is outside it (and not echoed).
      if (isAbsolute(path) && s.root === undefined)
        throw new AgenticError(
          'mcp.path-outside-root',
          'absolute paths are not accepted by a published lock; send a path relative to the project root',
        );
      const rel = posix.normalize(
        (isAbsolute(path)
          ? relative(s.root as string, canonicalPath(path))
          : path
        ).replaceAll('\\', '/'),
      );
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('../'))
        throw new AgenticError(
          'mcp.path-outside-root',
          `${path}: outside the project root`,
        );
      // The path decides which module's files it names, so it is checked against the unfiltered lock.
      if (s.access !== 'all') {
        const module = pathModule(s.fullLock, rel);
        if (module === undefined || !s.access.has(module))
          throw new AgenticError(
            'mcp.path-out-of-scope',
            `${path}: outside the modules this token may read`,
          );
      }
      const result = rulesForPath(s.rules, rel);
      // A rule's other globs may name modules the token cannot read.
      return s.access === 'all'
        ? result
        : { ...result, rules: narrowRulePaths(result.rules, result.path) };
    }),
  );
  return server;
}

// `published`, when given, replaces the working copy: `root` is then unused.
const sourceOf = (root: string, published?: PublishedLock): Source =>
  published ? { published } : { root };

export function startMcpServer({
  root,
  published,
}: {
  root: string;
  published?: PublishedLock;
}): {
  close(): Promise<void>;
} {
  return serveStdio(() => createDomainServer(sourceOf(root, published), false));
}

const MAX_BODY_BYTES = 1024 * 1024;

const trimSlash = (path: string) =>
  path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;

const LOOPBACK_ALIASES = ['127.0.0.1', 'localhost', '[::1]'];

// DNS-rebinding defense: exact Host (host:port) and Origin allowlists. The SDK helpers are
// hostname-only (any port) and cannot carry a stable code, so the check lives here.
function allowedHostsAndOrigins(host: string, port: number, resource: URL) {
  const lower = host.toLowerCase(); // the Host header is compared lowercased
  const bind =
    lower.includes(':') && !lower.startsWith('[') ? `[${lower}]` : lower;
  const hosts = new Set([`${bind}:${port}`, resource.host]);
  // Only the three names that can stand for the same listener; another 127.x bind keeps its own host.
  if (LOOPBACK_ALIASES.includes(bind))
    for (const name of LOOPBACK_ALIASES) hosts.add(`${name}:${port}`);
  return {
    hosts,
    origins: new Set(
      [...hosts].map((h) => `http://${h}`).concat(resource.origin),
    ),
  };
}

function rejectHostOrigin(
  request: Request,
  { hosts, origins }: ReturnType<typeof allowedHostsAndOrigins>,
): Response | undefined {
  const refuse = (
    code: 'mcp.host-denied' | 'mcp.origin-denied',
    what: string,
  ) =>
    new Response(formatCoded({ code, message: `${what} not allowed` }), {
      status: 403,
    });
  // A missing Origin is a non-browser client: allowed.
  const origin = request.headers.get('origin');
  if (!hosts.has((request.headers.get('host') ?? '').toLowerCase()))
    return refuse('mcp.host-denied', 'Host');
  if (origin !== null && !origins.has(origin.toLowerCase()))
    return refuse('mcp.origin-denied', 'Origin');
}

export async function startMcpHttpServer({
  root,
  published,
  port,
  host,
  mcp,
}: {
  root: string;
  published?: PublishedLock;
  port: number;
  host: string;
  mcp: McpConfig;
}): Promise<{ close(): Promise<void>; port: number }> {
  // Loaded here so the stdio server does not need `jose`.
  const { createResourceServer } = await import('../auth/resource-server');
  const resourceServer = createResourceServer({
    issuer: mcp.issuer,
    resource: mcp.resource,
    jwksUri: mcp.jwksUri,
    requiredScopes: [CAPABILITY],
  });
  const resource = new URL(mcp.resource);
  const mcpPath = trimSlash(resource.pathname);
  const metadataPath = trimSlash(
    new URL(getOAuthProtectedResourceMetadataUrl(resource)).pathname,
  );
  // Stateless: the tools are read-only, so a fresh server per request is enough.
  const handler = createMcpHandler(
    () => createDomainServer(sourceOf(root, published), true),
    {
      maxRequestBodySize: MAX_BODY_BYTES,
    },
  );
  let allowed: ReturnType<typeof allowedHostsAndOrigins> | undefined;
  const server = Bun.serve({
    hostname: host,
    port,
    maxRequestBodySize: MAX_BODY_BYTES,
    // Tool calls revalidate the snapshot on each request, so they can outlast Bun's 10 s default.
    idleTimeout: 120,
    async fetch(request) {
      const pathname = trimSlash(new URL(request.url).pathname);
      if (pathname !== metadataPath && pathname !== mcpPath)
        return new Response('Not found', { status: 404 });
      // Built once: the effective port is only known after the server is listening.
      allowed ??= allowedHostsAndOrigins(host, server.port as number, resource);
      const denied = rejectHostOrigin(request, allowed);
      if (denied) return denied;
      if (pathname === metadataPath) return resourceServer.metadata(request);
      const gated = await resourceServer.gate(request);
      if (gated instanceof Response) return gated;
      return handler.fetch(request, { authInfo: gated });
    },
    // Anything thrown here (JWKS fetch, handler bug) is a bare 500: no internals leak.
    error: () => new Response('Internal server error', { status: 500 }),
  });
  return {
    port: server.port as number,
    async close() {
      await server.stop(true);
      await handler.close();
    },
  };
}
