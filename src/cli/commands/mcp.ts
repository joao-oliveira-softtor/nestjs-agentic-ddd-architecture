import { resolve } from 'node:path';
import { parseArgs } from '../args';
import { USAGE } from '../usage';

type Load = () => Promise<{
  startMcpServer(options: { root: string }): { close(): unknown };
}>;

export async function mcpCommand(
  args: readonly string[],
  load: Load = () => import('../../mcp/index'),
): Promise<number> {
  const parsed = parseArgs(args, {
    booleans: [],
    values: ['--root'],
    positionals: 0,
  });
  if (typeof parsed === 'string') {
    console.error(`${parsed}\n${USAGE}`);
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
      'agentic-ddd: instale @modelcontextprotocol/server@2.3.1 para usar `agentic-ddd mcp`',
    );
    return 1;
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
