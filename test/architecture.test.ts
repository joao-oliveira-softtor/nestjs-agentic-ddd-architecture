import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const IMPORT =
  /(?:^|\n)\s*(?:import|export)\s(?:[^'"]*?\sfrom\s)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function filesIn(dir: string, { includeTests = false } = {}): string[] {
  const absolute = resolve(ROOT, dir);
  if (!existsSync(absolute)) return [];
  return [...new Bun.Glob('**/*.ts').scanSync({ cwd: absolute })]
    .map((file) => `${dir}/${file.split(sep).join('/')}`)
    .filter((file) => includeTests || !file.endsWith('.test.ts'))
    .sort();
}

function importsOf(file: string): string[] {
  const text = readFileSync(resolve(ROOT, file), 'utf8');
  return [...text.matchAll(IMPORT)].map((m) => m[1] ?? m[2]!);
}

function resolvesInto(file: string, specifier: string, dir: string): boolean {
  return (
    specifier.startsWith('.') &&
    resolve(ROOT, dirname(file), specifier).startsWith(
      `${resolve(ROOT, dir)}${sep}`,
    )
  );
}

function offenders(
  files: string[],
  allowed: (file: string, specifier: string) => boolean,
): string[] {
  return files.flatMap((file) =>
    importsOf(file)
      .filter((s) => !allowed(file, s))
      .map((s) => `${file} → ${s}`),
  );
}

describe('arquitetura', () => {
  test('o extrator de imports funciona', () => {
    expect(importsOf('src/core/aggregate-root.ts')).toEqual([
      './domain-event',
      './entity',
    ]);
  });

  test('src/core só importa zod e o próprio core', () => {
    expect(
      offenders(
        filesIn('src/core'),
        (f, s) => s === 'zod' || resolvesInto(f, s, 'src/core'),
      ),
    ).toEqual([]);
  });

  test('src/decorators só importa core, zod, reflect-metadata e node:*', () => {
    const allowed = (f: string, s: string) =>
      ['zod', 'reflect-metadata', '@agentic-ddd/core'].includes(s) ||
      s.startsWith('node:') ||
      resolvesInto(f, s, 'src/decorators');
    expect(offenders(filesIn('src/decorators'), allowed)).toEqual([]);
  });

  test('domain e application do exemplo não importam Nest nem runtime de LLM', () => {
    const files = [
      ...filesIn('examples/orders/domain'),
      ...filesIn('examples/orders/application'),
    ];
    const forbidden = (s: string) =>
      s.startsWith('@nestjs/') ||
      s === '@agentic-ddd/runtime' ||
      s === '@agentic-ddd/nestjs';
    expect(offenders(files, (_f, s) => !forbidden(s))).toEqual([]);
  });

  test('examples só importa o framework via @agentic-ddd/*', () => {
    expect(
      offenders(
        filesIn('examples', { includeTests: true }),
        (f, s) => !resolvesInto(f, s, 'src'),
      ),
    ).toEqual([]);
  });

  test('compiler e runtime não se importam', () => {
    const fromCompiler = offenders(
      filesIn('src/compiler'),
      (f, s) =>
        s !== '@agentic-ddd/runtime' && !resolvesInto(f, s, 'src/runtime'),
    );
    const fromRuntime = offenders(
      filesIn('src/runtime'),
      (f, s) =>
        s !== '@agentic-ddd/compiler' && !resolvesInto(f, s, 'src/compiler'),
    );
    expect([...fromCompiler, ...fromRuntime]).toEqual([]);
  });

  test('nenhum @Controller no repositório', () => {
    const files = [
      ...filesIn('src', { includeTests: true }),
      ...filesIn('examples', { includeTests: true }),
    ];
    expect(
      files.filter((f) =>
        readFileSync(resolve(ROOT, f), 'utf8').includes('@Controller('),
      ),
    ).toEqual([]);
  });

  test('só src/mcp e src/auth importam o SDK do MCP', () => {
    const sdk = (s: string) => s.startsWith('@modelcontextprotocol/');
    expect(
      offenders(
        filesIn('src', { includeTests: true }).filter(
          (f) => !f.startsWith('src/mcp/') && !f.startsWith('src/auth/'),
        ),
        (_f, s) => !sdk(s),
      ),
    ).toEqual([]);
  });

  test('src/mcp só importa zod, node:*, o SDK e o que o plano permite', () => {
    const allowed = (f: string, s: string) =>
      s === 'zod' ||
      s.startsWith('node:') ||
      s.startsWith('@modelcontextprotocol/') ||
      resolvesInto(f, s, 'src/mcp') ||
      /^\.\.\/compiler\/(lock|canonical|rules|snapshot|ir|config|published|conventions|graph|changes\/proposal|render\/dev-skill)$/.test(s) ||
      /^\.\.\/auth\/(resource-server|scopes)$/.test(s) ||
      s.startsWith('../contracts/');
    expect(offenders(filesIn('src/mcp'), allowed)).toEqual([]);
  });

  test('src/cli não importa src/mcp de forma estática', () => {
    const bad = filesIn('src/cli', { includeTests: true }).flatMap((file) =>
      [...readFileSync(resolve(ROOT, file), 'utf8').matchAll(IMPORT)]
        .map((m) => m[1])
        .filter((s): s is string => s !== undefined)
        .filter((s) => resolvesInto(file, s, 'src/mcp'))
        .map((s) => `${file} → ${s}`),
    );
    expect(bad).toEqual([]);
  });

  test('os diretórios governados pelas regras existem e têm arquivos', () => {
    const dirs = [
      'src/core',
      'src/decorators',
      'src/compiler',
      'examples/orders/domain',
      'examples/orders/application',
    ];
    for (const dir of dirs) {
      expect(filesIn(dir).length > 0).toBe(true);
    }
    expect(filesIn('examples', { includeTests: true }).length > 0).toBe(true);
  });
});
