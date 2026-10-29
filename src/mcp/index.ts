import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { isAbsolute, posix, relative } from 'node:path';
import { z } from 'zod';
import { stableStringify } from '../contracts/canonical';
import { AgenticError, canonicalPath, formatCoded } from '../contracts/ir';
import { checkSnapshot } from '../compiler/snapshot';
import { changes, element, overview, rulesForPath } from './tools';

type Fresh = Extract<Awaited<ReturnType<typeof checkSnapshot>>, { ok: true }>;

export function startMcpServer({ root }: { root: string }): {
  close(): Promise<void>;
} {
  // Every call revalidates the snapshot: nothing serves stale data. An error
  // thrown here returns to the client as a result with isError (SDK).
  const guarded =
    <A>(run: (s: Fresh, args: A) => object) =>
    async (args: A) => {
      try {
        const snap = await checkSnapshot(root);
        if (!snap.ok) throw new AgenticError(snap.code, snap.reason);
        return {
          content: [
            { type: 'text' as const, text: stableStringify(run(snap, args)) },
          ],
        };
      } catch (error) {
        if (!(error instanceof AgenticError)) throw error;
        return {
          isError: true,
          content: [{ type: 'text' as const, text: formatCoded(error) }],
        };
      }
    };
  const annotations = { readOnlyHint: true, openWorldHint: false };
  return serveStdio(() => {
    const server = new McpServer({ name: 'agentic-ddd', version: '0.5.0' });
    server.registerTool(
      'domain_overview',
      {
        title: 'Domain overview',
        description:
          'Lists, per module, entities, events, use-cases and operators, with id and description.',
        inputSchema: z.object({}),
        annotations,
      },
      guarded((s) => overview(s.lock)),
    );
    server.registerTool(
      'domain_element',
      {
        title: 'Element detail',
        description:
          'Returns an element by id, with its relations. Prefixes: entity:, method:, invariant:, event:, usecase:, operator: (method and invariant ids appear in the detail of the entity or use-case).',
        inputSchema: z.object({ id: z.string() }),
        annotations,
      },
      guarded<{ id: string }>((s, { id }) => {
        const r = element(s.lock, id);
        if (!r.ok) throw new AgenticError(r.code, r.error);
        return r.value;
      }),
    );
    server.registerTool(
      'domain_changes',
      {
        title: 'Business rule changes',
        description:
          'Lists the recorded changes, optionally only those that cite an id.',
        inputSchema: z.object({ id: z.string().optional() }),
        annotations,
      },
      guarded<{ id?: string }>((s, { id }) => changes(s.lock, id)),
    );
    server.registerTool(
      'rules_for_path',
      {
        title: 'Team rules for a file',
        description:
          'Rules that apply to a file. path is relative to the project root (e.g. examples/orders/a.ts) or absolute inside it.',
        inputSchema: z.object({ path: z.string() }),
        annotations,
      },
      guarded<{ path: string }>((s, { path }) => {
        // Clients often send absolute paths; the rule globs are relative to the root.
        // `\` becomes `/` before the check, as rulesForPath does: `..\x` is also outside the root.
        // normalize resolves inner `./` and `x/..`: `./../a` and `x/../../a` also leave the root.
        const rel = posix.normalize(
          (isAbsolute(path)
            ? relative(s.root, canonicalPath(path))
            : path
          ).replaceAll('\\', '/'),
        );
        if (isAbsolute(rel) || rel === '..' || rel.startsWith('../'))
          throw new AgenticError(
            'mcp.path-outside-root',
            `${path}: outside the project root (${s.root})`,
          );
        return rulesForPath(s.rules, rel);
      }),
    );
    return server;
  });
}
