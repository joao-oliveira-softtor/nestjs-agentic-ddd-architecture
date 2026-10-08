import { packet } from '../../compiler/packet';
import { parseArgs } from '../args';
import { USAGE } from '../usage';

export async function packetCommand(args: readonly string[]): Promise<number> {
  const parsed = parseArgs(args, {
    booleans: [],
    values: ['--config'],
    positionals: 1,
  });
  if (typeof parsed === 'string') {
    console.error(`${parsed}\n${USAGE}`);
    return 2;
  }
  process.stdout.write(
    await packet({
      configPath: parsed.values.get('--config') ?? 'agentic.config.ts',
      item: parsed.positionals[0]!,
    }),
  );
  return 0;
}
