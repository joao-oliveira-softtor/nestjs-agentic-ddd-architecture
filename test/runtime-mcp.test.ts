import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BunAdapter } from '@nestbun/platform';
import { SignJWT } from 'jose';
import type { UseCaseContext } from '@agentic-ddd/core';
import { AgenticModule, AgenticHttpModule } from '@agentic-ddd/nestjs';
import {
  FakeApproval,
  FakeLlm,
  type LlmScriptEntry,
} from '@agentic-ddd/testing';
import { Changed, fixture } from './helpers/runtime';
import {
  makeSigner,
  startAuthServer,
  type Signer,
  type TestAuthServer,
} from './helpers/auth-server';

const resource = 'https://runtime.example/mcp';
const host = 'runtime.example';
const metadata = '/.well-known/oauth-protected-resource/mcp';
const capability = 'operator:run:agent';
let auth: TestAuthServer;
let signer: Signer;
let app: INestApplication;
let base: string;
beforeAll(async () => {
  signer = await makeSigner('ES256', 'runtime-test');
  auth = startAuthServer('oauth');
  auth.published.push(signer.jwk);
});
afterEach(async () => {
  await app?.close();
});
afterAll(() => auth.stop());

async function token(scope = capability, sub = 'alice', aud = resource) {
  return new SignJWT({ scope })
    .setSubject(sub)
    .setIssuer(auth.issuer)
    .setAudience(aud)
    .setExpirationTime('5m')
    .setProtectedHeader({ alg: signer.alg, kid: signer.kid })
    .sign(signer.privateKey);
}

async function start(
  script: LlmScriptEntry[] = [],
  options: {
    http?: boolean;
    allowlist?: string[];
    approvalRequired?: boolean;
    approval?: FakeApproval;
    includeEvents?: boolean;
    timeoutMs?: number;
    resolverError?: Error;
  } = {},
) {
  const f = fixture();
  const op = f.registry.operators[0]!;
  if (options.approvalRequired || options.timeoutMs) {
    f.registry.operators[0] = {
      ...op,
      requiresApproval: options.approvalRequired ? [f.Tool] : [],
      limits: {
        ...op.limits,
        timeoutMs: options.timeoutMs ?? op.limits.timeoutMs,
      },
    };
    f.compileSkill();
  }
  const llm = new FakeLlm(script);
  const calls: unknown[] = [];
  const claimsSeen: Readonly<Record<string, unknown>>[] = [];
  const module = await Test.createTestingModule({
    imports: [
      AgenticModule.forRoot({ ...f, llm, approval: options.approval }),
      AgenticModule.forFeature({
        operators: [f.Agent],
        useCases: [
          {
            provide: f.Tool,
            useValue: {
              async execute(input: unknown, ctx: UseCaseContext) {
                calls.push(input);
                await ctx.publish([new Changed(input)]);
                return input;
              },
            },
          },
        ],
      }),
      ...(options.http === false
        ? []
        : [
            AgenticHttpModule.forRoot({
              issuer: auth.issuer,
              resource,
              operatorAllowlist: options.allowlist ?? ['agent'],
              includeEvents: options.includeEvents,
              resolveContext: async (claims) => {
                claimsSeen.push(claims);
                if (options.resolverError) throw options.resolverError;
                return { userId: claims.sub };
              },
            }),
          ]),
    ],
  }).compile();
  app = module.createNestApplication(new BunAdapter({ bodyLimit: '8kb' }));
  app.setGlobalPrefix('api', {
    exclude: ['mcp', '.well-known/oauth-protected-resource/mcp'],
  });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  return { llm, calls, claimsSeen };
}

function postBody(
  message: object,
  bearer?: string,
  extra: Record<string, string> = {},
) {
  return fetch(base + '/mcp', {
    method: 'POST',
    headers: {
      host,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...(bearer && { authorization: 'Bearer ' + bearer }),
      ...extra,
    },
    body: JSON.stringify(message),
  });
}
function post(
  method: string,
  params: object,
  bearer?: string,
  extra?: Record<string, string>,
) {
  return postBody({ jsonrpc: '2.0', id: 1, method, params }, bearer, extra);
}
function modern(
  method: string,
  params: Record<string, unknown>,
  bearer: string,
) {
  const version = '2026-07-28';
  return post(
    method,
    {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': version,
        'io.modelcontextprotocol/clientCapabilities': {},
        'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
      },
    },
    bearer,
    {
      'mcp-protocol-version': version,
      'mcp-method': method,
      ...(typeof params.name === 'string' && { 'mcp-name': params.name }),
    },
  );
}
async function readReply(response: Response) {
  expect(response.status).toBe(200);
  const data = await response.text();
  const sse = data.split('\n').find((line) => line.startsWith('data:'));
  return JSON.parse(sse ? sse.slice(5) : data);
}
const rpc = async (method: string, params: object, bearer: string) =>
  readReply(await post(method, params, bearer));
