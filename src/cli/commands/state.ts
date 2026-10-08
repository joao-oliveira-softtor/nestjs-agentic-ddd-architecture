import { next, status } from '../../compiler/project-state';
import { parseArgs } from '../args';
import { USAGE } from '../usage';

async function query(
  args: readonly string[],
  command: 'status' | 'next',
): Promise<number> {
  const parsed = parseArgs(args, {
    booleans: command === 'status' ? ['--json', '--static'] : ['--json'],
    values: ['--config', '--change'],
    positionals: 0,
  });
  if (typeof parsed === 'string') {
    console.error(`${parsed}\n${USAGE}`);
    return 2;
  }
  const change = parsed.values.get('--change');
  if (change !== undefined && !/^\d{4}$/.test(change)) {
    console.error('--change exige NNNN');
    return 2;
  }
  const options = {
    configPath: parsed.values.get('--config') ?? 'agentic.config.ts',
    change,
    static: parsed.flags.has('--static'),
  };
  const report =
    command === 'status' ? await status(options) : await next(options);
  report.diagnostics.forEach((d) => console.error(d));
  if (parsed.flags.has('--json'))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else if ('items' in report) {
    for (const item of report.items) {
      console.log(
        `${item.id}: ${item.state === 'blocked' ? `blocked(${item.baseState})` : item.state}`,
      );
      console.log(`  obrigações: ${item.obligations.join(', ') || '—'}`);
      if (item.blockedBy.length)
        console.log(`  bloqueado por: ${item.blockedBy.join(', ')}`);
      if (item.missingObligations.length)
        console.log(`  sem teste: ${item.missingObligations.join(', ')}`);
      for (const t of item.unsuccessfulTests)
        console.log(`  ${t.status}: ${t.name} (${t.file}:${t.line})`);
    }
  } else
    report.waves.forEach((wave, i) =>
      console.log(`${i + 1}. ${wave.join(', ')}`),
    );
  return 0;
}
export const statusCommand = (args: readonly string[]) => query(args, 'status');
export const nextCommand = (args: readonly string[]) => query(args, 'next');
