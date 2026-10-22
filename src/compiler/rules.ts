import { join } from 'node:path';
import { sha256 } from './canonical';
import type { ResolvedConfig } from './config';
import { FRONTMATTER, parseFrontmatterData } from './changes/proposal';
import { toPosix } from './ir';

export interface Rule {
  readonly key: string;
  readonly file: string | null;
  readonly paths: readonly string[] | null;
  readonly body: string;
}

export class RuleError extends Error {
  constructor(
    readonly source: string,
    message: string,
  ) {
    super(message);
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
    '- Entidades, métodos, eventos, use-cases e operators são declarados com `@AgentEntity`, `@AgentMethod`, `@AgentEvent`, `@AgentUseCase` e `@Operator` de `@agentic-ddd/decorators`; cada regra de negócio é um `@Invariant({ id, text })` com ID estável.',
  ),
  core(
    'layers',
    '- Onde criar: `<caminho do módulo>/domain` (entidades, eventos, ports), `<caminho do módulo>/application` (use-cases, sempre com `uses`), `<caminho do módulo>/operators` (operators). A skill de dev do módulo tem os caminhos exatos.',
  ),
  core(
    'private-methods',
    '- Todo método público de entidade tem `@AgentMethod`; métodos auxiliares usam `#privado`.',
  ),
  core(
    'not-implemented',
    '- Corpo declarado e ainda não implementado usa `notImplemented()` de `@agentic-ddd/core`.',
  ),
  core(
    'coordination',
    '- Coordenação: consulte `bun run agentic status` ou `next` (ondas); execute cada item a partir de `bun run agentic packet <item>` e valide com `bun run agentic verify --item <item> --spec-hash <hash>`. `status --static` lê declarações de teste sem executá-las e nunca certifica `done`.',
  ),
  core(
    'skeleton',
    '- O sinal de esqueleto reconhece só a chamada literal `notImplemented()`; corpo vazio conta como implementado. Estado é calculado sob demanda e não entra nos arquivos gerados.',
  ),
  core(
    'tests-covers',
    '- Testes declaram o que cobrem com `covers([...ids], título)` de `@agentic-ddd/testing`.',
  ),
  core(
    'changes',
    '- Mudança de regra de negócio: escreva antes a proposta em `{{changes}}/NNNN-<slug>/proposal.md` (delta, critérios de aceite e `## Motivo`), implemente e rode `bun run agentic compile`; para mudança já feita no código, `bun run agentic compile --draft-change <slug>` gera o rascunho.',
  ),
  core(
    'done',
    '- Uma tarefa só está concluída quando `bun run agentic verify <NNNN>` retorna `done` ou `needs-human`.',
  ),
  core(
    'generated',
    '- Gerados (não edite): `{{devSkills}}`, `{{runtimeSkills}}`, os espelhos de skills e este bloco. Altere o código decorado e rode `bun run agentic compile`; o CI roda `bun run agentic compile --check`.',
  ),
];

export function fillMarkers(
  body: string,
  values: {
    changes: string;
    devSkills: string;
    runtimeSkills: string;
  },
): string {
  return body
    .replaceAll('{{changes}}', values.changes)
    .replaceAll('{{devSkills}}', values.devSkills)
    .replaceAll('{{runtimeSkills}}', values.runtimeSkills);
}

const BLOCK_MARKERS = [
  '<!-- agentic-ddd:begin -->',
  '<!-- agentic-ddd:end -->',
];

function parseRule(key: string, file: string, raw: string): Rule {
  const fail = (message: string) => new RuleError(file, `${file}: ${message}`);
  const text = raw.replaceAll('\r\n', '\n');
  const match = FRONTMATTER.exec(text);
  let paths: string[] | null = null;
  let body = text;
  if (!match && text.startsWith('---\n'))
    throw fail('frontmatter vazio ou sem o "---" de fechamento');
  if (match) {
    body = match[2]!;
    let data: Record<string, unknown>;
    try {
      data = parseFrontmatterData(match[1]!);
    } catch (error) {
      throw fail(`frontmatter YAML inválido: ${(error as Error).message}`);
    }
    for (const name of Object.keys(data))
      if (name !== 'paths')
        throw fail(
          `chave de frontmatter desconhecida "${name}" (só "paths" é aceita)`,
        );
    if ('paths' in data) {
      const value = data.paths;
      if (
        !Array.isArray(value) ||
        value.length === 0 ||
        !value.every((p) => typeof p === 'string' && p.trim() !== '')
      )
        throw fail('"paths" deve ser uma lista não vazia de globs (texto)');
      // `./app/**` nunca casaria com `app/x.ts`: normaliza como o rules.dir.
      paths = (value as string[]).map((g) => g.trim().replace(/^(\.\/)+/, ''));
      for (const glob of paths)
        if (glob.startsWith('/') || glob.split('/').includes('..'))
          throw fail(
            `o glob "${glob}" deve ser relativo à raiz e sem segmento ".."`,
          );
    }
  }
  body = body.trim();
  if (body === '') throw fail('o corpo da regra está vazio');
  if (/^#{1,6}\s/m.test(body))
    throw fail(
      'o corpo não pode ter linha de título Markdown (#); use uma lista com "- "',
    );
  for (const marker of BLOCK_MARKERS)
    if (body.includes(marker))
      throw fail(`o corpo não pode conter o marcador ${marker}`);
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
        `${file}: a chave "${rule.key}" não existe no núcleo; chaves "core/" só substituem regras do núcleo (${[...coreKeys].join(', ')})`,
      );
    if (coreKeys.has(rule.key) && rule.paths !== null)
      throw new RuleError(
        file,
        `${file}: regra que substitui "${rule.key}" não pode ter "paths"; para restringir, exclua a do núcleo em rules.exclude e use outra chave`,
      );
  }
  const known = new Set([...coreKeys, ...byKey.keys()]);
  for (const key of exclude) {
    if (byKey.has(key))
      throw new RuleError(
        'agentic.config.ts',
        `agentic.config.ts: rules.exclude lista "${key}", que também tem arquivo em ${byKey.get(key)!.file}; remova um dos dois`,
      );
    if (!known.has(key))
      throw new RuleError(
        'agentic.config.ts',
        `agentic.config.ts: rules.exclude lista "${key}", que não existe (chaves do núcleo: ${[...coreKeys].join(', ')})`,
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

export async function loadRules(config: ResolvedConfig): Promise<Rule[]> {
  const cwd = join(config.root, config.rules.dir);
  const team: Rule[] = [];
  const files: string[] = [];
  try {
    for await (const rel of new Bun.Glob('**/*.md').scan({
      cwd,
      onlyFiles: true,
    }))
      files.push(toPosix(rel));
  } catch (error) {
    // Pasta inexistente = nenhuma regra do time.
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT')
      throw new RuleError(
        config.rules.dir,
        `${config.rules.dir}: não foi possível ler a pasta de regras (${code ?? (error as Error).message})`,
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