const call = (
  bearer: string,
  name = 'agent',
  args: Record<string, unknown> = { message: 'hello' },
) => rpc('tools/call', { name, arguments: args }, bearer);

test('Nest exposes the runtime and metadata routes only when imported', async () => {
  await start([], { http: false });
  expect((await post('tools/list', {})).status).toBe(404);
  expect((await fetch(base + metadata, { headers: { host } })).status).toBe(
    404,
  );
});

test('metadata, OAuth challenges, authority checks and body limits survive the Nest adapter', async () => {
  const { llm } = await start();
  const doc = await fetch(base + metadata, { headers: { host } });
  expect(doc.status).toBe(200);
  expect(await doc.json()).toMatchObject({
    resource,
    authorization_servers: [auth.issuer],
    scopes_supported: [capability],
  });
  for (const bearer of [
    undefined,
    'invalid',
    await token(capability, 'alice', 'https://other.example/mcp'),
  ]) {
    const response = await post('tools/list', {}, bearer);
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain(
      'https://runtime.example' + metadata,
    );
  }
  for (const headers of [
    { host: 'other.example', 'x-forwarded-host': host },
    { origin: 'https://other.example' },
  ] as Record<string, string>[]) {
    expect((await post('tools/list', {}, undefined, headers)).status).toBe(403);
    expect(
      (await fetch(base + metadata, { headers: { host, ...headers } })).status,
    ).toBe(403);
  }
  const valid = await token();
  const stream = await post('tools/list', {}, valid, {
    origin: 'https://' + host,
  });
  expect(stream.status).toBe(200);
  expect(stream.headers.get('content-type')).toContain('text/event-stream');
  expect(await stream.text()).toContain('data:');
  expect(
    (
      await post(
        'tools/call',
        { name: 'agent', arguments: { message: 'x'.repeat(10000) } },
        valid,
      )
    ).status,
  ).toBe(413);
  expect(llm.requests).toHaveLength(0);
});

test('list and call apply identical per-request operator and module scopes', async () => {
  await start();
  const scoped = await token(capability + ':app');
  const other = await token(capability + ':other');
  const absent = (await call(scoped, 'unknown')).error;
  expect(absent.code).toBeLessThan(0);
  for (const [bearer, names] of [
    [scoped, ['agent']],
    [other, []],
    [await token(), ['agent']],
    [await token('domain:read'), []],
  ] as const) {
    const list = (await rpc('tools/list', {}, bearer)).result.tools;
    expect(list.map((tool: { name: string }) => tool.name)).toEqual(names);
    if (!names.length) expect((await call(bearer)).error).toEqual(absent);
  }
  await app.close();
  await start([], { allowlist: [] });
  expect((await rpc('tools/list', {}, scoped)).result.tools).toEqual([]);
  expect((await call(scoped)).error).toEqual(absent);
});

test('only a nonempty message reaches the resolver and operator', async () => {
  const { llm, claimsSeen } = await start();
  const bearer = await token();
  for (const args of [
    {},
    { message: 7 },
    { message: '' },
    { message: '  ' },
    ...[
      'context',
      'approval',
      'approvals',
      'allowlist',
      'policy',
      'includeEvents',
    ].map((key) => ({ message: 'hello', [key]: {} })),
  ]) {
    expect((await call(bearer, 'agent', args)).error.code).toBe(-32602);
  }
  expect(llm.requests).toHaveLength(0);
  expect(claimsSeen).toHaveLength(0);
});

const done: LlmScriptEntry = {
  stopReason: 'end',
  content: [{ type: 'text', text: 'done' }],
};
const toolCall: LlmScriptEntry = {
  stopReason: 'tool_calls',
  content: [
    { type: 'tool_call', name: 'tool', id: 't', input: { value: 'ok' } },
  ],
};

for (const protocol of ['legacy', 'modern'])
  test(`concurrent ${protocol} calls resolve only their own claims and hide request traces`, async () => {
    const finish: LlmScriptEntry = (req) => ({
      stopReason: 'end',
      content: [{ type: 'text', text: JSON.stringify(req.messages) }],
    });
    const { claimsSeen } = await start([finish, finish]);
    const subjects = ['alice', 'bob'];
    await Promise.all(
      subjects.map(async (sub) => {
        const bearer = await token(capability, sub);
        const { result } =
          protocol === 'modern'
            ? await readReply(
                await modern(
                  'tools/call',
                  { name: 'agent', arguments: { message: 'hello' } },
                  bearer,
                ),
              )
            : await call(bearer);
        expect(result.structuredContent).toEqual({
          runId: expect.any(String),
          operator: 'agent',
          status: 'completed',
          output: JSON.stringify([
            { role: 'user', text: 'hello' },
            {
              role: 'user',
              text: 'Context: ' + JSON.stringify({ userId: sub }),
            },
          ]),
        });
        expect(JSON.stringify(result)).not.toContain(bearer);
      }),
    );
    expect(new Set(claimsSeen.map((c) => c.sub))).toEqual(new Set(subjects));
    for (const claims of claimsSeen) {
      expect(claims.iss).toBe(auth.issuer);
      expect(claims.aud).toBe(resource);
      expect(claims).not.toHaveProperty('token');
    }
  });

