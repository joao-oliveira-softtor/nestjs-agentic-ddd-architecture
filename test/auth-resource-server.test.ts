import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
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
  scope?: string | null; // null omits the claim
  scp?: string | string[];
  exp?: number | null; // null omits the claim
  nbf?: number;
}

async function mint(signer: Signer, issuer: string, claims: Claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({
    client_id: 'client-1',
    ...(claims.scope !== null && { scope: claims.scope ?? SCOPE }),
    ...(claims.scp !== undefined && { scp: claims.scp }),
  })
    .setProtectedHeader({ alg: signer.alg, kid: signer.kid })
    .setIssuer(claims.iss ?? issuer)
    .setAudience(claims.aud ?? RESOURCE)
    .setIssuedAt(now);
  if (claims.exp !== null) jwt.setExpirationTime(claims.exp ?? now + 300);
  if (claims.nbf !== undefined) jwt.setNotBefore(claims.nbf);
  return jwt.sign(signer.privateKey);
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

  test('a token that expired one second ago is refused despite the clock tolerance', async () => {
    const exp = Math.floor(Date.now() / 1000) - 1;
    const token = await mint(rsa, auth.issuer, { exp });
    await expectChallenge(await gate(bearer(token)), 401, 'auth.token-expired');
  });

  test('the injected clock decides expiry, not the wall clock', async () => {
    const exp = Math.floor(Date.now() / 1000) + 300;
    const token = await mint(rsa, auth.issuer, { exp });
    const late = createResourceServer({
      issuer: auth.issuer,
      resource: RESOURCE,
      requiredScopes: [SCOPE],
      now: () => (exp + 60) * 1000,
    });
    await expectChallenge(
      await late.gate(bearer(token)),
      401,
      'auth.token-expired',
    );
  });

  test('a token whose nbf is two seconds ahead is accepted within the tolerance', async () => {
    const nbf = Math.floor(Date.now() / 1000) + 2;
    const token = await mint(rsa, auth.issuer, { nbf });
    expect(await gate(bearer(token))).not.toBeInstanceOf(Response);
  });

  describe('algorithm allowlist', () => {
    const own = (server: TestAuthServer) =>
      createResourceServer({
        issuer: server.issuer,
        resource: RESOURCE,
        requiredScopes: [SCOPE],
      });

    for (const alg of ['PS256', 'ES384', 'EdDSA'] as const) {
      test(`a valid ${alg} token passes end to end`, async () => {
        const signer = await makeSigner(alg, `${alg}-1`);
        const server = startAuthServer('oauth');
        server.published.push(signer.jwk);
        try {
          expect(
            await own(server).gate(bearer(await mint(signer, server.issuer))),
          ).not.toBeInstanceOf(Response);
        } finally {
          server.stop();
        }
      });
    }

    for (const alg of ['RS384', 'ES512'] as const) {
      test(`a ${alg} token is auth.token-invalid before any fetch`, async () => {
        const signer = await makeSigner(alg, `${alg}-1`);
        const server = startAuthServer('oauth');
        server.published.push(signer.jwk);
        try {
          await expectChallenge(
            await own(server).gate(bearer(await mint(signer, server.issuer))),
            401,
            'auth.token-invalid',
          );
          expect({ ...server.hits }).toEqual({ discovery: 0, jwks: 0 });
        } finally {
          server.stop();
        }
      });
    }
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

  test('a module-suffixed scope passes the gate and keeps the raw scope', async () => {
    const token = await mint(rsa, auth.issuer, { scope: `${SCOPE}:orders` });
    const result = await gate(bearer(token));
    expect(result).not.toBeInstanceOf(Response);
    expect((result as AuthInfo).scopes).toEqual([`${SCOPE}:orders`]);
  });

  test.each([`${SCOPE}x`, `${SCOPE}:`, `other:${SCOPE}`])(
    'the near-miss scope %p is a 403 auth.scope-missing',
    async (scope) => {
      const token = await mint(rsa, auth.issuer, { scope });
      const { header } = await expectChallenge(
        await gate(bearer(token)),
        403,
        'auth.scope-missing',
      );
      expect(header).toContain('error="insufficient_scope"');
      expect(header).toContain(`scope="${SCOPE}"`);
    },
  );

  test('a header with two spaces after Bearer is a 401 auth.token-missing', async () => {
    const request = new Request(RESOURCE, {
      method: 'POST',
      headers: { authorization: 'Bearer  tok' },
    });
    await expectChallenge(await gate(request), 401, 'auth.token-missing');
  });

  test('a token without exp is a 401 auth.token-invalid', async () => {
    const token = await mint(rsa, auth.issuer, { exp: null });
    await expectChallenge(await gate(bearer(token)), 401, 'auth.token-invalid');
  });

  describe('scope claims', () => {
    const scopesOf = async (claims: Claims) =>
      ((await gate(bearer(await mint(rsa, auth.issuer, claims)))) as AuthInfo)
        .scopes;

    test('reads the scope string', async () => {
      expect(await scopesOf({ scope: `${SCOPE} a` })).toEqual([SCOPE, 'a']);
    });

    test('reads scp as an array and ignores non-string entries', async () => {
      expect(
        await scopesOf({
          scope: null,
          scp: [SCOPE, 'b', 7 as unknown as string],
        }),
      ).toEqual([SCOPE, 'b']);
    });

    test('reads scp as a space-separated string', async () => {
      expect(await scopesOf({ scope: null, scp: `${SCOPE} c` })).toEqual([
        SCOPE,
        'c',
      ]);
    });

    test('unions scope and scp without duplicates', async () => {
      expect(
        await scopesOf({ scope: `${SCOPE} a`, scp: [SCOPE, 'b'] }),
      ).toEqual([SCOPE, 'a', 'b']);
    });

    test('no scope claims is a 403 auth.scope-missing', async () => {
      const token = await mint(rsa, auth.issuer, { scope: null });
      await expectChallenge(
        await gate(bearer(token)),
        403,
        'auth.scope-missing',
      );
    });
  });

  describe('trailing slash on the resource', () => {
    const make = (resource: string) =>
      createResourceServer({
        issuer: auth.issuer,
        resource,
        requiredScopes: [SCOPE],
      });

    test('a configured slash accepts an aud without it', async () => {
      const server = make(`${RESOURCE}/`);
      const token = await mint(rsa, auth.issuer, { aud: RESOURCE });
      expect(await server.gate(bearer(token))).not.toBeInstanceOf(Response);
    });

    test('a configured resource without slash accepts an aud with it', async () => {
      const token = await mint(rsa, auth.issuer, { aud: `${RESOURCE}/` });
      expect(await gate(bearer(token))).not.toBeInstanceOf(Response);
    });

    test('a bare-origin resource accepts an aud with or without the slash', async () => {
      const server = make('https://mcp.example.test');
      for (const aud of [
        'https://mcp.example.test',
        'https://mcp.example.test/',
      ]) {
        const token = await mint(rsa, auth.issuer, { aud });
        expect(await server.gate(bearer(token))).not.toBeInstanceOf(Response);
      }
    });

    test('a different path is still refused', async () => {
      const server = make(`${RESOURCE}/`);
      const token = await mint(rsa, auth.issuer, { aud: `${RESOURCE}x` });
      const response = (await server.gate(bearer(token))) as Response;
      expect(response.status).toBe(401);
    });

    test('the metadata document advertises the resource as configured', async () => {
      const response = make(`${RESOURCE}/`).metadata(new Request(RESOURCE));
      expect(((await response.json()) as { resource: string }).resource).toBe(
        `${RESOURCE}/`,
      );
    });
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

    test('an unknown kid before any success does not block a later valid token', async () => {
      const server = startAuthServer('oauth');
      server.published.push(rsa.jwk);
      const fresh = createResourceServer({
        issuer: server.issuer,
        resource: RESOURCE,
        requiredScopes: [SCOPE],
      });
      try {
        const ghost = await makeSigner('RS256', 'ghost');
        await expectChallenge(
          await fresh.gate(bearer(await mint(ghost, server.issuer))),
          401,
          'auth.token-invalid',
        );
        expect(
          await fresh.gate(bearer(await mint(rsa, server.issuer))),
        ).not.toBeInstanceOf(Response);
      } finally {
        server.stop();
      }
    });

    test('a token selecting a key jose cannot import does not block a later valid token', async () => {
      const server = startAuthServer('oauth');
      server.published.push(rsa.jwk, {
        kty: 'RSA',
        kid: 'broken',
        alg: 'RS256',
        use: 'sig',
        e: 'AQAB',
      });
      const fresh = createResourceServer({
        issuer: server.issuer,
        resource: RESOURCE,
        requiredScopes: [SCOPE],
      });
      try {
        const broken = await mint({ ...rsa, kid: 'broken' }, server.issuer);
        expect(((await fresh.gate(bearer(broken))) as Response).status).toBe(
          500,
        );
        expect(
          await fresh.gate(bearer(await mint(rsa, server.issuer))),
        ).not.toBeInstanceOf(Response);
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

    test('a failed discovery is remembered for the window, then retried', async () => {
      const server = startAuthServer('oauth', { discoveryStatus: 500 });
      let now = 1_000_000;
      const down = createResourceServer({
        issuer: server.issuer,
        resource: RESOURCE,
        requiredScopes: [SCOPE],
        now: () => now,
      });
      try {
        const token = await mint(rsa, server.issuer);
        expect(((await down.gate(bearer(token))) as Response).status).toBe(500);
        now += 29_000;
        expect(((await down.gate(bearer(token))) as Response).status).toBe(500);
        expect(server.hits.discovery).toBe(1);
        now += 2_000;
        expect(((await down.gate(bearer(token))) as Response).status).toBe(500);
        expect(server.hits.discovery).toBe(2);
      } finally {
        server.stop();
      }
    });

    test('an unreachable explicit jwks is remembered for the window too', async () => {
      const server = startAuthServer('oauth', { jwksStatus: 500 });
      let now = 1_000_000;
      const down = createResourceServer({
        issuer: server.issuer,
        jwksUri: `${server.issuer}/jwks.json`,
        resource: RESOURCE,
        requiredScopes: [SCOPE],
        now: () => now,
      });
      try {
        const token = await mint(rsa, server.issuer);
        expect(((await down.gate(bearer(token))) as Response).status).toBe(500);
        expect(((await down.gate(bearer(token))) as Response).status).toBe(500);
        expect(server.hits.jwks).toBe(1);
        now += 31_000;
        await down.gate(bearer(token));
        expect(server.hits.jwks).toBe(2);
      } finally {
        server.stop();
      }
    });

    test('an unreachable explicit jwks is not reconnected inside the window', async () => {
      const closed = startAuthServer('oauth');
      const issuer = closed.issuer;
      closed.stop();
      let now = 1_000_000;
      const down = createResourceServer({
        issuer,
        jwksUri: `${issuer}/jwks.json`,
        resource: RESOURCE,
        requiredScopes: [SCOPE],
        now: () => now,
      });
      const connects = spyOn(globalThis, 'fetch');
      try {
        const token = await mint(rsa, issuer);
        const attempts = () =>
          connects.mock.calls.filter(([input]) =>
            String(input instanceof Request ? input.url : input).startsWith(
              issuer,
            ),
          ).length;
        expect(((await down.gate(bearer(token))) as Response).status).toBe(500);
        expect(((await down.gate(bearer(token))) as Response).status).toBe(500);
        expect(attempts()).toBe(1);
        now += 31_000;
        expect(((await down.gate(bearer(token))) as Response).status).toBe(500);
        expect(attempts()).toBe(2);
      } finally {
        connects.mockRestore();
      }
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

    test('a discovered jwks_uri over plain http off loopback is refused before any fetch', async () => {
      const server = startAuthServer('oauth', {
        jwksUri: 'http://example.com/jwks',
      });
      const urlOf = (input: RequestInfo | URL) =>
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const realFetch = globalThis.fetch;
      const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(((
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        if (urlOf(input).includes('example.com'))
          return Promise.reject(new Error('blocked by test'));
        return realFetch(input, init);
      }) as typeof fetch);
      try {
        const hostile = createResourceServer({
          issuer: server.issuer,
          resource: RESOURCE,
          requiredScopes: [SCOPE],
        });
        const result = await hostile.gate(
          bearer(await mint(rsa, server.issuer)),
        );
        expect((result as Response).status).toBe(500);
        expect(
          fetchSpy.mock.calls.some(([input]) =>
            urlOf(input).includes('example.com'),
          ),
        ).toBe(false);
        expect(server.hits.jwks).toBe(0);
      } finally {
        fetchSpy.mockRestore();
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

  describe('anyOfScopes', () => {
    const either = () =>
      createResourceServer({
        issuer: auth.issuer,
        resource: RESOURCE,
        requiredScopes: [],
        anyOfScopes: [SCOPE, 'skill:read'],
      });

    test.each([SCOPE, 'skill:read', 'skill:read:orders', `${SCOPE}:orders`])(
      'a token granting %p passes',
      async (scope) => {
        const result = await either().gate(
          bearer(await mint(rsa, auth.issuer, { scope })),
        );
        expect(result).not.toBeInstanceOf(Response);
      },
    );

    test('a token granting neither is a 403 auth.scope-missing', async () => {
      await expectChallenge(
        await either().gate(
          bearer(await mint(rsa, auth.issuer, { scope: 'other' })),
        ),
        403,
        'auth.scope-missing',
      );
    });

    test('an empty list is no constraint', async () => {
      const server = createResourceServer({
        issuer: auth.issuer,
        resource: RESOURCE,
        requiredScopes: [],
        anyOfScopes: [],
      });
      const result = await server.gate(
        bearer(await mint(rsa, auth.issuer, { scope: 'other' })),
      );
      expect(result).not.toBeInstanceOf(Response);
    });

    test('requiredScopes still all apply and the metadata lists the union', async () => {
      const server = createResourceServer({
        issuer: auth.issuer,
        resource: RESOURCE,
        requiredScopes: ['base'],
        anyOfScopes: [SCOPE, 'skill:read'],
      });
      await expectChallenge(
        await server.gate(
          bearer(await mint(rsa, auth.issuer, { scope: 'skill:read' })),
        ),
        403,
        'auth.scope-missing',
      );
      const document = (await server
        .metadata(new Request(RESOURCE))
        .json()) as { scopes_supported: string[] };
      expect(document.scopes_supported).toEqual(['base', SCOPE, 'skill:read']);
    });
  });
});
