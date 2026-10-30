import { resolve } from 'node:path';
import {
  loadConfig,
  loadMcpConfig,
  type McpConfig,
} from '../../compiler/config';
import {
  readPublishedLock,
  type PublishedLock,
} from '../../compiler/published';
import { AgenticError, formatCoded } from '../../contracts/codes';
import { parseArgs } from '../args';
import { USAGE } from '../usage';

type Load = () => Promise<{
  startMcpServer(options: { root: string; published?: PublishedLock }): {
    close(): unknown;
  };
  startMcpHttpServer(options: {
    root: string;
    published?: PublishedLock;
    port: number;
    host: string;
    mcp: McpConfig;
  }): Promise<{ close(): unknown; port: number }>;
}>;

// Bind failures from the listen call, each with the stable code and its message.
const BIND_ERRORS: Readonly<
  Record<
    string,
    {
      code: 'cli.host-unavailable' | 'cli.port-denied' | 'cli.port-in-use';
      message(host: string, port: string): string;
    }
  >
> = {
  EADDRINUSE: {
    code: 'cli.port-in-use',
    message: (host, port) => `port ${port} is already in use on ${host}`,
  },
  EACCES: {
    code: 'cli.port-denied',
    message: (host, port) => `permission denied to bind ${host}:${port}`,
  },
  EADDRNOTAVAIL: {
    code: 'cli.host-unavailable',
    message: (host) => `${host} is not an address of this machine`,
  },
};

export async function mcpCommand(
  args: readonly string[],
  load: Load = () => import('../../mcp/index'),
): Promise<number> {
  const parsed = parseArgs(args, {
    booleans: ['--http'],
    values: [
      '--root',
      '--config',
      '--port',
      '--host',
      '--published',
      '--expect-digest',
    ],
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
  if (
    parsed.values.has('--expect-digest') &&
    !parsed.values.has('--published')
  ) {
    console.error(
      `${formatCoded({ code: 'cli.expect-digest-requires-published', message: '--expect-digest was passed without --published.' })}\n${USAGE}`,
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
  let published: PublishedLock | undefined;
  const publishedArg = parsed.values.get('--published');
  if (publishedArg !== undefined) {
    try {
      published = await readPublishedLock(
        resolve(publishedArg),
        publishedArg,
        parsed.values.get('--expect-digest'),
      );
    } catch (error) {
      if (!(error instanceof AgenticError)) throw error;
      console.error(formatCoded(error));
      return 1;
    }
  }
  // Printed only once the server is up, never before a failure.
  const announce = () => {
    if (published !== undefined)
      console.error(
        `agentic-ddd serving published lock ${published.version} (digest ${published.digest.slice(0, 12)})`,
      );
  };
  if (http) {
    const configPath =
      parsed.values.get('--config') ?? resolve(root, 'agentic.config.ts');
    // A published host may have no module sources, so skip the module-path checks.
    const mcp =
      published === undefined
        ? (await loadConfig(configPath)).mcp
        : await loadMcpConfig(configPath);
    if (mcp === undefined) {
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
        published,
        port: Number(port),
        host,
        mcp,
      });
    } catch (error) {
      const { code, message } = error as { code?: string; message?: string };
      if (code !== undefined && Object.hasOwn(BIND_ERRORS, code)) {
        const bind = BIND_ERRORS[code];
        console.error(
          formatCoded({
            code: bind.code,
            message: bind.message(host, port),
          }),
        );
        return 1;
      }
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
    announce();
    // Brackets are added only once, whether or not the user typed them.
    const bare = host.replace(/^\[(.*)\]$/, '$1');
    const shown = bare.includes(':') ? `[${bare}]` : bare;
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
  const handle = mod.startMcpServer({ root, published });
  announce();
  const { stdin } = process;
  if (!stdin.readableEnded && !stdin.destroyed)
    await new Promise<void>((done) => {
      const finish = () => {
        stdin.off('end', finish);
        stdin.off('close', finish);
        done();
      };
      stdin.on('end', finish);
      stdin.on('close', finish);
    });
  await handle.close();
  return 0;
}
