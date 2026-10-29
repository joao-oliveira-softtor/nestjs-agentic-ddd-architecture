import { stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isSecureOrLoopbackUrl } from '../contracts/url';
import {
  DEFAULT_CONVENTIONS,
  type ConventionLayer,
  type ConventionsConfig,
  type ImportTarget,
  type ResolvedConventions,
} from './conventions';
import { AgenticError, canonicalPath, toPosix } from './ir';
import { DEFAULT_OUT, type OutputPaths } from './render/index';

export {
  DEFAULT_CONVENTIONS,
  type ConventionLayer,
  type ConventionsConfig,
  type ImportTarget,
  type ResolvedConventions,
};

/** Default token sub-budget for the team rules in the brief (ADR-0005 D4). */
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

export interface McpConfig {
  /** Authorization server issuer; tokens must carry exactly this `iss`. */
  readonly issuer: string;
  /** Resource identifier (RFC 8707) that tokens must carry in `aud`. */
  readonly resource: string;
  readonly jwksUri?: string;
}

export interface AgenticConfig {
  readonly root?: string;
  readonly modules: readonly ModuleConfig[];
  readonly out?: Partial<OutputPaths>;
  readonly mirrors?: readonly string[];
  readonly changes?: string;
  readonly verify?: VerifyConfig;
  readonly rules?: RulesConfig;
  readonly conventions?: ConventionsConfig;
  readonly mcp?: McpConfig;
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
  // Optional only so tests that build ResolvedConfig by hand keep compiling;
  // resolveConfig always fills it in.
  readonly conventions?: ResolvedConventions;
  readonly mcp?: McpConfig;
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
    throw new AgenticError(
      'config.not-object',
      `agentic.config.ts: ${path} must be an object`,
    );
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object)) {
    if (allowed.includes(key)) continue;
    if (Object.hasOwn(hints, key))
      throw new AgenticError(
        'config.key-invalid',
        `agentic.config.ts: ${path}.${key} is not valid: ${hints[key]}`,
      );
    throw new AgenticError(
      'config.key-unknown',
      `agentic.config.ts: ${path}.${key} does not exist; the valid keys in ${path} are: ${allowed.join(', ')}`,
    );
  }
  return object;
}

function folderName(value: unknown, path: string, nested = true): string {
  if (typeof value !== 'string')
    throw new AgenticError(
      'config.not-text',
      `agentic.config.ts: ${path} must be a string`,
    );
  if (value === '' || value === '.' || value === '..' || /[/\\]/.test(value))
    throw new AgenticError(
      'config.folder-invalid',
      `agentic.config.ts: ${path} "${value}" must be a single folder name inside the module${nested ? '; nested layouts are set through modules[].path' : ''}`,
    );
  return value;
}

function suffixName(value: unknown, path: string): string {
  if (typeof value !== 'string')
    throw new AgenticError(
      'config.not-text',
      `agentic.config.ts: ${path} must be a string`,
    );
  if (/\.(test|spec|d)\.ts$/.test(value) || value.includes('..'))
    throw new AgenticError(
      'config.suffix-test-file',
      `agentic.config.ts: ${path} "${value}" cannot end in ".test.ts", ".spec.ts" or ".d.ts" (test or declaration file) nor contain an empty segment ("..")`,
    );
  if (
    !value.startsWith('.') ||
    value === '.ts' ||
    !value.endsWith('.ts') ||
    /[/\\]/.test(value)
  )
    throw new AgenticError(
      'config.suffix-format',
      `agentic.config.ts: ${path} "${value}" must start with "." and end in ".ts" (e.g. ".events.ts"), with no "/" or "\\"`,
    );
  return value;
}

function stringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
    throw new AgenticError(
      'config.not-text-list',
      `agentic.config.ts: ${path} must be a list of strings`,
    );
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
      throw new AgenticError(
        'config.import-target-invalid',
        `agentic.config.ts: ${path} only accepts application, operators or infrastructure (received "${target}")`,
      );
    return target as ImportTarget;
  });
}

const MCP_KEYS = ['issuer', 'resource', 'jwksUri'];

// Returns the value as written: URL.href would add a trailing slash to a bare origin,
// and the issuer must match the token's iss exactly.
function mcpUrl(value: unknown, path: string, noQuery = false): string {
  if (typeof value !== 'string')
    throw new AgenticError(
      'config.not-text',
      `agentic.config.ts: ${path} must be a string`,
    );
  const fail = (rule: string) =>
    new AgenticError(
      'config.mcp-url-invalid',
      `agentic.config.ts: ${path} "${value}" ${rule}`,
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw fail('must be an absolute https: URL');
  }
  if (!isSecureOrLoopbackUrl(url))
    throw fail(
      'must be an absolute https: URL (http: only for loopback hosts: 127.0.0.0/8, localhost or [::1])',
    );
  if (url.hash !== '') throw fail('must not have a fragment');
  if (noQuery && url.search !== '') throw fail('must not have a query');
  return value;
}

