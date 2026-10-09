import { lstat, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type {
  Artifact,
  CaseResult,
  EvalReport,
  Measured,
  Usage,
} from './contracts';
import { available, unavailable } from './contracts';
import { judge } from './judge';
import { sha256, within } from './isolation';
import { reportSchema } from './report-schema';
import { finalVerificationState } from './final-verification';

export interface Rate {
  numerator: number;
  denominator: number;
  value: Measured<number>;
}
const rate = (numerator: number, denominator: number): Rate => ({
  numerator,
  denominator,
  value: denominator
    ? available(numerator / denominator, 'deterministic_counts')
    : unavailable('zero_denominator'),
});
const scorable = (c: CaseResult) =>
  ['correct', 'incorrect', 'malformed', 'timeout'].includes(c.verdict);
const key = (c: CaseResult) => JSON.stringify([c.dataset, c.id]);
function sumUsage(usage: Usage[]): Usage {
  const token = (
    field: 'inputTokens' | 'cachedInputTokens' | 'outputTokens',
  ): Measured<number> =>
    usage.length && usage.every((u) => u[field].status === 'available')
      ? available(
          usage.reduce(
            (n, u) =>
              n + (u[field].status === 'available' ? u[field].value : 0),
            0,
          ),
          'native_usage_sum',
        )
      : unavailable('incomplete_measurements');
  const costs = usage.map((u) => u.cost);
  const complete =
    costs.length > 0 && costs.every((c) => c.status === 'available');
  const currencies = new Set(
    costs.flatMap((c) => (c.status === 'available' ? [c.value.currency] : [])),
  );
  return {
    inputTokens: token('inputTokens'),
    cachedInputTokens: token('cachedInputTokens'),
    outputTokens: token('outputTokens'),
    cost:
      complete && currencies.size === 1
        ? available(
            {
              amount: costs.reduce(
                (n, c) => n + (c.status === 'available' ? c.value.amount : 0),
                0,
              ),
              currency: [...currencies][0]!,
            },
            'native_cost_sum',
          )
        : unavailable('incomplete_or_incompatible_costs'),
  };
}
export function computeMetrics(report: EvalReport) {
  const skills: {
    configuration: string;
    dataset: string | null;
    audience: string | null;
    planned: number;
    evaluable: number;
    infrastructure: number;
    notRun: number;
    accuracy: Rate;
    coverage: Rate;
  }[] = [];
  const usage: Record<string, Usage> = {};
  const configurations = report.manifest.configurations.map((c) => c.id);
  for (const configuration of configurations) {
    const cases = report.cases.filter((c) => c.configuration === configuration);
    const groups = [
      {
        dataset: null as string | null,
        audience: null as string | null,
        cases,
      },
      ...report.manifest.skillDatasets.flatMap((dataset) => [
        {
          dataset: dataset.path,
          audience: null as string | null,
          cases: cases.filter((c) => c.dataset === dataset.path),
        },
        ...(['dev', 'runtime'] as const).map((audience) => ({
          dataset: dataset.path,
          audience,
          cases: cases.filter(
            (c) => c.dataset === dataset.path && c.audience === audience,
          ),
        })),
      ]),
    ];
    for (const group of groups) {
      const evaluable = group.cases.filter(scorable).length;
      skills.push({
        configuration,
        dataset: group.dataset,
        audience: group.audience,
        planned: group.cases.length,
        evaluable,
        infrastructure: group.cases.filter((c) => c.verdict === 'infra_error')
          .length,
        notRun: group.cases.filter((c) => c.verdict === 'not_run').length,
        accuracy: rate(
          group.cases.filter((c) => c.verdict === 'correct').length,
          evaluable,
        ),
        coverage: rate(evaluable, group.cases.length),
      });
    }
    usage[configuration] = sumUsage([
      ...cases.flatMap((c) => (c.execution ? [c.execution.usage] : [])),
      ...report.benchmarks
        .filter((b) => b.configuration === configuration)
        .flatMap((b) =>
          b.items.flatMap((i) => i.attempts.map((a) => a.execution.usage)),
        ),
    ]);
  }
  const benchmarks = report.benchmarks.map((b) => ({
    configuration: b.configuration,
    initial: rate(b.items.filter((i) => i.attempts[0]?.accepted).length, 5),
    final: rate(b.items.filter((i) => i.state === 'accepted').length, 5),
    corrections: b.items.reduce(
      (n, i) => n + Math.max(0, i.attempts.length - 1),
      0,
    ),
    completion:
      ['verified', 'behavior_failed'].includes(
        finalVerificationState(b.finalVerification),
      ) && b.finalVerification?.report
        ? available(
            b.finalVerification.report.status,
            'independent_verify_change',
          )
        : unavailable<string>(
            finalVerificationState(b.finalVerification) === 'infra_error'
              ? 'final_verification_infrastructure'
              : 'verification_unavailable',
          ),
    agentDurationMs: b.items.reduce(
      (n, i) => n + i.attempts.reduce((m, a) => m + a.execution.durationMs, 0),
      0,
    ),
    verificationDurationMs: b.items.reduce(
      (n, i) =>
        n +
        i.attempts.reduce(
          (m, a) =>
            m +
            (a.verification?.commands.reduce(
              (s, c) => s + c.result.durationMs,
              0,
            ) ?? 0),
          0,
        ),
      0,
    ),
  }));
  const byConfig = new Map(
    configurations.map((id) => [
      id,
      new Map(
        report.cases
          .filter((c) => c.configuration === id)
          .map((c) => [key(c), c]),
      ),
    ]),
  );
  const plannedRows = [...new Set(report.cases.map(key))];
  const agreements: {
    configurations: [string, string];
    agreement: Rate;
    coverage: Rate;
  }[] = [];
  for (let i = 0; i < configurations.length; i++)
    for (let j = i + 1; j < configurations.length; j++) {
      const first = configurations[i]!,
        second = configurations[j]!;
      let valid = 0,
        equal = 0;
      for (const id of plannedRows) {
        const a = byConfig.get(first)!.get(id),
          b = byConfig.get(second)!.get(id);
        if (!a?.answer || !b?.answer || !scorable(a) || !scorable(b)) continue;
        valid++;
        if (judge(a.answer, b.answer) === 'correct') equal++;
      }
      agreements.push({
        configurations: [first, second],
        agreement: rate(equal, valid),
        coverage: rate(valid, plannedRows.length),
      });
    }
  const matrix = plannedRows
    .map((id) => configurations.map((c) => byConfig.get(c)!.get(id)))
    .filter((row) => row.every((c) => c && scorable(c)));
  const n = configurations.length,
    N = matrix.length;
  let kappa: Measured<number> = unavailable('insufficient_raters_or_rows');
  if (n >= 2 && N > 0) {
    const correctCounts = matrix.map(
      (row) => row.filter((c) => c?.verdict === 'correct').length,
    );
    const po =
      correctCounts.reduce(
        (sum, c) => sum + (c * (c - 1) + (n - c) * (n - c - 1)) / (n * (n - 1)),
        0,
      ) / N;
    const p = correctCounts.reduce((a, b) => a + b, 0) / (N * n);
    const pe = p * p + (1 - p) * (1 - p);
    kappa =
      pe === 1
        ? unavailable('degenerate_expected_agreement')
        : available((po - pe) / (1 - pe), 'fleiss_binary_correctness');
  }
  return {
    skills,
    benchmarks,
    agreements,
    kappa: {
      value: kappa,
      completeRows: N,
      plannedRows: plannedRows.length,
      raters: n,
      coverage: rate(N, plannedRows.length),
    },
    usage,
  };
}
export type EvalMetrics = ReturnType<typeof computeMetrics>;
const escape = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '\\|')
    .replaceAll('`', '\\`')
    .replaceAll('\n', ' ');
