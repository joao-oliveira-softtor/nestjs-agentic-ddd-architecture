import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SignJWT } from 'jose';
import type { AuthInfo } from '../src/auth/resource-server';
import { createResourceServer } from '../src/auth/resource-server';
import {
  type Signer,
  type TestAuthServer,
  makeSigner,
  startAuthServer,
} from './helpers/auth-server';

const RESOURCE = 'https://mcp.example.test/mcp';
const SCOPE = 'domain:read';

interface Claims {
  iss?: string;
  aud?: string | string[];
  scope?: string;
  exp?: number;
}

async function mint(signer: Signer, issuer: string, claims: Claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ scope: claims.scope ?? SCOPE, client_id: 'client-1' })
    .setProtectedHeader({ alg: signer.alg, kid: signer.kid })
    .setIssuer(claims.iss ?? issuer)
    .setAudience(claims.aud ?? RESOURCE)
    .setIssuedAt(now)
    .setExpirationTime(claims.exp ?? now + 300)
    .sign(signer.privateKey);
}

const bearer = (token?: string) =>
  new Request(RESOURCE, {
    method: 'POST',
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });

async function expectChallenge(
  result: Response | AuthInfo,
  status: number,
  code: string,
) {
  expect(result).toBeInstanceOf(Response);
  const response = result as Response;
  expect(response.status).toBe(status);
  const header = response.headers.get('www-authenticate') ?? '';
  expect(header).toContain(
    'resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp"',
  );
  const body = (await response.json()) as { error_description: string };
  expect(body.error_description).toStartWith(`${code}:`);
  return { header, body };
}

