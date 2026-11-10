import {
  McpServer,
  ResourceNotFoundError,
  ResourceTemplate,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
} from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { isAbsolute, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { stableStringify } from '../contracts/canonical';
import { AgenticError, canonicalPath, formatCoded } from '../contracts/ir';
import { compileBundle, type Bundle } from '../compiler/bundle/index';
import { moduleAccess, type ModuleAccess } from '../auth/scopes';
import type { McpConfig } from '../compiler/config';
import type { DomainLock } from '../compiler/lock';
import type { ResolvedConventions } from '../compiler/conventions';
import type { PublishedLock } from '../compiler/published';
import type { Rule } from '../compiler/rules';
import { checkSnapshot } from '../compiler/snapshot';
import { publishBundle, type PublishTarget } from '../publish/bundle';
import type { PublishedChange } from '../publish/change-sink';
import {
  coversModule,
  lockModules,
  narrowRuleGlobs,
  pathModule,
  scopeLock,
} from './scope';
import {
  authoringCatalogue,
  authoringLoader,
  catalogue,
  findDoc,
  index,
  LANGUAGE_RULE,
  type AuthoringDoc,
  type SkillDoc,
} from './skills';
import { changes, element, overview, rulesForPath } from './tools';

// The scopes the per-module filter narrows: `domain:read` for the domain tools, `skill:read` for the skill documents.
const CAPABILITY = 'domain:read';
const SKILL_CAPABILITY = 'skill:read';
const PROPOSE_CAPABILITY = 'change:propose';
const PUBLISH_CAPABILITY = 'change:publish';
// Room for a large Delta plus its proposal.md; anything bigger is refused before any work.
const MAX_INPUT_BYTES = 256 * 1024;
const MAX_BODY_BYTES = 1024 * 1024;
// publish_change takes what propose_change returned (skeleton, packets and neutral model, well past its own input),
// so it gets the largest body the HTTP transport accepts.
const MAX_PUBLISH_BYTES = MAX_BODY_BYTES;

// One call at a time per server process, fail fast, no queue: a compile is a git checkout plus two
// child processes, a publish is a burst of requests with the server token.
function oneAtATime(
  code: 'mcp.propose-busy' | 'mcp.publish-busy',
  tool: string,
) {
  let busy = false;
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (busy)
      throw new AgenticError(
        code,
        `another ${tool} is running on this server; retry shortly`,
      );
    busy = true;
    try {
      return await work();
    } finally {
      busy = false;
    }
  };
}
export const withProposeSlot = oneAtATime('mcp.propose-busy', 'propose_change');
export const withPublishSlot = oneAtATime('mcp.publish-busy', 'publish_change');

const noGrant = (access: ModuleAccess) => access !== 'all' && access.size === 0;

function requireGrant(
  access: ModuleAccess,
  capability: string,
  what: string,
): void {
  if (noGrant(access))
    throw new AgenticError(
      'auth.scope-missing',
      `the ${capability} scope is needed to ${what}`,
    );
}

function assertInputSize(args: unknown, max = MAX_INPUT_BYTES): void {
  if (Buffer.byteLength(JSON.stringify(args)) > max)
    throw new AgenticError(
      'mcp.input-too-large',
      `the input exceeds ${max} bytes`,
    );
}

// The authoring skill ships next to `src` and `dist`: the same relative path resolves from both.
const AUTHORING_DIR = fileURLToPath(
  new URL('../../skills/agentic-ddd', import.meta.url),
);
const INSTRUCTIONS = `${LANGUAGE_RULE} This server serves a domain contract. Before proposing a change, call authoring_guide (or read the skill:// resources): it explains how to write the proposal and the dev skill of each module.`;

// Where the answers come from: the compiled working copy (revalidated per call) or a published lock (fixed).
type Source = { root: string; config?: string } | { published: PublishedLock };

// `lock` is already filtered to what the caller may read; `fullLock` is for server-side decisions only.
// `root` is absent for a published lock: it has no filesystem.
type Scoped = {
  lock: DomainLock;
  fullLock: DomainLock;
  access: ModuleAccess;
  rules: Rule[];
  conventions: ResolvedConventions;
  root?: string;
};

