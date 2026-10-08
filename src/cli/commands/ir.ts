import { analyzeProject } from '../../compiler/compile';
import { stableStringify } from '../../compiler/canonical';
import { parseArgs } from '../args';
import { USAGE } from '../usage';

export async function irCommand(args: readonly string[]): Promise<number> {
  const parsed = parseArgs(args, {
    booleans: [],
    values: ['--config'],
    positionals: 0,
  });
  if (typeof parsed === 'string') {
    console.error(`${parsed}\n${USAGE}`);
    return 2;
  }
  const { ir, errors } = await analyzeProject({
    configPath: parsed.values.get('--config') ?? 'agentic.config.ts',
  });
  for (const error of errors)
    console.error(`${error.source ?? '-'}: ${error.message}`);
  if (errors.length > 0) return 1;
  process.stdout.write(stableStringify(ir));
  return 0;
}
