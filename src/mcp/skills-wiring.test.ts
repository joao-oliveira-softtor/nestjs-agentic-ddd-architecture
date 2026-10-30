import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createPublishedLock } from '../compiler/published';
import { parseLock } from '../compiler/lock';
import type { Rule } from '../compiler/rules';
import { parseSseData } from '../../scripts/sse-data';
import { twoModuleLock } from '../../test/helpers/two-module-lock';
import { createDomainServer } from './index';

const root = resolve(import.meta.dir, '../..');
const repoLock = parseLock(
  await Bun.file(resolve(root, '.agentic/domain.lock.json')).text(),
  'lock',
);
const rules: Rule[] = [
  { key: 'open', file: 'rules/open.md', paths: null, body: '- open rule' },
];
const published = createPublishedLock('1', twoModuleLock(repoLock), rules);
const LANGUAGE =
  "Reply to the user in the user's language. Never translate identifiers, invariant ids or business text.";

const handler = (remote: boolean) =>
  createMcpHandler(() => createDomainServer({ published }, remote));
const local = handler(false);
const remote = handler(true);

// `scopes` undefined: no authInfo at all (a local caller or a token that reached the server bare).
async function rpc(
  h: typeof local,
  method: string,
  params: object = {},
  scopes?: string[],
): Promise<any> {
  const response = await h.fetch(
    new Request('http://127.0.0.1/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
    scopes
      ? {
          authInfo: {
            token: 't',
            clientId: 'c',
            scopes,
            expiresAt: 9e9,
            resource: new URL('http://127.0.0.1/mcp'),
          },
        }
      : undefined,
  );
  return parseSseData(await response.text());
}

const guide = (h: typeof local, scopes?: string[], doc?: string) =>
  rpc(
    h,
    'tools/call',
    { name: 'authoring_guide', arguments: doc ? { doc } : {} },
    scopes,
  );
const listed = async (h: typeof local, scopes?: string[]) =>
  (
    (await rpc(h, 'resources/list', {}, scopes)).result.resources as {
      uri: string;
    }[]
  ).map((r) => r.uri);

describe('authoring_guide over the Domain MCP', () => {
  test('the index lists every document and a read of each resource equals the tool output', async () => {
    const index = (await guide(local)).result.content[0].text as string;
    const uris = await listed(local);
    expect(uris).toContain('skill://agentic-ddd/SKILL.md');
    expect(uris).toContain('skill://orders-dev/SKILL.md');
    expect(uris).toContain('skill://billing-dev/SKILL.md');
    expect(uris).toContain('skill://agentic-ddd/rules/open.md');
    for (const uri of uris) {
      expect(index).toContain(uri);
      const viaTool = (await guide(local, undefined, uri)).result.content[0]
        .text;
      const viaResource = await rpc(local, 'resources/read', { uri });
      expect(viaResource.result.contents[0]).toMatchObject({
        uri,
        mimeType: 'text/markdown',
        text: viaTool,
      });
    }
  });

  test('a short name resolves like the full URI', async () => {
    const short = (await guide(local, undefined, 'orders-dev')).result
      .content[0].text;
    const full = (await guide(local, undefined, 'skill://orders-dev/SKILL.md'))
      .result.content[0].text;
    expect(short).toBe(full);
  });

  test('skill:read:orders sees orders-dev only', async () => {
    const scopes = ['skill:read:orders'];
    const uris = await listed(remote, scopes);
    expect(uris).toContain('skill://orders-dev/SKILL.md');
    expect(uris.some((u) => u.includes('billing'))).toBe(false);
    const index = (await guide(remote, scopes)).result.content[0].text;
    expect(index).not.toContain('billing');
  });

  test('a hidden document looks exactly like an unknown one, in the tool and in the resource', async () => {
    const scopes = ['skill:read:orders'];
    const hidden = await guide(remote, scopes, 'skill://billing-dev/SKILL.md');
    const unknown = await guide(remote, scopes, 'skill://nothing-dev/SKILL.md');
    expect(hidden.result.isError).toBe(true);
    expect(hidden.result.content[0].text).toContain('mcp.doc-unknown');
    expect(hidden.result.content[0].text).toBe(unknown.result.content[0].text);
    const r1 = await rpc(
      remote,
      'resources/read',
      { uri: 'skill://billing-dev/SKILL.md' },
      scopes,
    );
    const r2 = await rpc(
      remote,
      'resources/read',
      { uri: 'skill://nothing-dev/SKILL.md' },
      scopes,
    );
    expect(r1.error).toBeDefined();
    expect(r1.error.code).toBe(r2.error.code);
    expect(r1.error.message.replace('billing', 'nothing')).toBe(
      r2.error.message,
    );
  });

  test('a remote caller with no skill grant sees nothing', async () => {
    for (const scopes of [undefined, [], ['domain:read']]) {
      expect(await listed(remote, scopes)).toEqual([]);
      const out = (await guide(remote, scopes, 'SKILL.md')).result;
      expect(out.isError).toBe(true);
      expect(out.content[0].text).toContain('mcp.doc-unknown');
      const read = await rpc(
        remote,
        'resources/read',
        { uri: 'skill://agentic-ddd/SKILL.md' },
        scopes,
      );
      expect(read.error).toBeDefined();
    }
  });

  test('a skill:read token sees no domain data from any domain tool', async () => {
    const calls = [
      ['domain_source', {}],
      ['domain_overview', {}],
      ['domain_element', { id: 'entity:Order' }],
      ['domain_changes', {}],
      ['rules_for_path', { path: 'examples/orders/a.ts' }],
    ] as const;
    for (const [name, args] of calls) {
      const out = await rpc(remote, 'tools/call', { name, arguments: args }, [
        'skill:read',
      ]);
      // The caller's own id may be echoed in a refusal; anything else would be data.
      const text = JSON.stringify(out.result.content).replaceAll(
        'entity:Order',
        '',
      );
      expect(text).not.toContain('Order');
      expect(text).not.toContain('billing');
      // domain_source is unguarded by design; the others see an empty scope.
      if (name !== 'domain_source') expect(text).not.toContain('open rule');
    }
  });

  test('crafted resource URIs are refused like an unknown document', async () => {
    const unknown = await rpc(
      remote,
      'resources/read',
      {
        uri: 'skill://nothing-dev/SKILL.md',
      },
      ['skill:read'],
    );
    for (const uri of [
      'skill://agentic-ddd/../orders-dev/SKILL.md',
      'skill://agentic-ddd/%2e%2e/orders-dev/SKILL.md',
      'skill://agentic-ddd/references%2f..%2f..%2forders-dev/SKILL.md',
      'skill://agentic-ddd/..\\orders-dev/SKILL.md',
    ]) {
      const out = await rpc(remote, 'resources/read', { uri }, ['skill:read']);
      expect(out.result).toBeUndefined();
      expect(out.error.code).toBe(unknown.error.code);
    }
  });

  test('descriptions and instructions carry the language rule', async () => {
    const tools = (await rpc(local, 'tools/list')).result.tools as {
      name: string;
      description: string;
    }[];
    expect(
      tools.find((t) => t.name === 'authoring_guide')!.description,
    ).toContain(LANGUAGE);
    const init = (
      await rpc(local, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 't', version: '1' },
      })
    ).result;
    expect(init.instructions).toContain(LANGUAGE);
    expect(init.instructions).toContain('authoring_guide');
    expect(init.instructions.length).toBeLessThanOrEqual(500);
  });

  test('the tool is read-only and no output has an absolute path', async () => {
    const tools = (await rpc(local, 'tools/list')).result.tools as {
      name: string;
      annotations: object;
    }[];
    expect(
      tools.find((t) => t.name === 'authoring_guide')!.annotations,
    ).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    for (const uri of await listed(local)) {
      const text = (await guide(local, undefined, uri)).result.content[0].text;
      expect(text).not.toContain(root);
      expect(text).not.toContain(root.replaceAll('\\', '/'));
    }
  });
});
