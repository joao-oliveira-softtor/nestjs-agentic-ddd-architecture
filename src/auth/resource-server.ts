// OAuth 2.1 resource-server gate: verifies JWT access tokens against the issuer's JWKS and
// answers RFC 9728 metadata. It knows nothing about MCP tools, so a Runtime MCP can reuse it.
import {
  type AuthInfo,
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
  bearerAuthChallengeResponse,
  getOAuthProtectedResourceMetadataUrl,
  verifyBearerToken,
} from '@modelcontextprotocol/server';
import {
  type JWTPayload,
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
// RFC 8414 inserts the well-known segment before the issuer path; OIDC appends it.
function discoveryUrls(issuer: string): string[] {
  const { origin, pathname } = new URL(issuer);
  const path = pathname.replace(/\/+$/, '');
  return [
    `${origin}/.well-known/oauth-authorization-server${path}`,
    `${origin}${path}/.well-known/openid-configuration`,
  ];
}
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

// `https://h/mcp` and `https://h/mcp/` are one resource; a bare `/` path has no other form.
function audiences(resource: string): string[] {
  if (new URL(resource).pathname === '/') return [resource];
  const bare = resource.replace(/\/$/, '');
  return [bare, `${bare}/`];
}

// Space-separated `scope` plus `scp` (string or array, Azure/Entra/Okta style), deduplicated.
function tokenScopes(payload: JWTPayload): string[] {
  const parts = [payload.scope, payload.scp].flatMap((claim) =>
    Array.isArray(claim) ? claim : [claim],
  );
  const scopes = parts.flatMap((part) =>
    typeof part === 'string' ? part.split(' ').filter(Boolean) : [],
  );
  return [...new Set(scopes)];
}

// The SDK's own refusals carry no code; give each one ours so every answer is coded.
function withCode(error: unknown): unknown {
  if (!(error instanceof OAuthError) || error.message.startsWith('auth.')) {
    return error;
  }
  if (error.code === OAuthErrorCode.InsufficientScope) {
    return authError(
      'auth.scope-missing',
      'The token lacks a required scope.',
      OAuthErrorCode.InsufficientScope,
    );
  }
  if (error.code !== OAuthErrorCode.InvalidToken) return error;
  if (/resource/i.test(error.message)) {
    return authError(
      'auth.audience-mismatch',
      'The token is not for this resource.',
    );
  }
  if (/expired/i.test(error.message)) {
    return authError('auth.token-expired', 'The access token has expired.');
  }
  return authError(
    'auth.token-invalid',
    'The access token failed verification.',
  );
}

async function discoverJwksUri(issuer: string): Promise<string> {
  for (const url of discoveryUrls(issuer)) {
    try {
      const res = await fetch(url, {
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
  const { issuer, resource } = options;
  const audience = audiences(resource);
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
          audience,
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
        // failures (JWKS fetch/discovery: timeout, non-200, bad JSON) propagate and become a
        // bare 500; jose raises those as a plain JOSEError or JWKSInvalid.
        if (
          error instanceof errors.JOSEError &&
          error.code !== 'ERR_JOSE_GENERIC' &&
          !(error instanceof errors.JWKSTimeout) &&
          !(error instanceof errors.JWKSInvalid)
        ) {
          throw authError(
            'auth.token-invalid',
            'The access token failed verification.',
          );
        }
        throw error;
      }
      if (typeof payload.exp !== 'number') {
        throw authError(
          'auth.token-invalid',
          'The access token has no expiration time.',
        );
      }
      const clientId = payload.client_id ?? payload.azp ?? payload.sub;
      return {
        token,
        clientId: typeof clientId === 'string' ? clientId : '',
        scopes: tokenScopes(payload),
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
  // Scopes are checked once, by the SDK, against the verifier's AuthInfo.
  const verification = {
    verifier: createVerifier(options),
    expectedResource: resourceUrl,
    ...challenge,
  };
  const document = {
    resource: options.resource,
    authorization_servers: [options.issuer],
    scopes_supported: challenge.requiredScopes,
    bearer_methods_supported: ['header'],
  };

  return {
    async gate(request) {
      // Same cut as the SDK (first comma, single space), so a header it would refuse for
      // format is answered here with our code.
      const [header = ''] = (request.headers.get('authorization') ?? '').split(
        ',',
      );
      try {
        if (!/^bearer [^ ]/i.test(header)) {
          throw authError(
            'auth.token-missing',
            'A Bearer access token is required.',
          );
        }
        return await verifyBearerToken(header, verification);
      } catch (error) {
        return bearerAuthChallengeResponse(withCode(error), challenge);
      }
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
