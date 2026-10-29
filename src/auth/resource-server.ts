// OAuth 2.1 resource-server gate: verifies JWT access tokens against the issuer's JWKS and
// answers RFC 9728 metadata. It knows nothing about MCP tools, so a Runtime MCP can reuse it.
import {
  type AuthInfo,
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
  bearerAuthChallengeResponse,
  getOAuthProtectedResourceMetadataUrl,
  requireBearerAuth,
} from '@modelcontextprotocol/server';
import {
  type JWTVerifyGetKey,
  createRemoteJWKSet,
  errors,
  jwtVerify,
} from 'jose';
import { z } from 'zod';
import type { ErrorCode } from '../contracts/codes';

export type { AuthInfo };

export interface ResourceServerOptions {
  /** Authorization server issuer; tokens must carry exactly this `iss`. */
  readonly issuer: string;
  /** Resource identifier (RFC 8707); tokens must carry it in `aud`. */
  readonly resource: string;
  /** Skips discovery when set. */
  readonly jwksUri?: string;
  readonly requiredScopes: readonly string[];
  /** Minimum delay between JWKS re-fetches on an unknown `kid` (default: jose's 30s). */
  readonly jwksCooldownMs?: number;
}

export interface ResourceServer {
  /** A `Response` is a ready 401/403 challenge to send as-is; otherwise the verified token. */
  gate(request: Request): Promise<Response | AuthInfo>;
  /** RFC 9728 Protected Resource Metadata document. */
  metadata(request: Request): Response;
}

const FETCH_TIMEOUT_MS = 5000;
const CLOCK_TOLERANCE_S = 5;
const ALGORITHMS = ['RS256', 'ES256'];
const DISCOVERY_PATHS = [
  '/.well-known/oauth-authorization-server',
  '/.well-known/openid-configuration',
];
const discoveryDocument = z.object({
  issuer: z.string(),
  jwks_uri: z.string(),
});

// The code goes in error_description; messages stay generic (no URLs, keys or stacks).
function authError(
  code: ErrorCode,
  message: string,
  oauth: OAuthErrorCode = OAuthErrorCode.InvalidToken,
): OAuthError {
  return new OAuthError(oauth, `${code}: ${message}`);
}

async function discoverJwksUri(issuer: string): Promise<string> {
  for (const path of DISCOVERY_PATHS) {
    try {
      const res = await fetch(issuer.replace(/\/+$/, '') + path, {
        redirect: 'error',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const doc = discoveryDocument.safeParse(await res.json());
      if (doc.success && doc.data.issuer === issuer) return doc.data.jwks_uri;
    } catch {
      // try the next well-known location
    }
  }
  throw new Error('JWKS discovery failed');
}

function createVerifier(options: ResourceServerOptions): OAuthTokenVerifier {
  const { issuer, resource, requiredScopes } = options;
  let keys: Promise<JWTVerifyGetKey> | undefined;
  const getKeys = (): Promise<JWTVerifyGetKey> =>
    (keys ??= (async () => {
      const uri = options.jwksUri ?? (await discoverJwksUri(issuer));
      return createRemoteJWKSet(new URL(uri), {
        timeoutDuration: FETCH_TIMEOUT_MS,
        cooldownDuration: options.jwksCooldownMs,
      });
    })().catch((error: unknown) => {
      keys = undefined; // retry discovery on the next request
      throw error;
    }));

  return {
    async verifyAccessToken(token) {
      let payload;
      try {
        ({ payload } = await jwtVerify(token, await getKeys(), {
          algorithms: ALGORITHMS,
          issuer,
          audience: resource,
          clockTolerance: CLOCK_TOLERANCE_S,
        }));
      } catch (error) {
        if (error instanceof errors.JWTExpired) {
          throw authError(
            'auth.token-expired',
            'The access token has expired.',
          );
        }
        if (error instanceof errors.JWTClaimValidationFailed) {
          if (error.claim === 'iss') {
            throw authError(
              'auth.issuer-mismatch',
              'The token issuer is not accepted.',
            );
          }
          if (error.claim === 'aud') {
            throw authError(
              'auth.audience-mismatch',
              'The token is not for this resource.',
            );
          }
        }
        // Signature, algorithm, unknown kid, malformed token: one generic answer. Other
        // failures (JWKS fetch/discovery) propagate and become a bare 500.
        if (
          error instanceof errors.JOSEError &&
          !(error instanceof errors.JWKSTimeout)
        ) {
          throw authError(
            'auth.token-invalid',
            'The access token failed verification.',
          );
        }
        throw error;
      }
      const scopes =
        typeof payload.scope === 'string'
          ? payload.scope.split(' ').filter(Boolean)
          : [];
      if (!requiredScopes.every((s) => scopes.includes(s))) {
        throw authError(
          'auth.scope-missing',
          'The token lacks a required scope.',
          OAuthErrorCode.InsufficientScope,
        );
      }
      const clientId = payload.client_id ?? payload.azp ?? payload.sub;
      return {
        token,
        clientId: typeof clientId === 'string' ? clientId : '',
        scopes,
        expiresAt: payload.exp,
        resource: new URL(resource),
      };
    },
  };
}

export function createResourceServer(
  options: ResourceServerOptions,
): ResourceServer {
  const resourceUrl = new URL(options.resource);
  const challenge = {
    requiredScopes: [...options.requiredScopes],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceUrl),
  };
  const bearer = requireBearerAuth({
    verifier: createVerifier(options),
    expectedResource: resourceUrl,
    ...challenge,
  });
  const document = {
    resource: options.resource,
    authorization_servers: [options.issuer],
    scopes_supported: challenge.requiredScopes,
    bearer_methods_supported: ['header'],
  };

  return {
    gate(request) {
      // The SDK has no code for a missing token, so that case is answered here.
      if (!/^bearer\s+\S/i.test(request.headers.get('authorization') ?? '')) {
        return Promise.resolve(
          bearerAuthChallengeResponse(
            authError(
              'auth.token-missing',
              'A Bearer access token is required.',
            ),
            challenge,
          ),
        );
      }
      return bearer(request);
    },
    metadata(request) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(null, {
          status: 405,
          headers: { Allow: 'GET, HEAD' },
        });
      }
      return Response.json(document, {
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    },
  };
}
