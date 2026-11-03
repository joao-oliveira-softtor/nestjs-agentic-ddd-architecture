import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { match, P } from 'ts-pattern';
import {
  briefRules,
  loadConfig,
  loadRules,
  type Rule,
} from '@agentic-ddd/compiler';
import {
  DEFAULT_MAX_TOKENS,
  ROLE_CORES,
  checkBudget,
  parsePacket,
  renderBrief,
  renderExtras,
  rulesSection,
  type BriefSection,
} from '../src/compiler/briefs';

// The generator lives in the package; this script is the CLI and keeps the old import path.
export {
  DEFAULT_MAX_TOKENS,
  DOMAIN_CORE,
  REVIEWER_CORE,
  ROLE_CORES,
  parsePacket,
  renderBrief,
  roleForLayer,
  sha256,
  type BriefInput,
  type BriefRole,
  type BriefSection,
  type PacketFacts,
} from '../src/compiler/briefs';

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
