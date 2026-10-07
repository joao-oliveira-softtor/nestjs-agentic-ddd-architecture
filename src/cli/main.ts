import { compileCommand } from './commands/compile';
import { irCommand } from './commands/ir';
import { verifyCommand } from './commands/verify';
import { USAGE } from './usage';

export { USAGE };

const COMMANDS: Readonly<
  Record<string, (args: readonly string[]) => Promise<number>>
> = {
  compile: compileCommand,
  ir: irCommand,
  verify: verifyCommand,
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
    console.error(`agentic-ddd: ${(error as Error).message}`);
    return 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
