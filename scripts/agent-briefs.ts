import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { approxTokens } from '@agentic-ddd/compiler';

export type BriefRole = 'domain' | 'application' | 'reviewer';
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
  'Resposta final: apenas um objeto JSON, sem prosa, no formato do exemplo: `{"item":"entity:Order","specHash":"<hash do packet>","status":"done","verifyExitCode":0,"changedFiles":["examples/orders/domain/order.ts"],"findings":[]}`. `status` é `done`, `blocked` ou `failed`. `specHash` é o do packet, nunca recalculado.';

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
    '# Papel: executor de aplicação',
    '',
    'Implemente UM item de application ou operator a partir do packet abaixo. Use os contratos declarados das dependências (métodos e entidades de domínio), sem editá-los.',
    '',
    '- Altere só o interior do corpo indicado em "Arquivos" e arquivos de teste. Preserve imports, assinaturas, decorators, schemas, IDs de regras, propostas, configuração e arquivos gerados.',
    '- Preserve a quantidade de linhas do corpo (as coordenadas `source` entram nos gerados). Não reformate o arquivo.',
    '- Componha só as dependências listadas em `uses`/`Dependências`; eventos emitidos são os declarados. Não mude o domínio: se uma dependência contradiz o contrato, devolva o item.',
    '- Um operator declarativo já está implementado: acrescente só testes que exercitem suas tools e contratos.',
    '- Cubra cada obrigação do packet com `covers([...ids], título)` de `@agentic-ddd/testing` em testes `bun:test`.',
    '- Não rode `compile` nem altere o hash. Dependência pendente, divergência de hash ou necessidade de infraestrutura fora do contrato: devolva o item.',
    '- Após duas correções sem progresso nos findings, encerre e devolva o diagnóstico.',
    '',
    RESPONSE_FORMAT,
  ].join('\n'),
  reviewer: readFileSync(REVIEWER_CORE, 'utf8').trimEnd(),
};

const FORBIDDEN = [
  'decorators e declarações',
  'propostas (`changes/**`)',
  'configuração (`agentic.config.ts`)',
  'arquivos gerados (`.agents/skills`, `.agentic/`, `.claude/skills`, bloco gerado do `AGENTS.md`)',
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
    layer: field(packet, 'Camada'),
    module: field(packet, 'Módulo'),
    sourcePath: field(packet, 'source').replace(/:\d+$/, ''),
    specHash,
  };
}

export function roleForLayer(layer: string): BriefRole {
  if (layer === 'domain') return 'domain';
  if (layer === 'application' || layer === 'operators') return 'application';
  throw new Error(`camada sem papel de executor: ${layer}`);
}

function renderExtras(extras: readonly BriefSection[]): string[] {
  if (!extras.length) return [];
  return [
    '',
    '## Seções adicionais (fora do specHash)',
    '',
    'Estas seções não fazem parte do packet e não são cobertas pelo `specHash`; cada uma traz o próprio hash.',
    ...extras.flatMap((e) => [
      '',
      `### ${e.title} (sha256: \`${sha256(e.content)}\`)`,
      '',
      e.content.trimEnd(),
    ]),
  ];
}

function checkBudget(brief: string, maxTokens: number): string {
  const tokens = approxTokens(brief);
  if (tokens > maxTokens)
    throw new Error(
      `brief excede o orçamento: ~${tokens} > ${maxTokens} tokens`,
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
  return checkBudget(
    [
      ROLE_CORES[role],
      '',
      '## Arquivos',
      '',
      `- Pode alterar: \`${facts.sourcePath}\` (somente o interior do corpo de \`${facts.id}\`, mesma quantidade de linhas) e arquivos \`*.test.ts\`.`,
      `- Não pode alterar: ${FORBIDDEN.join('; ')}.`,
      '',
      '## Packet',
      '',
      input.packet.trimEnd(),
      ...renderExtras(input.extras ?? []),
      '',
    ].join('\n'),
    input.maxTokens ?? DEFAULT_MAX_TOKENS,
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
}

export function renderReviewerBrief(input: ReviewerInput): string {
  const facts = input.packets.map(parsePacket);
  return checkBudget(
    [
      input.core ?? ROLE_CORES.reviewer,
      '',
      '## Itens revisados',
      '',
      ...facts.map((f) => `- \`${f.id}\` — specHash \`${f.specHash}\``),
      '',
      '## Packets',
      ...input.packets.flatMap((p) => ['', p.trimEnd()]),
      ...renderExtras([
        { title: 'Diff', content: input.diff },
        { title: 'Resultado dos gates', content: input.gates },
        ...(input.extras ?? []),
      ]),
      '',
    ].join('\n'),
    input.maxTokens ?? DEFAULT_MAX_TOKENS,
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
  readonly out: string;
  readonly packetFile?: string;
  readonly maxTokens: number;
}

function parseCli(argv: readonly string[]): CliOptions | string {
  const items: string[] = [];
  let config = 'agentic.config.ts';
  let out = DEFAULT_OUT;
  let packetFile: string | undefined;
  let maxTokens = DEFAULT_MAX_TOKENS;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = (): string | undefined => argv[++i];
    if (arg === '--config') config = value() ?? '';
    else if (arg === '--out') out = value() ?? '';
    else if (arg === '--packet-file') packetFile = value();
    else if (arg === '--max-tokens') maxTokens = Number(value());
    else if (arg.startsWith('--')) return `opção desconhecida: ${arg}`;
    else items.push(arg);
  }
  if (!config || !out) return 'valor ausente para --config/--out';
  if (!Number.isInteger(maxTokens) || maxTokens <= 0)
    return '--max-tokens exige um inteiro positivo';
  if (!items.length) return 'informe ao menos um item';
  if (packetFile && items.length !== 1)
    return '--packet-file vale para exatamente um item';
  return { items, config, out, packetFile, maxTokens };
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
        renderBrief({ packet, maxTokens: options.maxTokens }),
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
