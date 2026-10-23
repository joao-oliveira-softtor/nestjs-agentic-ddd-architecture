import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { stableStringify } from '../contracts/canonical';
import { checkSnapshot } from '../compiler/snapshot';
import { changes, element, overview, rulesForPath } from './tools';

type Fresh = Extract<Awaited<ReturnType<typeof checkSnapshot>>, { ok: true }>;

export function startMcpServer({ root }: { root: string }): {
  close(): Promise<void>;
} {
  // Toda chamada revalida o snapshot: nada serve dado desatualizado. Erro
  // lançado aqui volta ao cliente como resultado com isError (SDK).
  const guarded =
    <A>(run: (s: Fresh, args: A) => object) =>
    async (args: A) => {
      const snap = await checkSnapshot(root);
      if (!snap.ok) throw new Error(snap.reason);
      return {
        content: [
          { type: 'text' as const, text: stableStringify(run(snap, args)) },
        ],
      };
    };
  const annotations = { readOnlyHint: true, openWorldHint: false };
  return serveStdio(() => {
    const server = new McpServer({ name: 'agentic-ddd', version: '0.4.0' });
    server.registerTool(
      'domain_overview',
      {
        title: 'Visão geral do domínio',
        description:
          'Lista, por módulo, entidades, eventos, use-cases e operators, com id e descrição.',
        inputSchema: z.object({}),
        annotations,
      },
      guarded((s) => overview(s.lock)),
    );
    server.registerTool(
      'domain_element',
      {
        title: 'Detalhe de um elemento',
        description:
          'Devolve um elemento pelo id, com as relações. Prefixos: entity:, method:, invariant:, event:, usecase:, operator: (ids de método e invariante aparecem no detalhe da entidade).',
        inputSchema: z.object({ id: z.string() }),
        annotations,
      },
      guarded<{ id: string }>((s, { id }) => {
        const r = element(s.lock, id);
        if (!r.ok) throw new Error(r.error);
        return r.value;
      }),
    );
    server.registerTool(
      'domain_changes',
      {
        title: 'Mudanças de regra de negócio',
        description:
          'Lista as mudanças registradas, opcionalmente só as que citam um id.',
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
