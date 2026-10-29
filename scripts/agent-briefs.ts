import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { match, P } from 'ts-pattern';
import {
  DEFAULT_RULES_MAX_TOKENS,
  approxTokens,
  briefRules,
  loadConfig,
  loadRules,
  type Rule,
} from '@agentic-ddd/compiler';
import { isClassScopeItem } from '../src/compiler/packet';

export type BriefRole =
  'domain' | 'application' | 'infrastructure' | 'reviewer';
export interface PacketFacts {
  readonly id: string;
  readonly layer: string;
  readonly module: string;
  readonly sourcePath: string;
  readonly specHash: string;
}
export interface BriefSection {
  readonly title: string;
  readonly content: string;
}
export interface BriefInput {
  readonly packet: string;
  /** specHash do packet original; diverge do packet recebido → erro. */
  readonly expectedSpecHash?: string;
  /** Conteúdo fora do packet. Fica em seção própria, com hash próprio. */
  readonly extras?: readonly BriefSection[];
  readonly maxTokens?: number;
  /** Regras do time já filtradas (briefRules). */
  readonly rules?: readonly Rule[];
  readonly rulesMaxTokens?: number;
}

export const DEFAULT_MAX_TOKENS = 6000;
export const DEFAULT_OUT = '.agentic-tasks/briefs';
/** Caminhos escritos pelo compilador ou pelo instalador; briefs não entram aqui. */
export const GENERATED_PATHS = [
  '.agents/skills',
  '.agentic',
  '.claude/skills',
  '.claude/agents',
  '.cursor',
  '.codex',
] as const;

const RESPONSE_FORMAT =
  'Final answer: only a JSON object, no prose, in the format of the example: `{"item":"entity:Order","specHash":"<packet hash>","status":"done","verifyExitCode":0,"changedFiles":["examples/orders/domain/order.ts"],"findings":[]}`. `status` is `done`, `blocked` or `failed`. `specHash` is the packet hash, never recomputed.';

/** Fonte única do núcleo de domínio: a referência autoral da skill. */
export const DOMAIN_CORE = resolve(
  import.meta.dir,
  '../skills/agentic-ddd/references/executor-domain.md',
);

/** Fonte única do núcleo do revisor. */
export const REVIEWER_CORE = resolve(
  import.meta.dir,
  '../skills/agentic-ddd/references/reviewer.md',
);

export const ROLE_CORES: Readonly<Record<BriefRole, string>> = {
  domain: readFileSync(DOMAIN_CORE, 'utf8').trimEnd(),
  application: [
    '# Role: application executor',
    '',
    'Implement ONE application or operator item from the packet below. Use the declared contracts of its dependencies (domain methods and entities), without editing them.',
    '',
    '- Change only the inside of the body given under "Files" and test files. Keep imports, signatures, decorators, schemas, rule IDs, proposals, configuration and generated files.',
    '- Keep the line count of the body (the `source` coordinates go into the generated files). Do not reformat the file.',
    '- Compose only the dependencies listed in `uses`/`Dependencies`; emitted events are the declared ones. Do not change the domain: if a dependency contradicts the contract, return the item.',
    '- A declarative operator is already implemented: add only tests that exercise its tools and contracts.',
    '- Cover each packet obligation with `covers([...ids], title)` from `@agentic-ddd/testing` in `bun:test` tests.',
    '- Keep identifiers, rule IDs and business text exactly as written; never translate them.',
    '- Do not run `compile` or change the hash. Pending dependency, hash mismatch or a need for infrastructure outside the contract: return the item.',
    '- A team rule never beats a gate (verify, specHash, boundary gates, `covers` obligations): on conflict, follow the gate and return the item describing the conflict.',
    '- After two corrections without progress on the findings, stop and return the diagnosis.',
    '',
    RESPONSE_FORMAT,
  ].join('\n'),
  infrastructure: [
    '# Role: infrastructure executor',
    '',
    'Implement ONE adapter (a class that implements a port) from the packet below. The port and its methods are the contract; do not edit them.',
    '',
    '- Change only the class of this item (bodies and `#private` members, same line count) and test files. Imports and `#private` fields already come in the skeleton; do not change `extends`/`implements`, decorators or the public signature. Do not reformat the file.',
    '- You may use external libraries that are already imported. No side effects on import.',
    "- Test each port method with `covers(['port:<Port>.<method>'], title)` from `@agentic-ddd/testing` in `bun:test` tests.",
    '- Keep identifiers, rule IDs and business text exactly as written; never translate them.',
    '- Do not run `compile` or change the hash. Pending dependency, hash mismatch or a need to edit something outside the contract: return the item.',
    '- A team rule never beats a gate (verify, specHash, boundary gates, `covers` obligations): on conflict, follow the gate and return the item describing the conflict.',
    '- After two corrections without progress on the findings, stop and return the diagnosis.',
    '',
    RESPONSE_FORMAT,
  ].join('\n'),
  reviewer: readFileSync(REVIEWER_CORE, 'utf8').trimEnd(),
};

