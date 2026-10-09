import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { manifestSchema } from './contracts';
import { runEvaluation } from './run';
const usage =
  'Uso: bun run evals --config <manifest.json> --out <diretório externo inexistente> [--real]';
export async function main(
  argv: readonly string[],
  dependencies: { run?: typeof runEvaluation } = {},
): Promise<number> {
  let config: string | undefined,
    out: string | undefined,
    real = false;
  try {
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === '--real') {
        if (real) throw Error('Duplicate --real');
        real = true;
      } else if (arg === '--config' || arg === '--out') {
        const value = argv[++i];
        if (!value || value.startsWith('--')) throw Error('Missing flag value');
        if (arg === '--config') {
          if (config) throw Error('Duplicate --config');
          config = value;
        } else {
          if (out) throw Error('Duplicate --out');
          out = value;
        }
      } else if (arg === '--help' && argv.length === 1) {
        console.log(usage);
        return 0;
      } else throw Error(`Unknown argument: ${arg}`);
    }
    if (!config || !out) throw Error(usage);
    const manifest = manifestSchema.parse(
      JSON.parse(await readFile(resolve(config), 'utf8')),
    );
    if (!real && manifest.configurations.some((c) => c.adapter !== 'scripted'))
      throw Error('Adapters reais exigem --real');
    const controller = new AbortController();
    let interrupted = false;
    const sigint = () => {
      interrupted = true;
      controller.abort('SIGINT');
    };
    const sigterm = () => controller.abort('SIGTERM');
    process.on('SIGINT', sigint);
    process.on('SIGTERM', sigterm);
    try {
      const report = await (dependencies.run ?? runEvaluation)(manifest, {
        outDir: resolve(out),
        real,
        signal: controller.signal,
      });
      console.log(
        `Avaliação ${report.status}; relatório: ${resolve(out, 'report.md')}`,
      );
      return interrupted ? 130 : report.status === 'completed' ? 0 : 1;
    } catch (error) {
      console.error(String(error));
      return interrupted ? 130 : 1;
    } finally {
      process.off('SIGINT', sigint);
      process.off('SIGTERM', sigterm);
    }
  } catch (error) {
    console.error(String(error));
    return 2;
  }
}
if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