type Ctx = { http?: { authInfo?: { scopes: string[] } } };

type ProposeArgs = {
  delta: Record<string, unknown>;
  proposal: { slug: string; markdown: string };
};

// Scope, size and source are checked before any work; a published lock has no working copy to compile against.
async function proposeChange(
  source: Source,
  access: ModuleAccess,
  args: ProposeArgs,
): Promise<Bundle> {
  if (!coversModule(access, args.delta.module))
    throw new AgenticError(
      'auth.scope-missing',
      `the ${PROPOSE_CAPABILITY} scope for the module of the Delta is needed`,
    );
  assertInputSize(args);
  if ('published' in source)
    throw new AgenticError(
      'mcp.propose-unavailable',
      'this server serves a published lock; propose_change needs a working copy',
    );
  // The base is the HEAD commit (lock, conventions, `changes/`): compileBundle validates,
  // numbers and renders against it, never against the served working copy.
  return withProposeSlot(() =>
    compileBundle({
      delta: args.delta,
      baseRoot: source.root,
      configPath: source.config,
      baseRef: 'HEAD',
      proposal: args.proposal,
    }),
  );
}

type PublishArgs = { hash: string; files: { path: string; content: string }[] };

// Scope, size and source are checked before any work; the module of the bundle is checked in publishBundle.
async function publishChange(
  source: Source,
  publish: PublishTarget | undefined,
  access: ModuleAccess,
  args: PublishArgs,
): Promise<PublishedChange> {
  requireGrant(access, PUBLISH_CAPABILITY, 'publish a change');
  assertInputSize(args, MAX_PUBLISH_BYTES);
  if (!publish || 'published' in source)
    throw new AgenticError(
      'mcp.publish-unavailable',
      'this server has no Git host configured for publishing, or serves a published lock',
    );
  const { root } = source;
  return withPublishSlot(() =>
    publishBundle({
      bundle: args,
      root,
      config: publish.config,
      access,
      sink: publish.sink,
    }),
  );
}

// What the servers of one process may share instead of redoing it per request (HTTP builds a server per request).
export type Shared = {
  authoringDocs: () => Promise<AuthoringDoc[] | null>;
  snapshot: typeof checkSnapshot;
  catalogue: typeof catalogue;
  // Published mode only (the lock never changes), keyed by access.
  catalogues: Map<string, SkillDoc[]>;
};

// `check` and `catalogue` are injectable so a test can count the real work.
export function createShared(
  authoringDir = AUTHORING_DIR,
  deps: { check?: typeof checkSnapshot; catalogue?: typeof catalogue } = {},
): Shared {
  const check = deps.check ?? checkSnapshot;
  const inFlight = new Map<string, ReturnType<typeof checkSnapshot>>();
  return {
    authoringDocs: authoringLoader(authoringDir),
    // A check in flight is shared; a call that arrives after it finished starts another.
    snapshot: (root) => {
      let run = inFlight.get(root);
      if (!run) {
        run = check(root).finally(() => inFlight.delete(root));
        inFlight.set(root, run);
      }
      return run;
    },
    catalogue: deps.catalogue ?? catalogue,
    catalogues: new Map(),
  };
}

// Distinct access sets are few in practice; this bounds the memo against a flood of crafted ones.
const MAX_CATALOGUES = 256;

// Published mode: the lock never changes, so the catalogue depends only on the lock and on which of its modules the
// token reads. The key names every module the lock mentions (`lockModules`) and the lock's digest.
// Nothing is kept while the authoring skill is missing: it may be there on the next call.
function publishedCatalogue(
  shared: Shared,
  published: PublishedLock,
  input: Parameters<typeof catalogue>[0],
  authoringAvailable: boolean,
): SkillDoc[] {
  const { fullLock, skillAccess: access } = input;
  const key = `${published.digest}:${
    access === 'all'
      ? 'all'
      : JSON.stringify(
          [...lockModules(fullLock)].filter((name) => access.has(name)).sort(),
        )
  }`;
  let docs = shared.catalogues.get(key);
  if (!docs) {
    docs = shared.catalogue(input);
    if (authoringAvailable) {
      // shortcut: crude cap on distinct access sets, upgrade to LRU if real deployments exceed it
      if (shared.catalogues.size >= MAX_CATALOGUES) shared.catalogues.clear();
      shared.catalogues.set(key, docs);
    }
  }
  return docs;
}