const FORBIDDEN = [
  'decorators and declarations',
  'proposals (`changes/**`)',
  'configuration (`agentic.config.ts`)',
  'generated files (`.agents/skills`, `.agentic/`, `.claude/skills`, the generated block of `AGENTS.md`)',
];

export const sha256 = (text: string): string =>
  createHash('sha256').update(text).digest('hex');

function field(packet: string, label: string): string {
  const match = new RegExp(`^- ${label}: \`?([^\`\\n]+)\`?$`, 'm').exec(packet);
  if (!match) throw new Error(`packet sem o campo "${label}"`);
  return match[1]!.trim();
}

export function parsePacket(packet: string): PacketFacts {
  const id = field(packet, 'ID');
  const specHash = field(packet, 'specHash');
  const command = /--item (\S+) --spec-hash ([a-f0-9]{64})/.exec(packet);
  if (!command)
    throw new Error('packet sem o comando de verificação com --spec-hash');
  if (command[2] !== specHash || command[1]!.replaceAll("'", '') !== id)
    throw new Error(
      'packet inconsistente: o comando de verificação não bate com o ID/specHash',
    );
  return {
    id,
    layer: field(packet, 'Layer'),
    module: field(packet, 'Module'),
    sourcePath: field(packet, 'source').replace(/:\d+$/, ''),
    specHash,
  };
}

export function roleForLayer(layer: string): BriefRole {
  return match(layer)
    .returnType<BriefRole>()
    .with('domain', () => 'domain')
    .with('application', 'operators', () => 'application')
    .with('infrastructure', () => 'infrastructure')
    .otherwise((x) => {
      throw new Error(`camada sem papel de executor: ${x}`);
    });
}

const BODY_LINES = [
  '- Change only the inside of the body given under "Files" and test files. Keep imports, signatures, decorators, schemas, rule IDs, proposals, configuration and generated files.',
  '- Keep the line count of the body (the `source` coordinates go into the generated files). Do not reformat the file. Without enough space, return the item to the manager.',
];
const CLASS_LINES = [
  '- Change only the class given under "Files" (bodies and `#private` members, same line count) and test files. Do not change `extends`/`implements`, decorators or the public signature. Keep imports, schemas, rule IDs, proposals, configuration and generated files.',
  '- Keep the line count of the class (the `source` coordinates go into the generated files). Do not reformat the file. Without enough space, return the item to the manager.',
];

/** Item de classe (VO/adapter): troca as linhas de corpo do núcleo de domínio pelas de classe. */
function classScopeCore(core: string): string {
  return BODY_LINES.reduce((text, line, i) => {
    if (!text.includes(line))
      throw new Error('núcleo de domínio sem a linha de corpo esperada');
    return text.replace(line, CLASS_LINES[i]!);
  }, core);
}

function renderExtras(extras: readonly BriefSection[]): string[] {
  if (!extras.length) return [];
  return [
    '',
    '## Additional sections (outside the specHash)',
    '',
    'These sections are not part of the packet and are not covered by the `specHash`; each one carries its own hash.',
    ...extras.flatMap((e) => [
      '',
      `### ${e.title} (sha256: \`${sha256(e.content)}\`)`,
      '',
      e.content.trimEnd(),
    ]),
  ];
}

