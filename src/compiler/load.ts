import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ResolvedConfig } from './config.js';
import { toPosix } from './ir.js';

const SKIPPED_DIR = /(^|\/)(test|__fixtures__|__snapshots__)\//;
const SKIPPED_FILE = /\.(test|spec)\.ts$|\.d\.ts$/;

export async function importModules(config: ResolvedConfig): Promise<string[]> {
  const files: string[] = [];
  for (const module of config.modules) {
    const cwd = join(config.root, module.path);
    for await (const rel of new Bun.Glob('**/*.ts').scan({
      cwd,
      onlyFiles: true,
    })) {
      const posix = toPosix(rel);
      if (SKIPPED_DIR.test(posix) || SKIPPED_FILE.test(posix)) continue;
      files.push(join(cwd, rel));
    }
  }
  files.sort();
  for (const file of files) await import(pathToFileURL(file).href);
  return files;
}
