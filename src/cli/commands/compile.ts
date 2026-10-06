import { compile } from '../../compiler/compile';
import { formatReport } from '../../compiler/report';
import { parseArgs } from '../args';
import { USAGE } from '../usage';

export async function compileCommand(args: readonly string[]): Promise<number> {
  const parsed = parseArgs(args, {
    booleans: ['--check', '--report'],
    values: ['--config', '--out-root'],
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
  });
  if (parsed.flags.has('--report') && result.rendered)
    console.log(formatReport(result.rendered, result.lint));
  for (const error of result.errors)
    console.error(`${error.source ?? '-'}: ${error.message}`);
  for (const item of result.drift)
    console.error(`desatualizado (${item.reason}): ${item.path}`);
  for (const warning of result.warnings) console.warn(`aviso: ${warning}`);
  if (!result.ok) {
    const blocked = result.drift.filter((item) => item.reason === 'conflict');
    if (result.drift.length > blocked.length)
      console.error(
        'rode `bun run agentic compile` e commite os arquivos gerados',
      );
    for (const item of blocked) {
      console.error(
        `para ${item.path}: remova ou renomeie o diretório existente, ou ajuste out/mirrors em agentic.config.ts`,
      );
    }
    return 1;
  }
  console.log(
    check
      ? 'agentic-ddd: arquivos gerados estão em dia'
      : `agentic-ddd: ${result.written.length} arquivo(s) atualizado(s)`,
  );
  return 0;
}
