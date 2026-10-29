import { resolve } from 'node:path';
import { loadConfig, type McpConfig } from '../../compiler/config';
import { formatCoded } from '../../contracts/codes';
import { parseArgs } from '../args';
import { USAGE } from '../usage';

type Load = () => Promise<{
  startMcpServer(options: { root: string }): { close(): unknown };
  startMcpHttpServer(options: {
    root: string;
    port: number;
    host: string;
    mcp: McpConfig;
  }): Promise<{ close(): unknown; port: number }>;
}>;

export async function mcpCommand(
  args: readonly string[],
  load: Load = () => import('../../mcp/index'),
): Promise<number> {
  const parsed = parseArgs(args, {
    booleans: ['--http'],
    values: ['--root', '--config', '--port', '--host'],
    positionals: 0,
  });
  if (typeof parsed === 'string') {
    console.error(`${parsed}\n${USAGE}`);
    return 2;
  }
  const http = parsed.flags.has('--http');
  const port = parsed.values.get('--port') ?? '3333';
  const host = parsed.values.get('--host') ?? '127.0.0.1';
  if (!http && (parsed.values.has('--port') || parsed.values.has('--host'))) {
    console.error(
      `${formatCoded({ code: 'cli.http-option-requires-http', message: '--port or --host was passed without --http.' })}\n${USAGE}`,
    );
    return 2;
  }
  if (!/^\d{1,5}$/.test(port) || Number(port) > 65535) {
    console.error(
      `${formatCoded({ code: 'cli.port-invalid', message: '--port is not an integer between 0 and 65535.' })}\n${USAGE}`,
    );
    return 2;
  }
  const root = resolve(parsed.values.get('--root') ?? process.cwd());
  let mod: Awaited<ReturnType<Load>>;
  try {
    mod = await load();
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    if (
      code !== 'ERR_MODULE_NOT_FOUND' ||
      !String(message).includes("'@modelcontextprotocol/server")
    )
      throw error;
    console.error(
      formatCoded({
        code: 'cli.mcp-sdk-missing',
        message:
          'agentic-ddd: install @modelcontextprotocol/server@2.3.1 to use `agentic-ddd mcp`',
      }),
    );
    return 1;
  }
  if (http) {
    const config = await loadConfig(
      parsed.values.get('--config') ?? 'agentic.config.ts',
    );
    if (config.mcp === undefined) {
      console.error(
        formatCoded({
          code: 'cli.mcp-config-missing',
          message: '--http needs an mcp section in agentic.config.ts.',
        }),
      );
      return 1;
    }
    let handle: Awaited<ReturnType<typeof mod.startMcpHttpServer>>;
    try {
      handle = await mod.startMcpHttpServer({
        root,
        port: Number(port),
        host,
        mcp: config.mcp,
      });
    } catch (error) {
      const { code, message } = error as { code?: string; message?: string };
      // The auth module is loaded lazily, so a missing `jose` surfaces here.
      if (
        code !== 'ERR_MODULE_NOT_FOUND' ||
        !String(message).includes("'jose'")
      )
        throw error;
      console.error(
        formatCoded({
          code: 'cli.jose-missing',
          message:
            'agentic-ddd: install jose@6.2.14 to use `agentic-ddd mcp --http`',
        }),
      );
      return 1;
    }
    const shown = host.includes(':') ? `[${host}]` : host;
    console.error(
      `agentic-ddd mcp listening on http://${shown}:${handle.port}/mcp`,
    );
    await new Promise<void>((done) => {
      process.once('SIGINT', () => done());
      process.once('SIGTERM', () => done());
    });
    await handle.close();
    return 0;
  }
  const handle = mod.startMcpServer({ root });
  const { stdin } = process;
  if (!stdin.readableEnded && !stdin.destroyed)
    await new Promise<void>((done) => {
      stdin.once('end', done);
      stdin.once('close', done);
    });
  await handle.close();
  return 0;
}
