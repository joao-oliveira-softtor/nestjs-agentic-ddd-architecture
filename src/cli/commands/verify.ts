import { verify } from '../../compiler/verify/index';
import { verifyItem } from '../../compiler/verify/item';
import { parseArgs } from '../args';
import { USAGE } from '../usage';

export async function verifyCommand(args: readonly string[]): Promise<number> {
  const itemMode = args.includes('--item');
  const parsed = parseArgs(args, {
    booleans: ['--json'],
    values: itemMode ? ['--config', '--item', '--spec-hash'] : ['--config'],
    positionals: itemMode ? 0 : 1,
  });
  if (typeof parsed === 'string') {
    console.error(`${parsed}\n${USAGE}`);
    return 2;
  }
  const configPath = parsed.values.get('--config') ?? 'agentic.config.ts';
  const specHash = parsed.values.get('--spec-hash');
  if (itemMode && (!specHash || !/^[a-f0-9]{64}$/.test(specHash))) {
    console.error('--spec-hash exige um SHA-256 hexadecimal');
    return 2;
  }
  const report = itemMode
    ? await verifyItem({
        configPath,
        item: parsed.values.get('--item')!,
        specHash: specHash!,
      })
    : await verify({ configPath, change: parsed.positionals[0]! });
  for (const gate of report.gates) {
    console.error(`${gate.id} ${gate.name}: ${gate.status}`);
    for (const finding of [...gate.findings, ...gate.warnings]) {
      const source = finding.source ? ` (${finding.source})` : '';
      const fix = finding.fix ? ` → ${finding.fix}` : '';
      console.error(`  - ${finding.message}${source}${fix}`);
    }
  }
  console.error(
    `agentic-ddd: ${'item' in report ? `item ${report.item}` : `change ${report.change}`} — ${report.status}`,
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.status === 'failed' ? 1 : 0;
}
