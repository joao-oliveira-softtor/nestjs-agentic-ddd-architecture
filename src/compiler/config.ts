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

/** Camadas com pasta própria dentro de cada módulo. */
export type ConventionLayer = 'domain' | 'application' | 'operators';

/** Destinos que domain e application podem proibir de importar. */
export type ImportTarget = 'application' | 'operators' | 'infrastructure';

export interface ConventionsConfig {
  readonly layers?: Partial<Record<ConventionLayer, string>>;
  readonly suffixes?: { readonly events?: string; readonly operator?: string };
  readonly infrastructure?: readonly string[];
  readonly forbiddenImports?: Partial<
    Record<'domain' | 'application', readonly ImportTarget[]>
  >;
}

export interface ResolvedConventions {
  readonly layers: Readonly<Record<ConventionLayer, string>>;
  readonly suffixes: { readonly events: string; readonly operator: string };
  readonly infrastructure: readonly string[];
  readonly forbiddenImports: Readonly<
    Record<'domain' | 'application', readonly ImportTarget[]>
  >;
}

export const DEFAULT_CONVENTIONS: ResolvedConventions = {
  layers: {
    domain: 'domain',
    application: 'application',
    operators: 'operators',
  },
  suffixes: { events: '.events.ts', operator: '.operator.ts' },
  infrastructure: ['infrastructure', 'infra'],
  forbiddenImports: {
    domain: ['application', 'operators', 'infrastructure'],
    application: ['operators', 'infrastructure'],
  },
};

export interface AgenticConfig {
  readonly root?: string;
  readonly modules: readonly ModuleConfig[];
  readonly out?: Partial<OutputPaths>;
  readonly mirrors?: readonly string[];
  readonly changes?: string;
  readonly verify?: VerifyConfig;
  readonly rules?: RulesConfig;
  readonly conventions?: ConventionsConfig;
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
  // Opcional só para que testes que montam ResolvedConfig à mão continuem compilando;
  // resolveConfig sempre preenche.
  readonly conventions?: ResolvedConventions;
}

const MODULE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function checkKeys(
  value: unknown,
  path: string,
  allowed: readonly string[],
  hints: Readonly<Record<string, string>> = {},
): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`agentic.config.ts: ${path} deve ser um objeto`);
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object)) {
    if (allowed.includes(key)) continue;
    if (Object.hasOwn(hints, key))
      throw new Error(
        `agentic.config.ts: ${path}.${key} não é válido: ${hints[key]}`,
      );
    throw new Error(
      `agentic.config.ts: ${path}.${key} não existe; as chaves válidas em ${path} são: ${allowed.join(', ')}`,
    );
  }
  return object;
}

function folderName(value: unknown, path: string): string {
  if (typeof value !== 'string')
    throw new Error(`agentic.config.ts: ${path} deve ser um texto`);
  if (value === '' || value === '.' || value === '..' || /[/\\]/.test(value))
    throw new Error(
      `agentic.config.ts: ${path} "${value}" deve ser o nome de uma pasta só dentro do módulo; layout aninhado se faz por modules[].path`,
    );
  return value;
}

function suffixName(value: unknown, path: string): string {
  if (typeof value !== 'string')
    throw new Error(`agentic.config.ts: ${path} deve ser um texto`);
  if (
    !value.startsWith('.') ||
    value === '.ts' ||
    !value.endsWith('.ts') ||
    /[/\\]/.test(value)
  )
    throw new Error(
      `agentic.config.ts: ${path} "${value}" deve começar com "." e terminar em ".ts" (ex.: ".events.ts"), sem "/" nem "\\"`,
    );
  return value;
}

function stringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
    throw new Error(`agentic.config.ts: ${path} deve ser uma lista de textos`);
  return [...value];
}

function importTargets(value: unknown, path: string): ImportTarget[] {
  const allowed: readonly string[] = [
    'application',
    'operators',
    'infrastructure',
  ] satisfies ImportTarget[];
  return stringList(value, path).map((target) => {
    if (!allowed.includes(target))
      throw new Error(
        `agentic.config.ts: ${path} aceita só application, operators ou infrastructure (recebido "${target}")`,
      );
    return target as ImportTarget;
  });
}

function resolveConventions(input: unknown): ResolvedConventions {
  const root = checkKeys(
    input,
    'conventions',
    Object.keys(DEFAULT_CONVENTIONS),
  );
  const layersIn = checkKeys(
    root.layers,
    'conventions.layers',
    Object.keys(DEFAULT_CONVENTIONS.layers),
  );
  const suffixesIn = checkKeys(
    root.suffixes,
    'conventions.suffixes',
    Object.keys(DEFAULT_CONVENTIONS.suffixes),
  );
  const forbiddenIn = checkKeys(
    root.forbiddenImports,
    'conventions.forbiddenImports',
    Object.keys(DEFAULT_CONVENTIONS.forbiddenImports),
    {
      operators:
        'operators não tem regra de import; só domain e application têm',
    },
  );

  const layer = (key: ConventionLayer): string =>
    layersIn[key] === undefined
      ? DEFAULT_CONVENTIONS.layers[key]
      : folderName(layersIn[key], `conventions.layers.${key}`);
  const layers = {
    domain: layer('domain'),
    application: layer('application'),
    operators: layer('operators'),
  };

  const suffix = (key: 'events' | 'operator'): string =>
    suffixesIn[key] === undefined
      ? DEFAULT_CONVENTIONS.suffixes[key]
      : suffixName(suffixesIn[key], `conventions.suffixes.${key}`);
  const events = suffix('events');
  const operator = suffix('operator');
  if (events === operator)
    throw new Error(
      `agentic.config.ts: conventions.suffixes.events e conventions.suffixes.operator não podem ser iguais ("${events}")`,
    );

  const infrastructure =
    root.infrastructure === undefined
      ? [...DEFAULT_CONVENTIONS.infrastructure]
      : stringList(root.infrastructure, 'conventions.infrastructure').map(
          (item) => folderName(item, 'conventions.infrastructure'),
        );
  if (infrastructure.length === 0)
    throw new Error(
      'agentic.config.ts: conventions.infrastructure não pode ser vazio; informe ao menos uma pasta',
    );

  const forbidden = (key: 'domain' | 'application'): ImportTarget[] =>
    forbiddenIn[key] === undefined
      ? [...DEFAULT_CONVENTIONS.forbiddenImports[key]]
      : importTargets(forbiddenIn[key], `conventions.forbiddenImports.${key}`);

  // Uma pasta só pode servir a uma camada ou a um item de infrastructure.
  const folders = new Map<string, string>();
  const claims: [string, string][] = [
    ['conventions.layers.domain', layers.domain],
    ['conventions.layers.application', layers.application],
    ['conventions.layers.operators', layers.operators],
    ...infrastructure.map((name, i): [string, string] => [
      `conventions.infrastructure[${i}]`,
      name,
    ]),
  ];
  for (const [where, name] of claims) {
    const first = folders.get(name);
    if (first !== undefined)
      throw new Error(
        `agentic.config.ts: a pasta "${name}" aparece mais de uma vez (${first} e ${where})`,
      );
    folders.set(name, where);
  }

  return {
    layers,
    suffixes: { events, operator },
    infrastructure,
    forbiddenImports: {
      domain: forbidden('domain'),
      application: forbidden('application'),
    },
  };
}

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
    conventions: resolveConventions(config.conventions),
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
