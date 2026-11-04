import {
  applyBundle,
  type ApplyOptions,
  type ApplyResult,
} from '../../compiler/bundle/apply';
import { parseArgs } from '../args';
import { USAGE } from '../usage';

/** The options of `apply` from its arguments, or the message to print when they are wrong. Pure. */
export function applyRequest(
  args: readonly string[],
  cwd: string,
): Pick<ApplyOptions, 'bundleDir' | 'projectRoot' | 'yes'> | string {
  const parsed = parseArgs(args, {
    booleans: ['--yes'],
    values: ['--root'],
    positionals: 1,
  });
  if (typeof parsed === 'string') return `${parsed}\n${USAGE}`;
  return {
    bundleDir: parsed.positionals[0]!,
    projectRoot: parsed.values.get('--root') ?? cwd,
    yes: parsed.flags.has('--yes'),
  };
}

export async function applyCommand(
  args: readonly string[],
  apply: (options: ApplyOptions) => Promise<ApplyResult> = applyBundle,
): Promise<number> {
  const request = applyRequest(args, process.cwd());
  if (typeof request === 'string') {
    console.error(request);
    return 2;
  }
  const result = await apply(request);
  console.log(
    `agentic-ddd: bundle applied as change ${result.change}, ${result.written.length} file(s) written and compiled`,
  );
  return 0;
}
