// Runtime MCP over HTTP: one tool per mounted Operator, behind the shared OAuth resource server.
// Loaded dynamically by the NestJS module, so the MCP SDK and `jose` stay optional peers.
import {
  ProtocolError,
  ProtocolErrorCode,
  Server,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  type AuthInfo,
} from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createResourceServer } from '../auth/resource-server';
import { moduleAccess } from '../auth/scopes';
import { AgenticError } from '../contracts/codes';
import { isSecureOrLoopbackUrl } from '../contracts/url';
import type { OperatorRunResult, OperatorRuntime } from '@agentic-ddd/runtime';
import { rejectHostOrigin } from './host-origin';
import { MCP_SERVER_VERSION } from './version';

export interface RuntimeMcpOptions {
  /** Authorization server issuer; tokens must carry exactly this `iss`. */
  readonly issuer: string;
  /** Resource identifier (RFC 8707); must be `https` (or loopback `http`) and end in exactly `/mcp`. */
  readonly resource: string;
  /** Skips JWKS discovery when set. */
  readonly jwksUri?: string;
  /** Operators exposed over MCP. A name containing `:` is refused: it would make the scope grammar ambiguous. */
  readonly operatorAllowlist: readonly string[];
  /** Builds the run context from the verified JWT claims; without it runs get no context. */
  readonly resolveContext?: (
    claims: Readonly<Record<string, unknown>>,
  ) => unknown;
  /** Adds the run's domain events to the tool result (default: off). */
  readonly includeEvents?: boolean;
}

export interface RuntimeMcpHandler {
  fetch(request: Request, parsedBody?: unknown): Promise<Response>;
  close(): Promise<void>;
}

const MCP_PATH = '/mcp';
const capability = (name: string) => `operator:run:${name}`;
// Strict: any other key (context, runId, approval...) is a control field the client may not set.
const nonblank = /\S/;
const callInput = z.strictObject({ message: z.string().regex(nonblank) });
const INPUT_SCHEMA = {
  type: 'object' as const,
  properties: { message: { type: 'string', pattern: nonblank.source } },
  required: ['message'],
  additionalProperties: false,
};
// One answer for an Operator that is absent, not allowlisted or not granted: it reveals nothing.
const unknownTool = () =>
  new ProtocolError(ProtocolErrorCode.InvalidParams, 'Unknown tool');
const invalidInput = () =>
  new ProtocolError(ProtocolErrorCode.InvalidParams, 'Invalid arguments');
const internalError = () =>
  new ProtocolError(ProtocolErrorCode.InternalError, 'Internal error');

function invalidConfig(message: string): AgenticError {
  return new AgenticError('config.mcp-url-invalid', message);
}

function validate(options: RuntimeMcpOptions): URL {
  const urlFor = (field: 'issuer' | 'resource' | 'jwksUri') => {
    const value = options[field];
    if (typeof value !== 'string' || !URL.canParse(value))
      throw invalidConfig(`${field} must be an absolute URL`);
    const url = new URL(value);
    if (!isSecureOrLoopbackUrl(url))
      throw invalidConfig(`${field} must use HTTPS or loopback HTTP`);
    if (
      url.username ||
      url.password ||
      url.hash ||
      (field !== 'jwksUri' && url.search)
    )
      throw invalidConfig(`Invalid credentials, fragment or query in ${field}`);
    return url;
  };
  urlFor('issuer');
  if (options.jwksUri !== undefined) urlFor('jwksUri');
  const resource = urlFor('resource');
  if (resource.pathname !== MCP_PATH)
    throw invalidConfig(`resource must have the path ${MCP_PATH}`);
  if (options.operatorAllowlist.some((name) => !name || /[:\s]/.test(name)))
    throw new AgenticError(
      'config.not-text-list',
      'Operator names in operatorAllowlist must be nonempty and contain no whitespace or colon',
    );
  return resource;
}

// Absent, hidden by the allowlist and ungranted Operators are all simply not in this list.
function visibleOperators(
  runtime: OperatorRuntime,
  allowlist: ReadonlySet<string>,
  scopes: readonly string[],
) {
  return runtime.listOperators().filter(({ name, module }) => {
    if (!allowlist.has(name)) return false;
    const access = moduleAccess(scopes, capability(name));
    return access === 'all' || access?.has(module) === true;
  });
}

