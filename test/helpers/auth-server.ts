import { type JWK, type KeyObject, exportJWK, generateKeyPair } from 'jose';

export interface Signer {
  readonly alg: 'RS256' | 'ES256';
  readonly kid: string;
  readonly privateKey: CryptoKey | KeyObject;
  readonly jwk: JWK;
}

export async function makeSigner(
  alg: Signer['alg'],
  kid: string,
): Promise<Signer> {
  const { publicKey, privateKey } = await generateKeyPair(alg, {
    extractable: true,
  });
  return {
    alg,
    kid,
    privateKey,
    jwk: { ...(await exportJWK(publicKey)), kid, alg, use: 'sig' },
  };
}

export interface TestAuthServer {
  readonly issuer: string;
  readonly published: JWK[];
  readonly hits: { discovery: number; jwks: number };
  stop(): void;
}

// A local authorization server: discovery document (RFC 8414 or OIDC only) plus the JWKS.
export function startAuthServer(discovery: 'oauth' | 'oidc'): TestAuthServer {
  const published: JWK[] = [];
  const hits = { discovery: 0, jwks: 0 };
  const wellKnown =
    discovery === 'oauth'
      ? '/.well-known/oauth-authorization-server'
      : '/.well-known/openid-configuration';
  const server: ReturnType<typeof Bun.serve> = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request): Response {
      const { pathname } = new URL(request.url);
      const issuer: string = `http://127.0.0.1:${server.port}`;
      if (pathname === wellKnown) {
        hits.discovery++;
        return Response.json({ issuer, jwks_uri: `${issuer}/jwks.json` });
      }
      if (pathname === '/jwks.json') {
        hits.jwks++;
        return Response.json({ keys: published });
      }
      return new Response('not found', { status: 404 });
    },
  });
  return {
    issuer: `http://127.0.0.1:${server.port}`,
    published,
    hits,
    stop: () => void server.stop(true),
  };
}
