import { formatCoded } from '../contracts/codes';

export interface HostOriginAllowlist {
  /** Exact `host:port` values, compared lowercased. */
  readonly hosts: ReadonlySet<string>;
  /** Exact origins, compared lowercased. */
  readonly origins: ReadonlySet<string>;
}

// DNS-rebinding defense shared by the MCP HTTP servers: a 403 with a stable code, or undefined to proceed.
export function rejectHostOrigin(
  request: Request,
  { hosts, origins }: HostOriginAllowlist,
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
