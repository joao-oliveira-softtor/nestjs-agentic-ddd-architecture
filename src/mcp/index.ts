import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { stableStringify } from '../contracts/canonical';
import { checkSnapshot } from '../compiler/snapshot';
import { changes, element, overview, rulesForPath } from './tools';

type Result = { content: { type: 'text'; text: string }[]; isError?: true };
type Fresh = Extract<Awaited<ReturnType<typeof checkSnapshot>>, { ok: true }>;

export function startMcpServer({ root }: { root: string }): {
  close(): Promise<void>;
} {
  // Toda chamada revalida o snapshot: nada serve dado desatualizado.
  const guarded =
    <A>(run: (s: Fresh, args: A) => Result | object) =>
    async (args: A): Promise<Result> => {
      const snap = await checkSnapshot(root);
      if (!snap.ok)
        return {
          content: [{ type: 'text', text: snap.reason }],
          isError: true,
        };
      const out = run(snap, args);
      return 'content' in out
        ? (out as Result)
        : { content: [{ type: 'text', text: stableStringify(out) }] };
    };
  const annotations = { readOnlyHint: true, openWorldHint: false };
  return serveStdio(() => {
    const server = new McpServer(
      { name: 'agentic-ddd', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );
    server.registerTool(
      'domain_overview',
      {
        title: 'Visão geral do domínio',
        description:
          'Lista módulos, entidades, use-cases e operators do domínio.',
        inputSchema: z.object({}),
        annotations,
      },
      guarded((s) => overview(s.lock)),
    );
    server.registerTool(
      'domain_element',
      {
        title: 'Detalhe de um elemento',
        description: 'Devolve o contrato de um elemento do domínio pelo id.',
        inputSchema: z.object({ id: z.string() }),
        annotations,
      },
      guarded<{ id: string }>((s, { id }) => {
        const r = element(s.lock, id);
        return r.ok
          ? r.value
          : { content: [{ type: 'text', text: r.error }], isError: true };
      }),
    );
    server.registerTool(
      'domain_changes',
      {
        title: 'Mudanças de regra de negócio',
        description:
          'Lista as mudanças registradas, opcionalmente só as de um id.',
        inputSchema: z.object({ id: z.string().optional() }),
        annotations,
      },
      guarded<{ id?: string }>((s, { id }) => changes(s.lock, id)),
    );
    server.registerTool(
      'rules_for_path',
      {
        title: 'Regras do time para um arquivo',
        description:
          'Regras que valem para um arquivo. path é relativo à raiz do projeto, com barra normal (ex.: examples/orders/a.ts).',
        inputSchema: z.object({ path: z.string() }),
        annotations,
      },
      guarded<{ path: string }>((s, { path }) => rulesForPath(s.rules, path)),
    );
    return server;
  });
}
