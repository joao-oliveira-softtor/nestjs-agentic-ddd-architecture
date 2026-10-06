import { compile } from '../compiler/compile.js';
import { formatReport } from '../compiler/report.js';

export const USAGE =
  'uso: agentic-ddd compile [--check] [--report] [--config <arquivo>] [--out-root <dir>]';

interface Flags {
  check: boolean;
  report: boolean;
  config: string;
  outRoot?: string;
}

function parseFlags(args: readonly string[]): Flags | string {
  const flags: Flags = {
    check: false,
    report: false,
    config: 'agentic.config.ts',
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--check') {
      flags.check = true;
    } else if (arg === '--report') {
      flags.report = true;
    } else if (arg === '--config' || arg === '--out-root') {
      const value = args[++i];
      if (!value) return `${arg} exige um valor`;
      if (arg === '--config') flags.config = value;
      else flags.outRoot = value;
    } else {
      return `opção desconhecida: ${arg}`;
    }
  }
  return flags;
}

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== 'compile') {
    console.error(USAGE);
    return 2;
  }
  const flags = parseFlags(rest);
  if (typeof flags === 'string') {
    console.error(`${flags}\n${USAGE}`);
    return 2;
  }
  try {
    const result = await compile({
      configPath: flags.config,
      outRoot: flags.outRoot,
      mode: flags.check ? 'check' : 'write',
    });
    if (flags.report && result.rendered)
      console.log(formatReport(result.rendered, result.lint));
    for (const error of result.errors)
      console.error(`${error.source ?? '-'}: ${error.message}`);
    for (const item of result.drift)
      console.error(`desatualizado (${item.reason}): ${item.path}`);
    for (const warning of result.warnings) console.warn(`aviso: ${warning}`);
    if (!result.ok) {
      const blocked = result.drift.filter(
        (item) => item.reason === 'mirror' || item.reason === 'conflict',
      );
      if (result.drift.length > blocked.length)
        console.error(
          'rode `bun run agentic compile` e commite os arquivos gerados',
        );
      for (const item of blocked)
        console.error(
          `para ${item.path}: remova ou renomeie o diretório existente, ou ajuste out/mirrors em agentic.config.ts`,
        );
      return 1;
    }
    console.log(
      flags.check
        ? 'agentic-ddd: arquivos gerados estão em dia'
        : `agentic-ddd: ${result.written.length} arquivo(s) atualizado(s)`,
    );
    return 0;
  } catch (error) {
    console.error(`agentic-ddd: ${(error as Error).message}`);
    return 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