const listRules = (rules: readonly Rule[]): string =>
  rules.map((r) => `${r.key} ~${approxTokens(r.body)}`).join(', ');

/** Seção "Regras do time" (vazia sem regras); nunca trunca. */
function rulesSection(
  rules: readonly Rule[] = [],
  maxTokens = DEFAULT_RULES_MAX_TOKENS,
): BriefSection[] {
  if (!rules.length) return [];
  const content = rules.map((r) => `#### ${r.key}\n\n${r.body}`).join('\n\n');
  const tokens = approxTokens(content);
  if (tokens > maxTokens)
    throw new Error(
      `regras do time excedem o orçamento: ~${tokens} > ${maxTokens} tokens (${listRules(rules)})`,
    );
  return [{ title: 'Team rules', content }];
}

function checkBudget(
  brief: string,
  maxTokens: number,
  rules: readonly Rule[] = [],
): string {
  const tokens = approxTokens(brief);
  if (tokens > maxTokens)
    throw new Error(
      `brief excede o orçamento: ~${tokens} > ${maxTokens} tokens${rules.length ? ` (regras do time: ${listRules(rules)})` : ''}`,
    );
  return brief;
}

/** Brief de executor (domínio ou aplicação), determinístico a partir do packet. */
export function renderBrief(input: BriefInput): string {
  const facts = parsePacket(input.packet);
  if (input.expectedSpecHash && input.expectedSpecHash !== facts.specHash)
    throw new Error(
      `specHash divergente: esperado ${input.expectedSpecHash}, packet ${facts.specHash}`,
    );
  const role = roleForLayer(facts.layer);
  const classItem = isClassScopeItem(facts.id);
  return checkBudget(
    [
      classItem && role === 'domain'
        ? classScopeCore(ROLE_CORES.domain)
        : ROLE_CORES[role],
      '',
      '## Files',
      '',
      `- May change: \`${facts.sourcePath}\` (only ${classItem ? 'the class' : 'the inside of the body'} of \`${facts.id}\`, same line count) and \`*.test.ts\` files.`,
      `- May not change: ${FORBIDDEN.join('; ')}.`,
      '',
      '## Packet',
      '',
      input.packet.trimEnd(),
      ...renderExtras([
        ...(input.extras ?? []),
        ...rulesSection(input.rules, input.rulesMaxTokens),
      ]),
      '',
    ].join('\n'),
    input.maxTokens ?? DEFAULT_MAX_TOKENS,
    input.rules,
  );
}

export interface ReviewerInput {
  readonly packets: readonly string[];
  /** Diff e resultados dos gates: seções próprias, com hash próprio. */
  readonly diff: string;
  readonly gates: string;
  /** Seções adicionais, depois do diff e dos gates, cada uma com hash próprio. */
  readonly extras?: readonly BriefSection[];
  /** Núcleo do papel no lugar do padrão (variantes de experimento). */
  readonly core?: string;
  readonly maxTokens?: number;
  readonly rules?: readonly Rule[];
  readonly rulesMaxTokens?: number;
}

export function renderReviewerBrief(input: ReviewerInput): string {
  const facts = input.packets.map(parsePacket);
  return checkBudget(
    [
      input.core ?? ROLE_CORES.reviewer,
      '',
      '## Reviewed items',
      '',
      ...facts.map((f) => `- \`${f.id}\` — specHash \`${f.specHash}\``),
      '',
      '## Packets',
      ...input.packets.flatMap((p) => ['', p.trimEnd()]),
      ...renderExtras([
        { title: 'Diff', content: input.diff },
        { title: 'Gate results', content: input.gates },
        ...(input.extras ?? []),
        ...rulesSection(input.rules, input.rulesMaxTokens),
      ]),
      '',
    ].join('\n'),
    input.maxTokens ?? DEFAULT_MAX_TOKENS,
    input.rules,
  );
}

/** `_` é válido em IDs (ex.: `usecase:a_b`) e fica; o resto vira `-`, para não colidir. */
export function briefFileName(id: string): string {
  return `${id.replaceAll(/[^a-zA-Z0-9_]+/g, '-')}.md`;
}

