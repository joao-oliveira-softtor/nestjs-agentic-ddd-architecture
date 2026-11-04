import { applyBundle } from '../../compiler/bundle/apply';
import { parseArgs } from '../args';
import { USAGE } from '../usage';

export async function applyCommand(args: readonly string[]): Promise<number> {
  const parsed = parseArgs(args, {
    booleans: [],
    values: ['--root'],
    positionals: 1,
  });
  if (typeof parsed === 'string') {
    console.error(`${parsed}\n${USAGE}`);
    return 2;
  }
  const result = await applyBundle({
    bundleDir: parsed.positionals[0]!,
    projectRoot: parsed.values.get('--root') ?? process.cwd(),
  });
  console.log(
    `agentic-ddd: bundle applied${result.change ? ` as change ${result.change}` : ''}, ${result.written.length} file(s) written and compiled`,
  );
  return 0;
}
