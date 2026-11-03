import { analyzeCandidate } from '../../compiler/bundle/analysis';
import { parseArgs } from '../args';
import { USAGE } from '../usage';

/** Internal: run by `compileBundle` in a child process, never documented in USAGE. Prints JSON. */
export async function bundleAnalysisCommand(
  args: readonly string[],
): Promise<number> {
  const parsed = parseArgs(args, {
    booleans: [],
    values: ['--config', '--base-lock'],
    positionals: 0,
  });
  const lock =
    typeof parsed === 'string' ? undefined : parsed.values.get('--base-lock');
  if (typeof parsed === 'string' || lock === undefined) {
    console.error(`${typeof parsed === 'string' ? parsed : 'missing --base-lock'}\n${USAGE}`);
    return 2;
  }
  process.stdout.write(
    JSON.stringify(
      await analyzeCandidate(
        parsed.values.get('--config') ?? 'agentic.config.ts',
        lock,
      ),
    ),
  );
  return 0;
}
