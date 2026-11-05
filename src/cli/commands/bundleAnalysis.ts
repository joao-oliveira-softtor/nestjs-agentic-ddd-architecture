import { writeFile } from 'node:fs/promises';
import { analyzeCandidate } from '../../compiler/bundle/analysis';
import { parseArgs } from '../args';
import { USAGE } from '../usage';

/** The two paths the analysis needs, or the message that refuses the arguments. */
export function bundleAnalysisArgs(
  args: readonly string[],
):
  | { config: string; baseLock: string; module: string; out: string }
  | { error: string } {
  const parsed = parseArgs(args, {
    booleans: [],
    values: ['--config', '--base-lock', '--module', '--out'],
    positionals: 0,
  });
  if (typeof parsed === 'string') return { error: parsed };
  const baseLock = parsed.values.get('--base-lock');
  if (baseLock === undefined) return { error: 'missing --base-lock' };
  const module = parsed.values.get('--module');
  if (module === undefined) return { error: 'missing --module' };
  const out = parsed.values.get('--out');
  if (out === undefined) return { error: 'missing --out' };
  return {
    config: parsed.values.get('--config') ?? 'agentic.config.ts',
    baseLock,
    module,
    out,
  };
}

/**
 * Internal: run by `compileBundle` in a child process, never documented in USAGE. Writes the JSON to
 * `--out`, not to stdout: imported candidate modules share stdout, and a pipe write can be cut by
 * the exit. A thin shell over `bundleAnalysisArgs` and `analyzeCandidate`.
 */
export async function bundleAnalysisCommand(
  args: readonly string[],
): Promise<number> {
  const parsed = bundleAnalysisArgs(args);
  if ('error' in parsed) {
    console.error(`${parsed.error}\n${USAGE}`);
    return 2;
  }
  const analysis = await analyzeCandidate(
    parsed.config,
    parsed.baseLock,
    parsed.module,
  );
  await writeFile(parsed.out, JSON.stringify(analysis));
  return 0;
}