function measure<T>(value: Measured<T>): string {
  return value.status === 'available'
    ? escape(JSON.stringify(value.value))
    : `indisponível (${escape(value.reason)})`;
}
const percentage = (value: Rate) =>
  `${value.numerator}/${value.denominator} — ${value.value.status === 'available' ? (100 * value.value.value).toFixed(1) + '%' : measure(value.value)}`;
export function renderMarkdown(report: EvalReport): string {
  const metrics = computeMetrics(report);
  const lines = [
    `# Avaliação ${escape(report.id)}`,
    '',
    `Modalidade: **${report.mode}**. Estado: **${report.status}**.`,
    '',
    `Fonte: ${report.provenance.sourceCommit}; runner: ${report.provenance.runnerCommit}. Bun ${report.provenance.bun}, ${escape(report.provenance.platform)}.`,
    `Dataset/manifesto identificados por SHA-256. Manifesto: ${report.manifestSha256}.`,
    `Início: ${report.startedAt}; fim: ${report.finishedAt}; duração: ${report.durationMs.toFixed(0)} ms.`,
    `Sessões: ${report.invocations}/${report.manifest.budget.maxInvocations}. Teto global: ${report.manifest.budget.totalTimeoutMs} ms.`,
    `Saneamento na publicação: ${report.redaction?.applied ? 'valores removidos' : 'nenhuma remoção adicional'}; streams são saneados no supervisor antes da publicação.`,
    `Integridade da origem: antes ${report.provenance.originBefore}; depois ${measure(report.provenance.originAfter)}.`,
    '',
    '| Configuração | Adapter/versão | Modelo solicitado/parâmetros | Acurácia | Cobertura |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const config of report.manifest.configurations) {
    const metric = metrics.skills.find(
      (m) => m.configuration === config.id && m.dataset === null,
    )!;
    lines.push(
      `| ${config.id} | ${config.adapter} ${escape(report.provenance.adapters[config.id]?.version ?? 'indisponível')} | ${escape(config.model)} ${escape(JSON.stringify(config.parameters))} | ${percentage(metric.accuracy)} | ${percentage(metric.coverage)} |`,
    );
  }
  lines.push(
    '',
    '| Configuração/dataset/caso | Resultado | Modelo observado | Duração do agente (ms) |',
    '| --- | --- | --- | --- |',
  );
  for (const c of report.cases)
    lines.push(
      `| ${escape(c.configuration + '/' + c.dataset + '/' + c.id)} | ${c.verdict}${c.reason ? ' — ' + escape(c.reason) : ''} | ${c.execution ? measure(c.execution.observedModel) : 'indisponível (not_run)'} | ${c.execution?.durationMs.toFixed(0) ?? 'indisponível'} |`,
    );
  lines.push(
    '',
    '| Benchmark | Primeira tentativa | Final | Correções | Change | Agente/verificação (ms) |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const b of metrics.benchmarks)
    lines.push(
      `| ${b.configuration} | ${percentage(b.initial)} | ${percentage(b.final)} | ${b.corrections} | ${measure(b.completion)} | ${b.agentDurationMs.toFixed(0)}/${b.verificationDurationMs.toFixed(0)} |`,
    );
  for (const b of report.benchmarks)
    for (const i of b.items)
      lines.push(
        `- ${b.configuration}/${i.item}: ${i.state}${i.reason ? ' — ' + escape(i.reason) : ''}; specHash ${i.specHash ?? 'indisponível (not_prepared)'}; ${i.attempts.length} tentativa(s).`,
      );
  lines.push(
    '',
    'Concordância de respostas estruturadas válidas (pode incluir erros iguais):',
  );
  for (const pair of metrics.agreements)
    lines.push(
      `- ${pair.configurations.join(' × ')}: ${percentage(pair.agreement)}; cobertura ${percentage(pair.coverage)}.`,
    );
  lines.push(
    '',
    `Fleiss κ binário: ${measure(metrics.kappa.value)}; matriz ${metrics.kappa.completeRows}/${metrics.kappa.plannedRows}, ${metrics.kappa.raters} configurações.`,
    '',
    'Uso agregado somente quando todos os componentes medidos estão disponíveis:',
  );
  for (const [id, u] of Object.entries(metrics.usage))
    lines.push(
      `- ${id}: input ${measure(u.inputTokens)}; cached input ${measure(u.cachedInputTokens)}; output ${measure(u.outputTokens)}; custo ${measure(u.cost)}.`,
    );
  if (report.diagnostics.length)
    lines.push(
      '',
      'Diagnósticos:',
      ...report.diagnostics.map((d) => `- ${escape(d)}`),
    );
  lines.push(
    '',
    `Artefatos de evidência: ${report.artifacts.length}. Checksums dos relatórios e das evidências em artifact-manifest.json; o manifest não inclui seu próprio hash.`,
    '',
  );
  return lines.join('\n');
}
async function artifacts(
  outDir: string,
  secrets: readonly string[],
  redacted: string[],
): Promise<Artifact[]> {
  const entries: Artifact[] = [];
  async function visit(directory: string) {
    for (const name of (await readdir(join(outDir, directory))).sort()) {
      const path = directory ? `${directory}/${name}` : name;
      if (
        ['report.json', 'report.md', 'artifact-manifest.json'].includes(path) ||
        name.startsWith('.atomic-')
      )
        continue;
      const full = join(outDir, path);
      const stat = await lstat(full);
      if (stat.isDirectory()) await visit(path);
      else if (stat.isFile()) {
        let bytes = await readFile(full);
        for (const secret of secrets) {
          const needle = Buffer.from(secret);
          const parts: Buffer[] = [];
          let start = 0,
            index = bytes.indexOf(needle);
          while (index >= 0) {
            parts.push(bytes.subarray(start, index), Buffer.from('[REDACTED]'));
            start = index + needle.length;
            index = bytes.indexOf(needle, start);
          }
          if (start) {
            parts.push(bytes.subarray(start));
            bytes = Buffer.concat(parts);
            if (!redacted.includes(path)) redacted.push(path);
          }
        }
        if (redacted.includes(path)) await writeFile(full, bytes);
        entries.push({ path, sha256: sha256(bytes), bytes: bytes.byteLength });
      } else throw Error(`Unsafe artifact: ${path}`);
    }
  }
  await visit('');
  return entries;
}
function relativeEvidence(value: unknown, outDir: string): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'evidence' && Array.isArray(child)) {
      for (let i = 0; i < child.length; i++) {
        const path = child[i] as string;
        const full = path.startsWith('/') ? path : join(outDir, path);
        if (!within(outDir, full)) throw Error('Evidence escapes output');
        child[i] = relative(outDir, full);
      }
    } else relativeEvidence(child, outDir);
  }
}
async function atomic(
  outDir: string,
  name: string,
  content: string,
): Promise<void> {
  const temporary = join(outDir, `.atomic-${crypto.randomUUID()}`);
  await writeFile(temporary, content, { flag: 'wx' });
  await rename(temporary, join(outDir, name));
}
export async function writeReport(
  report: EvalReport,
  outDir: string,
  options: { secrets?: readonly string[] } = {},
): Promise<void> {
  relativeEvidence(report, outDir);
  const secrets = [...new Set(options.secrets?.filter(Boolean) ?? [])];
  const redacted: string[] = [];
  let changed = false;
  function sanitize(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'string') {
        const clean = secrets.reduce(
          (s, secret) => s.replaceAll(secret, '[REDACTED]'),
          child,
        );
        if (clean !== child) {
          changed = true;
          (value as Record<string, unknown>)[key] = clean;
        }
      } else sanitize(child);
    }
  }
  sanitize(report);
  report.artifacts = await artifacts(outDir, secrets, redacted);
  report.redaction = {
    applied: changed || redacted.length > 0,
    artifacts: redacted,
    marker: '[REDACTED]',
  };
  report.metrics = computeMetrics(report);
  reportSchema.parse(report);
  const json = JSON.stringify(report, null, 2) + '\n';
  const markdown = renderMarkdown(JSON.parse(json) as EvalReport);
  await atomic(outDir, 'report.json', json);
  await atomic(outDir, 'report.md', markdown);
  const manifest = [
    ...report.artifacts,
    {
      path: 'report.json',
      sha256: sha256(json),
      bytes: Buffer.byteLength(json),
    },
    {
      path: 'report.md',
      sha256: sha256(markdown),
      bytes: Buffer.byteLength(markdown),
    },
  ];
  await atomic(
    outDir,
    'artifact-manifest.json',
    JSON.stringify({ schemaVersion: 1, artifacts: manifest }, null, 2) + '\n',
  );
}
