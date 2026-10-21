import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { match } from 'ts-pattern';
import { claudeMessages } from './adapters/claude';
import { emptyUsage, type ModelUsage, type RequestUsage } from './contracts';
import {
  deriveCost,
  loadPricing,
  type DerivedCost,
  type Pricing,
} from './pricing';

// shortcut: o formato do transcript (`~/.claude/projects`) não é contrato público do Claude Code
// (versões 2.1.305-2.1.306 analisadas); sem requisição reconhecida o script falha em vez de
// somar zero. Rever se uma versão nova mudar os eventos `assistant`.

export interface SessionFile {
  path: string;
  text: string;
  kind: 'main' | 'subagent';
  label: string;
}
export interface CostedRow {
  requests: number;
  uncachedInputTokens: number;
  cacheWriteInputTokens: number;
  cacheWrite1hInputTokens: number;
  /** Escrita de cache sem TTL informado: `expensive` a cobra como 1 h. */
  cacheWriteUnknownTtlInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
  /** Sempre `true`: o transcript não tem as chamadas auxiliares do CLI e a saída de subagente é provisória. */
  lowerBound: boolean;
  cost: DerivedCost;
}
export interface GroupCost {
  label: string;
  kind: SessionFile['kind'];
  models: Record<string, CostedRow>;
  total: CostedRow;
}
export interface SessionCostReport {
  groups: GroupCost[];
  byModel: Record<string, CostedRow>;
  total: CostedRow;
  retrievedAt: string;
  /** Do arquivo principal: linhas `assistant` sem `usage` e linhas `isSidechain: true`. */
  noUsageLines: number;
  sidechainLines: number;
  /** Requisições com `output_tokens` ausente ou inválido (saída contada como 0). */
  invalidOutputRequests: number;
}

type Request = RequestUsage & { outputTokens: number };

const object = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const promptTokens = (r: RequestUsage) =>
  r.uncachedInputTokens + r.cacheWriteInputTokens + r.cacheReadInputTokens;

/** Só os contadores de aviso: o resto vem de `claudeMessages`. */
function countLines(text: string) {
  let noUsage = 0,
    sidechain = 0;
  for (const line of text.split('\n')) {
    let event: Record<string, unknown> | null;
    try {
      event = object(JSON.parse(line));
    } catch {
      continue;
    }
    if (event?.isSidechain === true) sidechain++;
    if (event?.type === 'assistant' && !object(object(event.message)?.usage))
      noUsage++;
  }
  return { noUsage, sidechain };
}

function costRow(requests: Request[], pricing: Pricing): CostedRow {
  const byModel: Record<string, ModelUsage> = {};
  const row: CostedRow = {
    requests: requests.length,
    uncachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    cacheWrite1hInputTokens: 0,
    cacheWriteUnknownTtlInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
    // shortcut: sempre ≥ (chamadas auxiliares do CLI ficam fora do transcript e a saída de subagente é
    // provisória); rever se a validação com referência real provar exatidão do modelo principal.
    lowerBound: true,
    cost: { status: 'unavailable', reason: 'no_usage_breakdown' },
  };
  for (const r of requests) {
    row.uncachedInputTokens += r.uncachedInputTokens;
    row.cacheWriteInputTokens += r.cacheWriteInputTokens;
    row.cacheWrite1hInputTokens += r.cacheWrite1hInputTokens ?? 0;
    if (r.cacheWrite1hInputTokens === null)
      row.cacheWriteUnknownTtlInputTokens += r.cacheWriteInputTokens;
    row.cacheReadInputTokens += r.cacheReadInputTokens;
    row.outputTokens += r.outputTokens;
    const m = (byModel[r.model] ??= {
      uncachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 0,
    });
    m.uncachedInputTokens += r.uncachedInputTokens;
    m.cacheWriteInputTokens += r.cacheWriteInputTokens;
    m.cacheReadInputTokens += r.cacheReadInputTokens;
    m.outputTokens += r.outputTokens;
  }
  row.cost = deriveCost(
    {
      ...emptyUsage(),
      byModel,
      // Não é reconciliação de verdade: `byModel` sai das próprias requisições (nada a comparar),
      // montado direto para que `deriveCost` use a faixa por requisição e a saída por modelo.
      requests: { status: 'reconciled', items: requests, residual: {} },
    },
    pricing,
  );
  return row;
}