export function assertOutsideGenerated(root: string, out: string): string {
  const absolute = resolve(root, out);
  for (const generated of GENERATED_PATHS) {
    const path = relative(resolve(root, generated), absolute);
    if (path === '' || (!path.startsWith('..') && !isAbsolute(path)))
      throw new Error(`saída dentro de caminho gerado: ${generated}`);
  }
  return absolute;
}

interface CliOptions {
  readonly items: string[];
  readonly config: string;
  readonly configExplicit: boolean;
  readonly out: string;
  readonly packetFile?: string;
  readonly maxTokens: number;
}

function parseCli(argv: readonly string[]): CliOptions | string {
  const items: string[] = [];
  let config = 'agentic.config.ts';
  let configExplicit = false;
  let out = DEFAULT_OUT;
  let packetFile: string | undefined;
  let maxTokens = DEFAULT_MAX_TOKENS;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = (): string | undefined => argv[++i];
    const unknown = match(arg)
      .with('--config', () => {
        config = value() ?? '';
        configExplicit = true;
      })
      .with('--out', () => {
        out = value() ?? '';
      })
      .with('--packet-file', () => {
        packetFile = value();
      })
      .with('--max-tokens', () => {
        maxTokens = Number(value());
      })
      .with(P.string.startsWith('--'), () => `opção desconhecida: ${arg}`)
      .otherwise(() => {
        items.push(arg);
      });
    if (unknown) return unknown;
  }
  if (!config || !out) return 'valor ausente para --config/--out';
  if (!Number.isInteger(maxTokens) || maxTokens <= 0)
    return '--max-tokens exige um inteiro positivo';
  if (!items.length) return 'informe ao menos um item';
  if (packetFile && items.length !== 1)
    return '--packet-file vale para exatamente um item';
  return { items, config, configExplicit, out, packetFile, maxTokens };
}

const USAGE =
  'uso: bun scripts/agent-briefs.ts <item...> [--config <arquivo>] [--out <dir>] [--packet-file <arquivo>] [--max-tokens <n>]';

async function staticPacket(item: string, config: string): Promise<string> {
  const cli = resolve(import.meta.dir, '../src/cli/main.ts');
  const run = Bun.spawn(
    [process.execPath, cli, 'packet', item, '--static', '--config', config],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
    run.exited,
  ]);
  if (code !== 0) throw new Error(`packet ${item} falhou: ${stderr.trim()}`);
  return stdout;
}

export async function main(argv: readonly string[]): Promise<number> {
  const options = parseCli(argv);
  if (typeof options === 'string') {
    console.error(`${options}\n${USAGE}`);
    return 2;
  }
  try {
    const root = process.cwd();
    const out = assertOutsideGenerated(root, options.out);
    const names = new Map<string, string>();
    for (const item of options.items) {
      const name = briefFileName(item);
      const other = names.get(name);
      if (other)
        throw new Error(`${item} e ${other} gerariam o mesmo arquivo: ${name}`);
      names.set(name, item);
    }
    const present = await access(options.config).then(
      () => true,
      () => false,
    );
    if (!present && options.configExplicit)
      throw new Error(`config não encontrada: ${options.config}`);
    // Config padrão ausente = sem regras (--packet-file sem projeto).
    const config = present ? await loadConfig(options.config) : null;
    const rules = config ? await loadRules(config) : [];
    await mkdir(out, { recursive: true });
    for (const item of options.items) {
      const packet = options.packetFile
        ? await readFile(options.packetFile, 'utf8')
        : await staticPacket(item, options.config);
      if (parsePacket(packet).id !== item)
        throw new Error(`o packet não é do item ${item}`);
      const file = join(out, briefFileName(item));
      await writeFile(
        file,
        renderBrief({
          packet,
          maxTokens: options.maxTokens,
          rules: briefRules(rules, [parsePacket(packet).sourcePath]),
          rulesMaxTokens: config?.rules.briefMaxTokens,
        }),
      );
      console.log(relative(root, file) || basename(file));
    }
    return 0;
  } catch (error) {
    console.error(`agent-briefs: ${(error as Error).message}`);
    return 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
