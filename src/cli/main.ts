import { AgenticError, formatCoded } from '../contracts/codes';
import { applyCommand } from './commands/apply';
import { compileCommand } from './commands/compile';
import { irCommand } from './commands/ir';
import { verifyCommand } from './commands/verify';
import { USAGE } from './usage';
import { statusCommand, nextCommand } from './commands/state';
import { packetCommand } from './commands/packet';
import { mcpCommand } from './commands/mcp';
import { publishLockCommand } from './commands/publishLock';
import { bundleAnalysisCommand } from './commands/bundleAnalysis';

export { USAGE };

const COMMANDS: Readonly<
  Record<string, (args: readonly string[]) => Promise<number>>
> = {
  apply: applyCommand,
  compile: compileCommand,
  ir: irCommand,
  verify: verifyCommand,
  status: statusCommand,
  next: nextCommand,
  packet: packetCommand,
  mcp: (args) => mcpCommand(args),
  'publish-lock': publishLockCommand,
  'bundle-analysis': bundleAnalysisCommand,
};

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const run =
    command === undefined || !Object.hasOwn(COMMANDS, command)
      ? undefined
      : COMMANDS[command];
  if (!run) {
    console.error(USAGE);
    return 2;
  }
  try {
    return await run(rest);
  } catch (error) {
    console.error(
      `agentic-ddd: ${error instanceof AgenticError ? formatCoded(error) : (error as Error).message}`,
    );
    return 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