test('a failed context resolver returns a generic protocol error before the model runs', async () => {
  const { llm } = await start([], {
    resolverError: new Error('private diagnostic'),
  });
  const reply = await call(await token());
  expect(reply.error.code).toBe(-32603);
  expect(JSON.stringify(reply)).not.toContain('private diagnostic');
  expect(llm.requests).toHaveLength(0);
});

test('the runtime only handles single messages and does not open subscription streams', async () => {
  await start();
  const bearer = await token();
  const batch = await postBody(
    [{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }],
    bearer,
  );
  expect(batch.status).toBe(400);
  expect(await batch.json()).toMatchObject({ error: { code: -32600 } });
  const subscription = await modern(
    'subscriptions/listen',
    { notifications: {} },
    bearer,
  );
  try {
    expect(subscription.headers.get('content-type')).toContain(
      'application/json',
    );
    expect(await subscription.json()).toHaveProperty('error');
  } finally {
    if (!subscription.bodyUsed) await subscription.body?.cancel();
  }
});

test('the default approval port prevents execution', async () => {
  const { calls, llm } = await start([toolCall, done], {
    approvalRequired: true,
  });
  const { result } = await call(await token());
  expect(result.structuredContent.status).toBe('completed');
  expect(calls).toEqual([]);
  expect(llm.requests[1]?.messages.at(-1)).toMatchObject({
    role: 'tool',
    results: [{ isError: true, content: { code: 'approval_denied' } }],
  });
});

test('the configured approval port, not the client, approves execution', async () => {
  const approval = new FakeApproval(true);
  const { calls } = await start([toolCall, done], {
    approvalRequired: true,
    approval,
  });
  const { result } = await call(await token());
  expect(result.structuredContent.status).toBe('completed');
  expect(calls).toEqual([{ value: 'ok' }]);
  expect(approval.requests).toHaveLength(1);
});

for (const includeEvents of [false, true]) {
  test(
    'domain event projection with includeEvents=' + includeEvents,
    async () => {
      await start([toolCall, done], { includeEvents });
      const { result } = await call(await token());
      const run = result.structuredContent;
      expect(run.status).toBe('completed');
      expect(run).not.toHaveProperty('steps');
      if (includeEvents) {
        expect(run.events).toHaveLength(1);
        expect(run.events[0]).toMatchObject({
          name: 'Changed',
          payload: { value: 'ok' },
          eventId: expect.any(String),
          occurredAt: expect.any(String),
          correlationId: run.runId,
          causationId: expect.any(String),
        });
      } else {
        expect(run).not.toHaveProperty('events');
        expect(JSON.stringify(result)).not.toContain('Changed');
      }
    },
  );
}

test('failed and timed-out runs are MCP successes without internal errors', async () => {
  await start(
    [
      () => {
        throw new Error('private provider diagnostic');
      },
      () => new Promise(() => {}),
    ],
    { timeoutMs: 35 },
  );
  const bearer = await token();
  for (const status of ['failed', 'timeout']) {
    const { result } = await call(bearer);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      runId: expect.any(String),
      operator: 'agent',
      status,
      ...(status === 'failed' ? { reason: 'provider_error' } : {}),
    });
    expect(JSON.stringify(result)).not.toContain('private provider diagnostic');
  }
});

test('a message of the wrong type is rejected before the LLM is called', async () => {
  const { llm } = await start();
  const { error } = await call(await token(), 'agent', { message: 42 });
  expect(error).toMatchObject({ code: -32602, message: 'Invalid arguments' });
  expect(llm.requests).toHaveLength(0);
});

test('a tool call with invalid input during the run is refused and the run completes', async () => {
  const badInput: LlmScriptEntry = {
    stopReason: 'tool_calls',
    content: [
      { type: 'tool_call', name: 'tool', id: 't', input: { value: 1 } },
    ],
  };
  const { calls, llm } = await start([badInput, done]);
  const { result } = await call(await token());
  expect(result.structuredContent.status).toBe('completed');
  expect(calls).toEqual([]);
  expect(llm.requests[1]?.messages.at(-1)).toMatchObject({
    role: 'tool',
    results: [{ isError: true, content: { code: 'invalid_input' } }],
  });
});