// The tools and skill documents, shared by the stdio (local, sees all) and HTTP (`remote`) transports.
// `publish` is where publish_change sends a bundle (its sink and the project config); without it that tool answers `mcp.publish-unavailable`.
// `shared` is built once by a long-lived caller; without it the server keeps its own, built from `authoringDir`.
// When `shared` is passed, `authoringDir` is ignored: the `Shared` carries its own directory.
export function createDomainServer(
  source: Source,
  remote: boolean,
  authoringDir = AUTHORING_DIR,
  publish?: PublishTarget,
  shared: Shared = createShared(authoringDir),
): McpServer {
  // The skill comes from the installed package, not from the project: read once per `shared`, in both modes.
  // Fail closed: a remote call without a grant sees nothing.
  const accessOf = (ctx: Ctx | undefined, capability: string): ModuleAccess =>
    remote
      ? (moduleAccess(ctx?.http?.authInfo?.scopes ?? [], capability) ??
        new Set<string>())
      : 'all';
  // Every call revalidates the snapshot: a check in flight is shared; a call that arrives after it finished starts another.
  const scopedFor = async (
    ctx: Ctx | undefined,
    capability: string,
  ): Promise<Scoped> => {
    let base: {
      lock: DomainLock;
      rules: Rule[];
      conventions: ResolvedConventions;
      root?: string;
    };
    if ('published' in source) base = source.published;
    else {
      const snap = await shared.snapshot(source.root);
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
    const access = accessOf(ctx, capability);
    return {
      lock: scopeLock(base.lock, access),
      fullLock: base.lock,
      access,
      rules: base.rules,
      conventions: base.conventions,
      root: base.root,
    };
  };
  // The documents the caller may read, from the same source for the tool and the resources.
  // The authoring skill does not need the snapshot; the dev skills and rules do, and `unavailable` says why they are missing.
  const docsOf = async (
    ctx: Ctx | undefined,
  ): Promise<{
    docs: SkillDoc[];
    authoring: boolean;
    unavailable?: AgenticError;
  }> => {
    // Before any work: a token without the grant does not trigger the load.
    if (noGrant(accessOf(ctx, SKILL_CAPABILITY)))
      return { docs: [], authoring: false };
    const authoring = await shared.authoringDocs();
    const available = authoring !== null;
    try {
      const s = await scopedFor(ctx, SKILL_CAPABILITY);
      const input = {
        authoring: authoring ?? [],
        fullLock: s.fullLock,
        rules: s.rules,
        skillAccess: s.access,
        conventions: s.conventions,
      };
      return {
        docs:
          'published' in source
            ? publishedCatalogue(shared, source.published, input, available)
            : shared.catalogue(input),
        authoring: available,
      };
    } catch (error) {
      if (!(error instanceof AgenticError)) throw error;
      return {
        docs: authoringCatalogue(authoring ?? []),
        authoring: available,
        unavailable: error,
      };
    }
  };
  // An error thrown here returns to the client as a result with isError (SDK). A string result is sent verbatim.
  const respond = async (
    work: () => object | string | Promise<object | string>,
  ) => {
    const fail = (text: string) => ({
      isError: true,
      content: [{ type: 'text' as const, text }],
    });
    try {
      const out = await work();
      return {
        content: [
          {
            type: 'text' as const,
            text: typeof out === 'string' ? out : stableStringify(out),
          },
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
  const guarded =
    <A>(
      run: (s: Scoped, args: A) => object | string | Promise<object | string>,
      capability = CAPABILITY,
    ) =>
    (args: A, ctx?: Ctx) =>
      respond(async () => {
        requireGrant(accessOf(ctx, capability), capability, 'read the domain');
        return run(await scopedFor(ctx, capability), args);
      });
  // Resource callbacks: the SDK sends error.message to the client, so a remote caller gets only coded ones.
  const docsFor = async (ctx: Ctx): Promise<SkillDoc[]> => {
    try {
      return (await docsOf(ctx)).docs;
    } catch (error) {
      if (error instanceof AgenticError) throw new Error(formatCoded(error));
      if (!remote) throw error;
      console.error(error);
      throw new Error('Internal server error');
    }
  };
  const annotations = { readOnlyHint: true, openWorldHint: false };
  const server = new McpServer(
    { name: 'agentic-ddd', version: '0.7.0' },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    'domain_source',
    {
      title: 'Domain source',
      description:
        'Tells whether the answers come from a published lock (with its version and digest) or from the working copy of the project.',
      inputSchema: z.object({}),
      annotations,
    },
    // Constant per server: deliberately not guarded, so it answers even when the snapshot is stale or missing.
    async () => ({
      content: [
        {
          type: 'text' as const,
          text: stableStringify(
            'published' in source
              ? {
                  mode: 'published',
                  version: source.published.version,
                  digest: source.published.digest,
                }
              : { mode: 'working-copy' },
          ),
        },
      ],
    }),
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
        : {
            ...result,
            rules: narrowRuleGlobs(result.rules, s.fullLock, s.access),
          };
    }),
  );
  server.registerTool(
    'authoring_guide',
    {
      title: 'Authoring guide',
      description: `${LANGUAGE_RULE} Call this before proposing a change: without doc it returns the index of the authoring skill, the dev skill of each readable module and the team rules; with doc (a skill:// URI or a short name such as orders-dev) it returns that document.`,
      inputSchema: z.object({ doc: z.string().optional() }),
      annotations: { ...annotations, destructiveHint: false },
    },
    ({ doc }: { doc?: string }, ctx?: Ctx) =>
      respond(async () => {
        // Not the snapshot-bound `guarded`: the authoring skill is served without one.
        requireGrant(
          accessOf(ctx, SKILL_CAPABILITY),
          SKILL_CAPABILITY,
          'read skill documents',
        );
        const { docs, authoring, unavailable } = await docsOf(ctx);
        if (doc === undefined)
          return index(
            docs,
            authoring,
            unavailable &&
              `Dev skills and team rules are unavailable (${unavailable.code}): run \`bun run agentic compile\` at the project root.`,
          );
        // A hidden document is not in `docs`: it answers exactly like an unknown one.
        const found = findDoc(docs, doc);
        if (!found) {
          if (unavailable) throw unavailable;
          throw new AgenticError(
            'mcp.doc-unknown',
            'no such document; call authoring_guide without doc for the index',
          );
        }
        return found.content;
      }),
  );
  server.registerTool(
    'propose_change',
    {
      title: 'Propose a change',
      description: `${LANGUAGE_RULE} Renders a Delta (the domain change as JSON) onto the served project, compiles it in a temporary worktree and returns the compiled bundle: manifest, hash and files (BUNDLE.md first). The proposal (a kebab-case slug and the proposal.md text) is required: the bundle carries it as changes/NNNN-slug/proposal.md. The base, conventions and limits are fixed by the server; nothing is stored.`,
      inputSchema: z.strictObject({
        delta: z.record(z.string(), z.unknown()),
        proposal: z.strictObject({ slug: z.string(), markdown: z.string() }),
      }),
      // Not read-only: it creates a git worktree and runs processes on the server (gone on return).
      annotations: {
        ...annotations,
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (args: ProposeArgs, ctx?: Ctx) =>
      respond(() =>
        proposeChange(source, accessOf(ctx, PROPOSE_CAPABILITY), args),
      ),
  );
  server.registerTool(
    'publish_change',
    {
      title: 'Publish a change',
      description: `${LANGUAGE_RULE} Publishes a compiled bundle, exactly as propose_change returned it (hash and files), as a branch and pull request on the Git host the server is configured for. Only the skeleton files and the change directory that \`agentic apply\` would write go into the branch; it never targets the main branch. The repository and credentials are fixed by the server.`,
      inputSchema: z.strictObject({
        // Redundant with bundle.json in `files`, which is the one the hash is checked against.
        manifest: z.record(z.string(), z.unknown()).optional(),
        hash: z.string(),
        files: z.array(
          z.strictObject({ path: z.string(), content: z.string() }),
        ),
      }),
      // Opens a pull request on the Git host: a visible side effect, never idempotent (the branch exists afterwards).
      annotations: {
        ...annotations,
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args: PublishArgs, ctx?: Ctx) =>
      respond(() =>
        publishChange(source, publish, accessOf(ctx, PUBLISH_CAPABILITY), args),
      ),
  );
  server.registerResource(
    'skill',
    new ResourceTemplate('skill://{+path}', {
      list: async (ctx) => ({
        resources: (await docsFor(ctx)).map((d) => ({
          uri: d.uri,
          name: d.uri.slice('skill://'.length),
          title: d.title,
          description: d.purpose,
          mimeType: 'text/markdown',
        })),
      }),
    }),
    { mimeType: 'text/markdown' },
    async (uri, _variables, ctx) => {
      // Exact URI only (no short names), and only what this caller may list.
      const found = (await docsFor(ctx)).find((d) => d.uri === uri.href);
      if (!found) throw new ResourceNotFoundError(uri.href);
      return {
        contents: [
          { uri: found.uri, mimeType: 'text/markdown', text: found.content },
        ],
      };
    },
  );
  return server;
}

// `published`, when given, replaces the working copy: `root` is then unused.
const sourceOf = (
  root: string,
  published?: PublishedLock,
  config?: string,
): Source => (published ? { published } : { root, config });

export function startMcpServer({
  root,
  published,
  config,
  publish,
}: {
  root: string;
  published?: PublishedLock;
  config?: string;
  publish?: PublishTarget;
}): {
  close(): Promise<void>;
} {
  return serveStdio(() =>
    createDomainServer(
      sourceOf(root, published, config),
      false,
      undefined,
      publish,
    ),
  );
}

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
  config,
  port,
  host,
  mcp,
  publish,
}: {
  root: string;
  published?: PublishedLock;
  config?: string;
  port: number;
  host: string;
  mcp: McpConfig;
  publish?: PublishTarget;
}): Promise<{ close(): Promise<void>; port: number }> {
  // Loaded here so the stdio server does not need `jose`.
  const { createResourceServer } = await import('../auth/resource-server');
  const resourceServer = createResourceServer({
    issuer: mcp.issuer,
    resource: mcp.resource,
    jwksUri: mcp.jwksUri,
    requiredScopes: [],
    anyOfScopes: [
      CAPABILITY,
      SKILL_CAPABILITY,
      PROPOSE_CAPABILITY,
      PUBLISH_CAPABILITY,
    ],
  });
  const resource = new URL(mcp.resource);
  const mcpPath = trimSlash(resource.pathname);
  const metadataPath = trimSlash(
    new URL(getOAuthProtectedResourceMetadataUrl(resource)).pathname,
  );
  // Stateless: no session state (publish_change keeps only a per-process busy flag), so a fresh server per request is enough.
  const shared = createShared();
  const handler = createMcpHandler(
    () =>
      createDomainServer(
        sourceOf(root, published, config),
        true,
        undefined,
        publish,
        shared,
      ),
    {
      maxRequestBodySize: MAX_BODY_BYTES,
    },
  );
  let allowed: ReturnType<typeof allowedHostsAndOrigins> | undefined;
  const server = Bun.serve({
    hostname: host,
    port,
    maxRequestBodySize: MAX_BODY_BYTES,
    // A propose_change compile runs up to its 120 s budget plus the worktree setup, with nothing on the
    // connection meanwhile: stay above it (255 s is Bun's maximum).
    idleTimeout: 255,
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