describe('resource server', () => {
  let rsa: Signer;
  let ec: Signer;
  let auth: TestAuthServer;
  let oidc: TestAuthServer;
  let resourceServer: ReturnType<typeof createResourceServer>;
  const gate = (request: Request) => resourceServer.gate(request);

  beforeAll(async () => {
    rsa = await makeSigner('RS256', 'rsa-1');
    ec = await makeSigner('ES256', 'ec-1');
    auth = startAuthServer('oauth');
    auth.published.push(rsa.jwk, ec.jwk);
    oidc = startAuthServer('oidc');
    oidc.published.push(rsa.jwk);
    resourceServer = createResourceServer({
      issuer: auth.issuer,
      resource: RESOURCE,
      requiredScopes: [SCOPE],
    });
  });

  afterAll(() => {
    auth.stop();
    oidc.stop();
  });

  test('a valid RS256 token passes and maps scopes, resource and expiry', async () => {
    const exp = Math.floor(Date.now() / 1000) + 300;
    const result = await gate(
      bearer(await mint(rsa, auth.issuer, { exp, scope: `${SCOPE} other` })),
    );
    expect(result).not.toBeInstanceOf(Response);
    const info = result as AuthInfo;
    expect(info.scopes).toEqual([SCOPE, 'other']);
    expect(info.resource?.href).toBe(RESOURCE);
    expect(info.expiresAt).toBe(exp);
    expect(info.clientId).toBe('client-1');
  });

  test('a valid ES256 token passes', async () => {
    const result = await gate(bearer(await mint(ec, auth.issuer)));
    expect(result).not.toBeInstanceOf(Response);
  });

  test('a missing token is a 401 auth.token-missing with the metadata challenge', async () => {
    const { header } = await expectChallenge(
      await gate(bearer()),
      401,
      'auth.token-missing',
    );
    expect(header).toStartWith('Bearer ');
  });

  test('a wrong audience is auth.audience-mismatch', async () => {
    const token = await mint(rsa, auth.issuer, { aud: 'https://other.test/' });
    await expectChallenge(
      await gate(bearer(token)),
      401,
      'auth.audience-mismatch',
    );
  });

  test('a wrong issuer is auth.issuer-mismatch', async () => {
    const token = await mint(rsa, auth.issuer, { iss: 'https://evil.test' });
    await expectChallenge(
      await gate(bearer(token)),
      401,
      'auth.issuer-mismatch',
    );
  });

  test('an expired token is auth.token-expired', async () => {
    const exp = Math.floor(Date.now() / 1000) - 60;
    const token = await mint(rsa, auth.issuer, { exp });
    await expectChallenge(await gate(bearer(token)), 401, 'auth.token-expired');
  });

  test('an unsigned alg none token is auth.token-invalid', async () => {
    const b64 = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const token = `${b64({ alg: 'none', kid: rsa.kid })}.${b64({
      iss: auth.issuer,
      aud: RESOURCE,
      scope: SCOPE,
      exp: now + 300,
    })}.`;
    await expectChallenge(await gate(bearer(token)), 401, 'auth.token-invalid');
  });

  test('an HS256 token signed with the public key as secret is auth.token-invalid', async () => {
    const secret = new TextEncoder().encode(JSON.stringify(rsa.jwk));
    const token = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: 'HS256', kid: rsa.kid })
      .setIssuer(auth.issuer)
      .setAudience(RESOURCE)
      .setExpirationTime('5m')
      .sign(secret);
    await expectChallenge(await gate(bearer(token)), 401, 'auth.token-invalid');
  });

  test('a token with a tampered payload is auth.token-invalid', async () => {
    const [head, , signature] = (await mint(rsa, auth.issuer)).split('.');
    const forged = Buffer.from(
      JSON.stringify({
        iss: auth.issuer,
        aud: RESOURCE,
        scope: 'admin',
        exp: 4e9,
      }),
    ).toString('base64url');
    await expectChallenge(
      await gate(bearer(`${head}.${forged}.${signature}`)),
      401,
      'auth.token-invalid',
    );
  });

  test('a missing scope is a 403 insufficient_scope with auth.scope-missing', async () => {
    const token = await mint(rsa, auth.issuer, { scope: 'unrelated' });
    const { header, body } = await expectChallenge(
      await gate(bearer(token)),
      403,
      'auth.scope-missing',
    );
    expect(header).toContain('error="insufficient_scope"');
    expect(header).toContain(`scope="${SCOPE}"`);
    expect(JSON.stringify(body)).not.toContain(auth.issuer);
  });

  test('errors never leak the JWKS url or stack traces', async () => {
    const token = await mint(rsa, auth.issuer, { aud: 'https://other.test/' });
    const response = (await gate(bearer(token))) as Response;
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain('jwks');
    expect(text).not.toContain(' at ');
  });

  describe('key rotation', () => {
    test('a kid published after the first success verifies once the cooldown allows a refetch', async () => {
      const server = startAuthServer('oauth');
      server.published.push(rsa.jwk);
      const rotating = createResourceServer({
        issuer: server.issuer,
        resource: RESOURCE,
        requiredScopes: [SCOPE],
        jwksCooldownMs: 0,
      });
      try {
        expect(
          await rotating.gate(bearer(await mint(rsa, server.issuer))),
        ).not.toBeInstanceOf(Response);
        const rotated = await makeSigner('RS256', 'rsa-2');
        server.published.push(rotated.jwk);
        expect(
          await rotating.gate(bearer(await mint(rotated, server.issuer))),
        ).not.toBeInstanceOf(Response);
      } finally {
        server.stop();
      }
    });

    test('a kid that is never published is auth.token-invalid', async () => {
      const server = startAuthServer('oauth');
      server.published.push(rsa.jwk);
      const rotating = createResourceServer({
        issuer: server.issuer,
        resource: RESOURCE,
        requiredScopes: [SCOPE],
        jwksCooldownMs: 0,
      });
      try {
        const ghost = await makeSigner('RS256', 'ghost');
        await expectChallenge(
          await rotating.gate(bearer(await mint(ghost, server.issuer))),
          401,
          'auth.token-invalid',
        );
      } finally {
        server.stop();
      }
    });
  });

  describe('discovery', () => {
    test('an explicit jwksUri skips discovery', async () => {
      const server = startAuthServer('oauth');
      server.published.push(rsa.jwk);
      const explicit = createResourceServer({
        issuer: server.issuer,
        jwksUri: `${server.issuer}/jwks.json`,
        resource: RESOURCE,
        requiredScopes: [SCOPE],
      });
      try {
        expect(
          await explicit.gate(bearer(await mint(rsa, server.issuer))),
        ).not.toBeInstanceOf(Response);
        expect(server.hits.discovery).toBe(0);
        expect(server.hits.jwks).toBe(1);
      } finally {
        server.stop();
      }
    });

    test('discovery falls back to OIDC and happens once', async () => {
      const oidcServer = createResourceServer({
        issuer: oidc.issuer,
        resource: RESOURCE,
        requiredScopes: [SCOPE],
      });
      const bearerOidc = (request: Request) => oidcServer.gate(request);
      const token = await mint(rsa, oidc.issuer);
      expect(await bearerOidc(bearer(token))).not.toBeInstanceOf(Response);
      expect(await bearerOidc(bearer(token))).not.toBeInstanceOf(Response);
      expect(oidc.hits.discovery).toBe(1);
    });

    test('a discovery document for another issuer is rejected without a token verdict', async () => {
      const server = startAuthServer('oauth');
      server.published.push(rsa.jwk);
      const mismatched = createResourceServer({
        issuer: `${server.issuer}/`, // differs from the document's issuer
        resource: RESOURCE,
        requiredScopes: [SCOPE],
      });
      try {
        const result = await mismatched.gate(
          bearer(await mint(rsa, `${server.issuer}/`)),
        );
        expect((result as Response).status).toBe(500);
        expect(server.hits.jwks).toBe(0);
      } finally {
        server.stop();
      }
    });
  });

  describe('protected resource metadata', () => {
    test('points at the issuer and advertises the scopes', async () => {
      const server = createResourceServer({
        issuer: auth.issuer,
        resource: RESOURCE,
        requiredScopes: [SCOPE],
      });
      const response = server.metadata(
        new Request(
          'https://mcp.example.test/.well-known/oauth-protected-resource/mcp',
        ),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        resource: RESOURCE,
        authorization_servers: [auth.issuer],
        scopes_supported: [SCOPE],
        bearer_methods_supported: ['header'],
      });
    });
  });
});
