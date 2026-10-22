import { stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { toPosix } from './ir';
import { DEFAULT_OUT, type OutputPaths } from './render/index';

/** Sub-orçamento padrão das regras do time no brief (ADR-0005 D4). */
export const DEFAULT_RULES_MAX_TOKENS = 2000;

export interface ModuleConfig {
  readonly name: string;
  readonly path: string;
}

export interface VerifyConfig {
  readonly test?: readonly string[];
  readonly commands?: Readonly<Record<string, readonly string[]>>;
}

export interface RulesConfig {
  readonly dir?: string;
  readonly exclude?: readonly string[];
  readonly briefMaxTokens?: number;
}

export interface AgenticConfig {
  readonly root?: string;
  readonly modules: readonly ModuleConfig[];
  readonly out?: Partial<OutputPaths>;
  readonly mirrors?: readonly string[];
  readonly changes?: string;
  readonly verify?: VerifyConfig;
  readonly rules?: RulesConfig;
}

export interface ResolvedConfig {
  readonly root: string;
  readonly outRoot: string;
  readonly modules: readonly ModuleConfig[];
  readonly out: OutputPaths;
  readonly mirrors: readonly string[];
  readonly changesDir: string;
  readonly rules: {
    readonly dir: string;
    readonly exclude: readonly string[];
    readonly briefMaxTokens: number;
  };
  readonly verify: {
    readonly test: readonly string[];
    readonly commands: readonly {
      readonly name: string;
      readonly command: readonly string[];
    }[];
  };
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
  const names = new Set<string>();
  for (const module of config.modules) {
    if (!MODULE_NAME.test(module.name))
      throw new Error(
        `agentic.config.ts: o nome do módulo "${module.name}" deve ser kebab-case`,
      );
    if (names.has(module.name))
      throw new Error(
        `agentic.config.ts: o nome do módulo "${module.name}" está repetido`,
      );
    names.add(module.name);
  }
  const root = resolve(configDir, config.root ?? '.');
  const modulePaths = new Map<ModuleConfig, string>();
  const owners = new Map<string, string>();
  for (const module of config.modules) {
    const fromRoot = relative(root, resolve(root, module.path));
    modulePaths.set(module, toPosix(fromRoot));
    if (fromRoot === '')
      throw new Error(
        `agentic.config.ts: o módulo "${module.name}" não pode apontar para a raiz do projeto`,
      );
    if (fromRoot.startsWith('..') || isAbsolute(fromRoot))
      throw new Error(
        `agentic.config.ts: o módulo "${module.name}" não pode apontar para fora da raiz do projeto`,
      );
    const posix = toPosix(fromRoot);
    const owner = owners.get(posix);
    if (owner !== undefined)
      throw new Error(
        `agentic.config.ts: os módulos "${owner}" e "${module.name}" apontam para o mesmo caminho "${posix}"`,
      );
    owners.set(posix, module.name);
  }
  const rulesDir = toPosix(config.rules?.dir ?? '.ai/rules')
    .replace(/^(\.\/)+/, '')
    .replace(/\/+$/, '');
  const rulesFromRoot = relative(root, resolve(root, rulesDir));
  if (isAbsolute(rulesDir) || /^[A-Za-z]:/.test(rulesDir))
    throw new Error(
      'agentic.config.ts: rules.dir deve ser relativo à raiz do projeto',
    );
  if (
    rulesFromRoot === '' ||
    rulesFromRoot === '..' ||
    rulesFromRoot.startsWith('../') ||
    isAbsolute(rulesFromRoot)
  )
    throw new Error(
      'agentic.config.ts: rules.dir não pode apontar para a raiz nem para fora da raiz do projeto',
    );
  const briefMaxTokens =
    config.rules?.briefMaxTokens ?? DEFAULT_RULES_MAX_TOKENS;
  if (!Number.isInteger(briefMaxTokens) || briefMaxTokens <= 0)
    throw new Error(
      `agentic.config.ts: rules.briefMaxTokens deve ser um inteiro positivo (recebido ${String(briefMaxTokens)})`,
    );
  return {
    root,
    outRoot: overrides.outRoot ? resolve(overrides.outRoot) : root,
    modules: config.modules.map((m) => ({
      name: m.name,
      path: modulePaths.get(m)!,
    })),
    out: { ...DEFAULT_OUT, ...config.out },
    mirrors: [...(config.mirrors ?? ['.claude/skills'])],
    changesDir: toPosix(config.changes ?? 'changes')
      .replace(/^\.\//, '')
      .replace(/\/+$/, ''),
    rules: {
      dir: rulesDir,
      exclude: [...(config.rules?.exclude ?? [])],
      briefMaxTokens,
    },
    verify: {
      test: [...(config.verify?.test ?? ['bun', 'test'])],
      commands: Object.entries(
        config.verify?.commands ?? {
          typecheck: ['bun', 'run', 'typecheck'],
          lint: ['bun', 'run', 'lint'],
        },
      )
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([name, command]) => ({ name, command: [...command] })),
    },
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
