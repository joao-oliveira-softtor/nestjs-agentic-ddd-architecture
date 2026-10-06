import { stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { toPosix } from './ir.js';
import { DEFAULT_OUT, type OutputPaths } from './render/index.js';

export interface ModuleConfig {
  readonly name: string;
  readonly path: string;
}

export interface AgenticConfig {
  readonly root?: string;
  readonly modules: readonly ModuleConfig[];
  readonly out?: Partial<OutputPaths>;
  readonly mirrors?: readonly string[];
}

export interface ResolvedConfig {
  readonly root: string;
  readonly outRoot: string;
  readonly modules: readonly ModuleConfig[];
  readonly out: OutputPaths;
  readonly mirrors: readonly string[];
}

const MODULE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function defineConfig(config: AgenticConfig): AgenticConfig {
  return config;
}

export function resolveConfig(
  config: AgenticConfig,
  configDir: string,
  overrides: { outRoot?: string } = {},
): ResolvedConfig {
  if (!Array.isArray(config.modules) || config.modules.length === 0) {
    throw new Error(
      'agentic.config.ts: modules precisa listar ao menos um módulo',
    );
  }
  for (const module of config.modules) {
    if (!MODULE_NAME.test(module.name))
      throw new Error(
        `agentic.config.ts: o nome do módulo "${module.name}" deve ser kebab-case`,
      );
  }
  const root = resolve(configDir, config.root ?? '.');
  for (const module of config.modules) {
    const fromRoot = relative(root, resolve(root, module.path));
    if (fromRoot === '')
      throw new Error(
        `agentic.config.ts: o módulo "${module.name}" não pode apontar para a raiz do projeto`,
      );
    if (fromRoot.startsWith('..') || isAbsolute(fromRoot))
      throw new Error(
        `agentic.config.ts: o módulo "${module.name}" não pode apontar para fora da raiz do projeto`,
      );
  }
  return {
    root,
    outRoot: overrides.outRoot ? resolve(overrides.outRoot) : root,
    modules: config.modules.map((m) => ({
      name: m.name,
      path: toPosix(m.path).replace(/^\.\//, '').replace(/\/+$/, ''),
    })),
    out: { ...DEFAULT_OUT, ...config.out },
    mirrors: [...(config.mirrors ?? ['.claude/skills'])],
  };
}

export async function loadConfig(
  configPath: string,
  overrides: { outRoot?: string } = {},
): Promise<ResolvedConfig> {
  const absolute = resolve(configPath);
  const loaded = (await import(pathToFileURL(absolute).href)) as {
    default?: AgenticConfig;
  };
  if (!loaded.default)
    throw new Error(
      `${configPath}: esperado export default defineConfig({ modules: [...] })`,
    );
  const config = resolveConfig(loaded.default, dirname(absolute), overrides);
  // A checagem de existência fica aqui (e não em resolveConfig) para que
  // resolveConfig continue puro, sem I/O.
  for (const module of config.modules) {
    const info = await stat(resolve(config.root, module.path)).catch(
      () => null,
    );
    if (info === null || !info.isDirectory())
      throw new Error(
        `agentic.config.ts: o caminho "${module.path}" do módulo "${module.name}" não existe ou não é um diretório`,
      );
  }
  return config;
}