function resolveMcp(input: unknown): McpConfig {
  const section = checkKeys(input, 'mcp', MCP_KEYS);
  if (section.issuer === undefined || section.resource === undefined)
    throw new AgenticError(
      'config.mcp-field-missing',
      'agentic.config.ts: mcp is configured without issuer or resource; set both',
    );
  return {
    issuer: mcpUrl(section.issuer, 'mcp.issuer', true),
    resource: mcpUrl(section.resource, 'mcp.resource'),
    jwksUri:
      section.jwksUri === undefined
        ? undefined
        : mcpUrl(section.jwksUri, 'mcp.jwksUri'),
  };
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
      operators: 'operators has no import rule; only domain and application do',
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
    throw new AgenticError(
      'config.suffix-duplicate',
      `agentic.config.ts: conventions.suffixes.events and conventions.suffixes.operator cannot be equal ("${events}")`,
    );

  const infrastructure =
    root.infrastructure === undefined
      ? [...DEFAULT_CONVENTIONS.infrastructure]
      : stringList(root.infrastructure, 'conventions.infrastructure').map(
          (item, i) =>
            folderName(item, `conventions.infrastructure[${i}]`, false),
        );
  if (infrastructure.length === 0)
    throw new AgenticError(
      'config.infrastructure-empty',
      'agentic.config.ts: conventions.infrastructure cannot be empty; list at least one folder',
    );

  const forbidden = (key: 'domain' | 'application'): ImportTarget[] =>
    forbiddenIn[key] === undefined
      ? [...DEFAULT_CONVENTIONS.forbiddenImports[key]]
      : importTargets(forbiddenIn[key], `conventions.forbiddenImports.${key}`);

  // A folder can serve only one layer or one infrastructure entry.
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
      throw new AgenticError(
        'config.folder-duplicate',
        `agentic.config.ts: the folder "${name}" appears more than once (${first} and ${where})`,
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
    throw new AgenticError(
      'config.modules-empty',
      'agentic.config.ts: modules must list at least one module',
    );
  }
  const names = new Set<string>();
  for (const module of config.modules) {
    if (!MODULE_NAME.test(module.name))
      throw new AgenticError(
        'config.module-name-invalid',
        `agentic.config.ts: the module name "${module.name}" must be kebab-case`,
      );
    if (names.has(module.name))
      throw new AgenticError(
        'config.module-duplicate',
        `agentic.config.ts: the module name "${module.name}" is duplicated`,
      );
    names.add(module.name);
  }
  const root = canonicalPath(resolve(configDir, config.root ?? '.'));
  const modulePaths = new Map<ModuleConfig, string>();
  const owners = new Map<string, string>();
  for (const module of config.modules) {
    const fromRoot = relative(root, resolve(root, module.path));
    modulePaths.set(module, toPosix(fromRoot));
    if (fromRoot === '')
      throw new AgenticError(
        'config.module-root',
        `agentic.config.ts: the module "${module.name}" cannot point to the project root`,
      );
    if (fromRoot.startsWith('..') || isAbsolute(fromRoot))
      throw new AgenticError(
        'config.module-outside',
        `agentic.config.ts: the module "${module.name}" cannot point outside the project root`,
      );
    const posix = toPosix(fromRoot);
    const owner = owners.get(posix);
    if (owner !== undefined)
      throw new AgenticError(
        'config.module-path-duplicate',
        `agentic.config.ts: the modules "${owner}" and "${module.name}" point to the same path "${posix}"`,
      );
    owners.set(posix, module.name);
  }
  const rulesDir = toPosix(config.rules?.dir ?? '.ai/rules')
    .replace(/^(\.\/)+/, '')
    .replace(/\/+$/, '');
  const rulesFromRoot = toPosix(relative(root, resolve(root, rulesDir)));
  if (isAbsolute(rulesDir) || /^[A-Za-z]:/.test(rulesDir))
    throw new AgenticError(
      'config.rules-dir-absolute',
      'agentic.config.ts: rules.dir must be relative to the project root',
    );
  if (
    rulesFromRoot === '' ||
    rulesFromRoot === '..' ||
    rulesFromRoot.startsWith('../') ||
    isAbsolute(rulesFromRoot)
  )
    throw new AgenticError(
      'config.rules-dir-outside',
      'agentic.config.ts: rules.dir cannot point to the root or outside the project root',
    );
  const briefMaxTokens =
    config.rules?.briefMaxTokens ?? DEFAULT_RULES_MAX_TOKENS;
  if (!Number.isInteger(briefMaxTokens) || briefMaxTokens <= 0)
    throw new AgenticError(
      'config.brief-tokens-invalid',
      `agentic.config.ts: rules.briefMaxTokens must be a positive integer (received ${String(briefMaxTokens)})`,
    );
  return {
    root,
    outRoot: overrides.outRoot
      ? canonicalPath(resolve(overrides.outRoot))
      : root,
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
    mcp: config.mcp === undefined ? undefined : resolveMcp(config.mcp),
  };
}

export async function loadConfig(
  configPath: string,
  overrides: { outRoot?: string } = {},
): Promise<ResolvedConfig> {
  // Root 8.3 would import the domain by another path, with another registry instance.
  const absolute = canonicalPath(resolve(configPath));
  const loaded = (await import(pathToFileURL(absolute).href)) as {
    default?: AgenticConfig;
  };
  if (!loaded.default)
    throw new AgenticError(
      'config.default-export-missing',
      `${configPath}: expected export default defineConfig({ modules: [...] })`,
    );
  const config = resolveConfig(loaded.default, dirname(absolute), overrides);
  // The existence check lives here (not in resolveConfig) so that
  // resolveConfig stays pure, with no I/O.
  for (const module of config.modules) {
    const info = await stat(resolve(config.root, module.path)).catch(
      () => null,
    );
    if (info === null || !info.isDirectory())
      throw new AgenticError(
        'config.module-path-missing',
        `agentic.config.ts: the path "${module.path}" of the module "${module.name}" does not exist or is not a directory`,
      );
  }
  return config;
}
