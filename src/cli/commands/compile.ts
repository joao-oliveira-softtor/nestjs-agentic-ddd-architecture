import { compile } from '../../compiler/compile';
import { formatReport } from '../../compiler/report';
import { parseArgs } from '../args';
import { USAGE } from '../usage';

export async function compileCommand(args: readonly string[]): Promise<number> {
  const parsed = parseArgs(args, {
    booleans: ['--check', '--report'],
    values: ['--config', '--out-root', '--draft-change'],
    positionals: 0,
  });
  if (typeof parsed === 'string') {
    console.error(`${parsed}\n${USAGE}`);
    return 2;
  }
  const check = parsed.flags.has('--check');
  const result = await compile({
    configPath: parsed.values.get('--config') ?? 'agentic.config.ts',
    outRoot: parsed.values.get('--out-root'),
    mode: check ? 'check' : 'write',
    draftChange: parsed.values.get('--draft-change'),
  });
  if (parsed.flags.has('--report') && result.rendered)
    console.log(formatReport(result.rendered, result.lint));
  for (const error of result.errors)
    console.error(`${error.source ?? '-'}: ${error.message} [${error.code}]`);
  for (const item of result.drift)
    console.error(`outdated (${item.reason}): ${item.path}`);
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  for (const item of result.pending) console.error(`pending: ${item}`);
  if (result.drafted) {
    console.log(
      `agentic-ddd: proposal created at ${result.drafted}; fill in the ## Motivo (and the acceptance criteria) and run \`bun run agentic compile\``,
    );
  }
  if (result.applied)
    console.log(`agentic-ddd: proposal ${result.applied} applied and archived`);
  if (!result.ok) {
    const blocked = result.drift.filter((item) => item.reason === 'conflict');
    if (result.drift.length > blocked.length)
      console.error(
        'run `bun run agentic compile` and commit the generated files',
      );
    for (const item of blocked) {
      console.error(
        `for ${item.path}: remove or rename the existing directory, or adjust out/mirrors in agentic.config.ts`,
      );
    }
    return 1;
  }
  console.log(
    check
      ? 'agentic-ddd: generated files are up to date'
      : `agentic-ddd: ${result.written.length} file(s) updated`,
  );
  return 0;
}
