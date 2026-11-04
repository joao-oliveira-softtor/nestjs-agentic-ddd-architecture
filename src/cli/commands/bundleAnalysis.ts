import { analyzeCandidate } from '../../compiler/bundle/analysis';
import { parseArgs } from '../args';
import { USAGE } from '../usage';

/** The two paths the analysis needs, or the message that refuses the arguments. */
export function bundleAnalysisArgs(
  args: readonly string[],
): { config: string; baseLock: string } | { error: string } {
  const parsed = parseArgs(args, {
    booleans: [],
    values: ['--config', '--base-lock'],
    positionals: 0,
  });
  if (typeof parsed === 'string') return { error: parsed };
  const baseLock = parsed.values.get('--base-lock');
  if (baseLock === undefined) return { error: 'missing --base-lock' };
  return {
    config: parsed.values.get('--config') ?? 'agentic.config.ts',
    baseLock,
  };
}

/** Internal: run by `compileBundle` in a child process, never documented in USAGE. Prints JSON. A thin shell over `bundleAnalysisArgs` and `analyzeCandidate`. */
export async function bundleAnalysisCommand(
  args: readonly string[],
): Promise<number> {
  const parsed = bundleAnalysisArgs(args);
  if ('error' in parsed) {
    console.error(`${parsed.error}\n${USAGE}`);
    return 2;
  }
  process.stdout.write(
    JSON.stringify(await analyzeCandidate(parsed.config, parsed.baseLock)),
  );
  return 0;
}