const byModelOf = (requests: Request[], pricing: Pricing) => {
  const groups = new Map<string, Request[]>();
  for (const r of requests) {
    const list = groups.get(r.model) ?? [];
    list.push(r);
    groups.set(r.model, list);
  }
  return Object.fromEntries(
    [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([model, rs]) => [model, costRow(rs, pricing)]),
  );
};

/** Pura: `files` já lidos, principal primeiro (na dedup por `message.id` entre arquivos o primeiro vence). */
export function sessionCost(
  files: readonly SessionFile[],
  pricing: Pricing,
): SessionCostReport {
  const seen = new Set<string>();
  const groups: GroupCost[] = [];
  const all: Request[] = [];
  const report = {
    noUsageLines: 0,
    sidechainLines: 0,
    invalidOutputRequests: 0,
  };
  // Entre arquivos o primeiro `message.id` vence: o principal precisa vir antes dos subagentes.
  const ordered = [...files].sort(
    (a, b) => Number(b.kind === 'main') - Number(a.kind === 'main'),
  );
  for (const file of ordered) {
    if (file.kind === 'main') {
      const counts = countLines(file.text);
      report.noUsageLines += counts.noUsage;
      report.sidechainLines += counts.sidechain;
    }
    const own: Request[] = [];
    for (const { id, request, output } of claudeMessages(file.text)) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (output === null) report.invalidOutputRequests++;
      const costed = { ...request, outputTokens: output ?? 0 };
      // `<synthetic>` não é requisição à API (sem preço, derrubaria a sessão); zerada também sai.
      if (
        costed.model === '<synthetic>' ||
        (promptTokens(costed) === 0 && costed.outputTokens === 0)
      )
        continue;
      own.push(costed);
    }
    if (!own.length) continue;
    all.push(...own);
    groups.push({
      label: file.label,
      kind: file.kind,
      models: byModelOf(own, pricing),
      total: costRow(own, pricing),
    });
  }
  if (!all.length)
    throw new Error(
      'Nenhuma requisição reconhecida: o formato do transcript pode ter mudado',
    );
  return {
    groups,
    byModel: byModelOf(all, pricing),
    total: costRow(all, pricing),
    retrievedAt: pricing.retrievedAt,
    ...report,
  };
}

// Rótulo vem de texto livre do meta.json: sem caracteres de controle (ANSI) e com tamanho limitado.
const clean = (value: string, max: number) =>
  value
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    // O corte por unidade UTF-16 pode deixar meio emoji no fim.
    .replace(/[\uD800-\uDBFF]$/, '');
export function subagentLabel(meta: unknown): string {
  const { agentType, description } = object(meta) ?? {};
  const type =
    (typeof agentType === 'string' && clean(agentType, 40)) || 'subagente';
  const text = typeof description === 'string' ? clean(description, 60) : '';
  return text ? `${type}: ${text}` : type;
}

const number = (n: number) => n.toLocaleString('pt-BR');
const usd = (n: number) => n.toFixed(4);
const costText = (row: CostedRow) =>
  match(row.cost)
    .with(
      { status: 'available' },
      (c) =>
        `${row.lowerBound ? '≥ ' : ''}US$ ${usd(c.expensive)} / ${usd(c.cheap)}`,
    )
    .with({ status: 'unavailable' }, (c) => `indisponível (${c.reason})`)
    .exhaustive();

function table(rows: string[][]): string[] {
  const widths = rows[0]!.map((_, c) =>
    Math.max(...rows.map((r) => r[c]!.length)),
  );
  return rows.map((r) =>
    r
      .map((cell, c) =>
        c < 2 ? cell.padEnd(widths[c]!) : cell.padStart(widths[c]!),
      )
      .join('  ')
      .trimEnd(),
  );
}