function claimsOf(info: AuthInfo | undefined): Record<string, unknown> {
  const claims = info?.extra?.claims;
  if (typeof claims !== 'object' || claims === null || Array.isArray(claims))
    throw internalError();
  return claims as Record<string, unknown>;
}

// JSON round-trip: the result is plain data, never a live domain object.
function project(result: OperatorRunResult, includeEvents: boolean) {
  return JSON.parse(
    JSON.stringify({
      runId: result.runId,
      operator: result.operator,
      status: result.status,
      reason: result.reason,
      output: result.output,
      ...(includeEvents
        ? {
            events: result.events.map((event) => ({
              name: event.name,
              payload: event.payload,
              eventId: event.eventId,
              occurredAt: event.occurredAt,
              correlationId: event.correlationId,
              causationId: event.causationId,
            })),
          }
        : {}),
    }),
  ) as Record<string, unknown>;
}

export function createRuntimeMcpHandler(
  runtime: OperatorRuntime,
  options: RuntimeMcpOptions,
): RuntimeMcpHandler {
  const resource = validate(options);
  const allowlist = new Set(options.operatorAllowlist);
  const resourceServer = createResourceServer({
    issuer: options.issuer,
    resource: options.resource,
    jwksUri: options.jwksUri,
    requiredScopes: [],
    supportedScopes: [...allowlist].map(capability),
  });
  const metadataPath = new URL(getOAuthProtectedResourceMetadataUrl(resource))
    .pathname;
  const allowed = {
    hosts: new Set([resource.host]),
    origins: new Set([resource.origin]),
  };

  // A fresh Server per request: nothing is shared between callers, so tokens cannot bleed over.
  const handler = createMcpHandler(
    () => {
      const server = new Server(
        { name: 'agentic-ddd-runtime', version: MCP_SERVER_VERSION },
        { capabilities: { tools: {} } },
      );
      server.setRequestHandler('tools/list', (_request, ctx) => ({
        tools: visibleOperators(
          runtime,
          allowlist,
          ctx.http?.authInfo?.scopes ?? [],
        ).map(({ name, description }) => ({
          name,
          description,
          inputSchema: INPUT_SCHEMA,
        })),
      }));
      server.setRequestHandler('tools/call', async (request, ctx) => {
        const info = ctx.http?.authInfo;
        const target = visibleOperators(
          runtime,
          allowlist,
          info?.scopes ?? [],
        ).find(({ name }) => name === request.params.name);
        if (!target) throw unknownTool();
        const input = callInput.safeParse(request.params.arguments);
        if (!input.success) throw invalidInput();
        try {
          const context = options.resolveContext
            ? await options.resolveContext(claimsOf(info))
            : undefined;
          const result = await runtime.run(target.name, {
            message: input.data.message,
            ...(context === undefined ? {} : { context }),
          });
          const structuredContent = project(
            result,
            options.includeEvents === true,
          );
          return server.projectCallToolResult(
            {
              content: [
                { type: 'text', text: JSON.stringify(structuredContent) },
              ],
              structuredContent,
            },
            undefined,
          );
        } catch {
          // Never echo a resolver, provider or runtime error to the caller.
          throw internalError();
        }
      });
      return server;
    },
    // Operators return their events in the call result; there is no subscription feed.
    { legacy: 'stateless', maxSubscriptions: 0 },
  );

  return {
    async fetch(request, parsedBody) {
      const { pathname } = new URL(request.url);
      if (pathname !== MCP_PATH && pathname !== metadataPath)
        return new Response('Not found', { status: 404 });
      const denied = rejectHostOrigin(request, allowed);
      if (denied) return denied;
      if (pathname === metadataPath) return resourceServer.metadata(request);
      const gated = await resourceServer.gate(request);
      if (gated instanceof Response) return gated;
      if (Array.isArray(parsedBody))
        return Response.json(
          {
            jsonrpc: '2.0',
            id: null,
            error: {
              code: ProtocolErrorCode.InvalidRequest,
              message: 'Send one MCP message per request',
            },
          },
          { status: 400 },
        );
      return handler.fetch(request, { authInfo: gated, parsedBody });
    },
    close: () => handler.close(),
  };
}
