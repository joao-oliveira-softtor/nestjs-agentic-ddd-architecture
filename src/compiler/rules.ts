import { realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { sha256 } from './canonical';
import type { ResolvedConfig } from './config';
import { DEFAULT_CONVENTIONS, type ResolvedConventions } from './conventions';
import { FRONTMATTER, parseFrontmatterData } from './changes/proposal';
import { AgenticError, toPosix, type ErrorCode } from './ir';

export interface Rule {
  readonly key: string;
  readonly file: string | null;
  readonly paths: readonly string[] | null;
  readonly body: string;
}

export class RuleError extends AgenticError {
  constructor(
    readonly source: string,
    code: ErrorCode,
    message: string,
  ) {
    super(code, message);
    this.name = 'RuleError';
  }
}

const core = (key: string, body: string): Rule => ({
  key: `core/${key}`,
  file: null,
  paths: null,
  body,
});

export const CORE_RULES: readonly Rule[] = [
  core(
    'decorators',
    '- Entities, methods, events, use-cases and operators are declared with `@AgentEntity`, `@AgentMethod`, `@AgentEvent`, `@AgentUseCase` and `@Operator` from `@agentic-ddd/decorators`; each business rule is an `@Invariant({ id, text })` with a stable ID.',
  ),
  core(
    'layers',
    "- Where to create: `<module path>/{{layer.domain}}` (entities, events, ports), `<module path>/{{layer.application}}` (use-cases, always with `uses`), `<module path>/{{layer.operators}}` (operators). The module's dev skill has the exact paths.",
  ),
  core(
    'private-methods',
    '- Every public entity method has `@AgentMethod`; helper methods use `#private`.',
  ),
  core(
    'not-implemented',
    '- A declared body that is not implemented yet uses `notImplemented()` from `@agentic-ddd/core`.',
  ),
  core(
    'coordination',
    '- Coordination: check `bun run agentic status` or `next` (waves); run each item from `bun run agentic packet <item>` and validate it with `bun run agentic verify --item <item> --spec-hash <hash>`. `status --static` reads test declarations without running them and never certifies `done`.',
  ),
  core(
    'skeleton',
    '- The skeleton signal only recognizes the literal `notImplemented()` call; an empty body counts as implemented. State is computed on demand and is not written into generated files.',
  ),
  core(
    'tests-covers',
    '- Tests declare what they cover with `covers([...ids], title)` from `@agentic-ddd/testing`.',
  ),
  core(
    'changes',
    '- Business rule change: first write the proposal in `{{changes}}/NNNN-<slug>/proposal.md` (delta, acceptance criteria and a `## Motivo` section), implement it and run `bun run agentic compile`; for a change already made in the code, `bun run agentic compile --draft-change <slug>` generates the draft.',
  ),
  core(
    'done',
    '- A task is only complete when `bun run agentic verify <NNNN>` returns `done` or `needs-human`.',
  ),
  core(
    'generated',
    '- Generated (do not edit): `{{devSkills}}`, `{{runtimeSkills}}`, the skill mirrors and this block. Change the decorated code and run `bun run agentic compile`; CI runs `bun run agentic compile --check`.',
  ),
];

export function fillMarkers(
  body: string,
  values: {
    changes: string;
    devSkills: string;
    runtimeSkills: string;
    layers?: ResolvedConventions['layers'];
  },
): string {
  const layers = values.layers ?? DEFAULT_CONVENTIONS.layers;
  return body
    .replaceAll('{{changes}}', values.changes)
    .replaceAll('{{devSkills}}', values.devSkills)
    .replaceAll('{{runtimeSkills}}', values.runtimeSkills)
    .replaceAll('{{layer.domain}}', layers.domain)
    .replaceAll('{{layer.application}}', layers.application)
    .replaceAll('{{layer.operators}}', layers.operators);
}

const BLOCK_MARKERS = [
  '<!-- agentic-ddd:begin -->',
  '<!-- agentic-ddd:end -->',
];

function parseRule(key: string, file: string, raw: string): Rule {
  const fail = (code: ErrorCode, message: string) =>
    new RuleError(file, code, `${file}: ${message}`);
  const text = raw.replaceAll('\r\n', '\n');
  const match = FRONTMATTER.exec(text);
  let paths: string[] | null = null;
  let body = text;
  if (!match && text.startsWith('---\n'))
    throw fail(
      'rules.frontmatter-unclosed',
      'frontmatter is empty or missing the closing "---"',
    );
  if (match) {
    body = match[2]!;
    let data: Record<string, unknown>;
    try {
      data = parseFrontmatterData(match[1]!);
    } catch (error) {
      throw fail(
        'rules.frontmatter-invalid',
        `invalid YAML frontmatter: ${(error as Error).message}`,
      );
    }
    for (const name of Object.keys(data))
      if (name !== 'paths')
        throw fail(
          'rules.frontmatter-key-unknown',
          `unknown frontmatter key "${name}" (only "paths" is accepted)`,
        );
    if ('paths' in data) {
      const value = data.paths;
      if (
        !Array.isArray(value) ||
        value.length === 0 ||
        !value.every((p) => typeof p === 'string' && p.trim() !== '')
      )
        throw fail(
          'rules.paths-invalid',
          '"paths" must be a non-empty list of globs (strings)',
        );
      // `./app/**` would never match `app/x.ts`: normalize it like rules.dir.
      paths = (value as string[]).map((g) => g.trim().replace(/^(\.\/)+/, ''));
      for (const glob of paths)
        if (glob.startsWith('/') || glob.split('/').includes('..'))
          throw fail(
            'rules.glob-invalid',
            `the glob "${glob}" must be relative to the root and have no ".." segment`,
          );
    }
  }
  body = body.trim();
  if (body === '') throw fail('rules.body-empty', 'the rule body is empty');
  if (/^#{1,6}\s/m.test(body))
    throw fail(
      'rules.body-heading',
      'the body cannot have a Markdown heading line (#); use a "- " list',
    );
  // Bodies are concatenated without a blank line: a paragraph after a `- ` item
  // would become its continuation.
  if (!body.startsWith('- '))
    throw fail(
      'rules.body-not-list',
      'the body must start with a "- " list item',
    );
  for (const marker of BLOCK_MARKERS)
    if (body.includes(marker))
      throw fail(
        'rules.body-marker',
        `the body cannot contain the marker ${marker}`,
      );
  return { key, file, paths, body };
}

export function composeRules(team: Rule[], exclude: readonly string[]): Rule[] {
  const coreKeys = new Set(CORE_RULES.map((r) => r.key));
  const byKey = new Map(team.map((r) => [r.key, r]));
  for (const rule of team) {
    const file = rule.file ?? rule.key;
    if (rule.key.startsWith('core/') && !coreKeys.has(rule.key))
      throw new RuleError(
        file,
        'rules.core-key-unknown',
        `${file}: the key "${rule.key}" does not exist in the core; "core/" keys only replace core rules (${[...coreKeys].join(', ')})`,
      );
    if (coreKeys.has(rule.key) && rule.paths !== null)
      throw new RuleError(
        file,
        'rules.core-paths',
        `${file}: a rule that replaces "${rule.key}" cannot have "paths"; to restrict it, exclude the core rule in rules.exclude and use another key`,
      );
  }
  const known = new Set([...coreKeys, ...byKey.keys()]);
  for (const key of exclude) {
    if (byKey.has(key))
      throw new RuleError(
        'agentic.config.ts',
        'rules.exclude-conflict',
        `agentic.config.ts: rules.exclude lists "${key}", which also has a file at ${byKey.get(key)!.file}; remove one of them`,
      );
    if (!known.has(key))
      throw new RuleError(
        'agentic.config.ts',
        'rules.exclude-unknown',
        `agentic.config.ts: rules.exclude lists "${key}", which does not exist (core keys: ${[...coreKeys].join(', ')})`,
      );
  }
  const dropped = new Set(exclude);
  const ordered = [
    ...CORE_RULES.map((r) => byKey.get(r.key) ?? r),
    ...team
      .filter((r) => !coreKeys.has(r.key))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  ];
  return ordered.filter((r) => !dropped.has(r.key));
}

// A missing folder means no team rules.
export async function ruleFiles(cwd: string): Promise<string[]> {
  const files: string[] = [];
  try {
    for await (const rel of new Bun.Glob('**/*.md').scan({
      cwd,
      onlyFiles: true,
    }))
      files.push(toPosix(rel));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return files;
}

export async function loadRules(config: ResolvedConfig): Promise<Rule[]> {
  const cwd = join(config.root, config.rules.dir);
  const team: Rule[] = [];
  const files: string[] = [];
  // The config only validates the path as text; a link (in the folder or in a
  // parent) can point outside the project and bring foreign text into AGENTS.md and the briefs.
  const real = await realpath(cwd).catch(() => null);
  if (real !== null) {
    // Same rule as rules.dir in config.ts: neither the root (the scan would read the
    // repository) nor outside it; `..regras` is a valid name.
    const inside = toPosix(relative(await realpath(config.root), real));
    if (
      inside === '' ||
      inside === '..' ||
      inside.startsWith('../') ||
      isAbsolute(inside)
    )
      throw new RuleError(
        config.rules.dir,
        'rules.dir-outside',
        `${config.rules.dir}: the rules folder points to the root or outside the project root (${real})`,
      );
  }
  try {
    files.push(...(await ruleFiles(cwd)));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new RuleError(
      config.rules.dir,
      'rules.dir-unreadable',
      `${config.rules.dir}: could not read the rules folder (${code ?? (error as Error).message})`,
    );
  }
  for (const posix of files)
    team.push(
      parseRule(
        posix.slice(0, -'.md'.length),
        `${config.rules.dir}/${posix}`,
        await Bun.file(join(cwd, posix)).text(),
      ),
    );
  return composeRules(team, config.rules.exclude);
}

export function rulesFor(
  rules: readonly Rule[],
  files: readonly string[],
): Rule[] {
  return rules.filter(
    (rule) =>
      rule.paths === null ||
      rule.paths.some((glob) => {
        const matcher = new Bun.Glob(glob);
        return files.some((file) => matcher.match(file));
      }),
  );
}

export function briefRules(
  rules: readonly Rule[],
  files: readonly string[],
): Rule[] {
  return rulesFor(rules, files).filter((r) => r.file !== null);
}

export function ruleHash(rule: Rule): string {
  return sha256(rule.body).slice(0, 12);
}