export function renderSessionCost(report: SessionCostReport): string {
  const header = [
    'Grupo',
    'Modelo',
    'Req',
    'Entrada s/ cache',
    'Escrita 5m',
    'Escrita 1h',
    'Leitura cache',
    'Saída',
    'Custo expensive / cheap',
  ];
  const line = (group: string, model: string, r: CostedRow) => [
    group,
    model,
    number(r.requests),
    number(r.uncachedInputTokens),
    number(
      r.cacheWriteInputTokens -
        r.cacheWrite1hInputTokens -
        r.cacheWriteUnknownTtlInputTokens,
    ),
    number(r.cacheWrite1hInputTokens + r.cacheWriteUnknownTtlInputTokens),
    number(r.cacheReadInputTokens),
    number(r.outputTokens),
    costText(r),
  ];
  const rows = [header];
  for (const g of report.groups) {
    for (const [model, r] of Object.entries(g.models))
      rows.push(line(g.label, model, r));
    if (Object.keys(g.models).length > 1)
      rows.push(line(g.label, 'subtotal', g.total));
  }
  rows.push(['---', ...header.slice(1).map(() => '')]);
  for (const [model, r] of Object.entries(report.byModel))
    rows.push(line('por modelo', model, r));
  rows.push(line('TOTAL', 'todos', report.total));
  const warnings = [
    `Custo derivado de evals/pricing.json (preços de ${report.retrievedAt}): equivalente de API, não é cobrança. Dois valores por faixa de preço incerta: expensive / cheap.`,
    '≥ no total: chamadas auxiliares do CLI não geram evento no transcript e ficam de fora; saída de subagente é provisória (limite inferior).',
  ];
  if (report.sidechainLines)
    warnings.push(
      `Aviso: ${report.sidechainLines} linhas isSidechain no arquivo principal, contadas no grupo principal.`,
    );
  if (report.noUsageLines)
    warnings.push(
      `Aviso: ${report.noUsageLines} linhas assistant sem usage no arquivo principal, fora da soma.`,
    );
  if (report.invalidOutputRequests)
    warnings.push(
      `Aviso: ${report.invalidOutputRequests} requisições sem output_tokens válido (saída contada como 0).`,
    );
  if (report.total.cacheWriteUnknownTtlInputTokens)
    warnings.push(
      `Aviso: ${number(report.total.cacheWriteUnknownTtlInputTokens)} tokens de escrita de cache sem TTL informado (coluna 1h; expensive os cobra como 1 h).`,
    );
  return [...table(rows), '', ...warnings].join('\n') + '\n';
}

/** O id vira nome de arquivo: só o formato de UUID/slug do Claude Code. */
export async function findTranscript(
  arg: string,
  configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'),
): Promise<string> {
  if (arg.endsWith('.jsonl')) return resolve(arg);
  if (!/^[A-Za-z0-9-]+$/.test(arg)) throw new Error('Id de sessão inválido');
  const projects = join(configDir, 'projects');
  const found: string[] = [];
  for (const dir of await readdir(projects).catch(() => [])) {
    const path = join(projects, dir, `${arg}.jsonl`);
    if (await Bun.file(path).exists()) found.push(path);
  }
  if (found.length !== 1)
    throw new Error(
      found.length
        ? `Mais de um transcript para o id ${arg}; passe o caminho do arquivo:\n${found.join('\n')}`
        : `Transcript não encontrado para o id ${arg} em ${projects}`,
    );
  return found[0]!;
}

async function readSession(mainPath: string): Promise<SessionFile[]> {
  const files: SessionFile[] = [
    {
      path: mainPath,
      text: await readFile(mainPath, 'utf8'),
      kind: 'main',
      label: 'principal',
    },
  ];
  const dir = join(
    dirname(mainPath),
    basename(mainPath, '.jsonl'),
    'subagents',
  );
  const names = (await readdir(dir).catch(() => []))
    .filter((n) => /^agent-.*\.jsonl$/.test(n))
    .sort();
  for (const name of names) {
    const meta = await readFile(
      join(dir, name.replace(/\.jsonl$/, '.meta.json')),
      'utf8',
    )
      .then((t) => JSON.parse(t) as unknown)
      .catch(() => null);
    files.push({
      path: join(dir, name),
      text: await readFile(join(dir, name), 'utf8'),
      kind: 'subagent',
      label: subagentLabel(meta),
    });
  }
  return files;
}

const USAGE =
  'Uso: bun run evals:session-cost <id-da-sessão | caminho .jsonl> [--pricing <arquivo>]';

export async function main(argv: readonly string[]) {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log(USAGE);
    return 0;
  }
  const [arg, flag, pricingPath] = argv;
  if (
    !arg ||
    arg.startsWith('--') ||
    (flag !== undefined &&
      (flag !== '--pricing' || !pricingPath || argv.length > 3))
  ) {
    console.error(USAGE);
    return 2;
  }
  try {
    const pricing = await loadPricing(pricingPath && resolve(pricingPath));
    const report = sessionCost(
      await readSession(await findTranscript(arg)),
      pricing,
    );
    process.stdout.write(renderSessionCost(report));
    return 0;
  } catch (error) {
    console.error(String(error));
    return 1;
  }
}
if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
