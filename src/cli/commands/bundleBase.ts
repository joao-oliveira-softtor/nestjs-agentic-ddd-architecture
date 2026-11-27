import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toLf } from '../../compiler/canonical';
import { loadConfig } from '../../compiler/config';
import { loadRules } from '../../compiler/rules';
import { quote } from '../../compiler/bundle/candidate';
import { AgenticError } from '../../contracts/codes';
import { parseArgs } from '../args';
import { USAGE } from '../usage';

/** What the base commit gives the candidate, as JSON the server reads back (#177). */
async function readBase(configRel: string, wanted: string) {
  const config = await loadConfig(configRel);
  const module = config.modules.find((m) => m.name === wanted);
  if (!module)
    throw new AgenticError(
      'bundle.module-unknown',
      `module ${quote(wanted)} is not configured in the base project`,
    );
  // EOL rule: every text that feeds a hash is LF (`toLf`). A checkout may be CRLF
  // (core.autocrlf), but the committed bytes, which `apply` recomputes from, are LF.
  const lockText = await readFile(join(config.outRoot, config.out.lock), 'utf8')
    .then(toLf)
    .catch(() => null);
  if (lockText === null)
    throw new AgenticError(
      'bundle.base-lock-missing',
      `the base commit has no ${config.out.lock}; run \`agentic compile\` there first`,
    );
  return { config, rules: await loadRules(config), module, lockText };
}

/**
 * Internal: run by `compileBundle` in a child process, never documented in USAGE, so the server
 * never imports the project config (#177). Writes `{ config, rules, module, lockText }`, or
 * `{ error: { code, message } }` for a coded refusal, to `--out`.
 */
export async function bundleBaseCommand(
  args: readonly string[],
): Promise<number> {
  const parsed = parseArgs(args, {
    booleans: [],
    values: ['--config', '--module', '--out'],
    positionals: 0,
  });
  const error =
    typeof parsed === 'string'
      ? parsed
      : (['--config', '--module', '--out'] as const)
          .filter((flag) => !parsed.values.has(flag))
          .map((flag) => `missing ${flag}`)[0];
  if (typeof parsed === 'string' || error !== undefined) {
    console.error(`${error}\n${USAGE}`);
    return 2;
  }
  const get = (flag: string) => parsed.values.get(flag)!;
  const result = await readBase(get('--config'), get('--module')).catch(
    (e: unknown) => {
      if (!(e instanceof AgenticError)) throw e;
      return { error: { code: e.code, message: e.message } };
    },
  );
  await writeFile(get('--out'), JSON.stringify(result), { flag: 'wx' });
  return 0;
}
