import { verify } from '../../compiler/verify/index';
import { parseArgs } from '../args';
import { USAGE } from '../usage';

export async function verifyCommand(args: readonly string[]): Promise<number> {
  const parsed = parseArgs(args, {
    booleans: [],
    values: ['--config'],
    positionals: 1,
  });
  if (typeof parsed === 'string') {
    console.error(`${parsed}\n${USAGE}`);
    return 2;
  }
  const report = await verify({
    configPath: parsed.values.get('--config') ?? 'agentic.config.ts',
    change: parsed.positionals[0]!,
  });
  for (const gate of report.gates) {
    console.error(`${gate.id} ${gate.name}: ${gate.status}`);
    for (const finding of [...gate.findings, ...gate.warnings]) {
      const source = finding.source ? ` (${finding.source})` : '';
      const fix = finding.fix ? ` → ${finding.fix}` : '';
      console.error(`  - ${finding.message}${source}${fix}`);
    }
  }
  console.error(`agentic-ddd: change ${report.change} — ${report.status}`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.status === 'failed' ? 1 : 0;
}
