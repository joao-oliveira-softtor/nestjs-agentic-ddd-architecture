import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { stableStringify } from '@agentic-ddd/compiler';
import {
  available,
  emptyUsage,
  manifestSchema,
  unavailable,
  type EvalReport,
  type ItemAttempt,
  type Measured,
  type Usage,
} from './contracts';
import { reportSchema } from './report-schema';
import { sha256 } from './isolation';
import { readPrivateBytes } from './private-files';
import { judge, parseAnswer, parseImplementationReply } from './judge';
import { finalVerificationState } from './final-verification';
import { TASK_ITEMS } from './audit';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const file = z.strictObject({
  path: z
    .string()
    .min(1)
    .refine((p) => !/[\0\r\n]/.test(p)),
  sha256: hash,
});
export const campaignSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    runs: z
      .array(
        z.strictObject({
          id: z.string().min(1),
          configuration: z.string().min(1),
          repetition: z.number().int().min(1).max(3),
          plannedCases: z.number().int().positive(),
          manifest: file,
          result: z.discriminatedUnion('status', [
            z.strictObject({ status: z.literal('executed'), report: file }),
            z.strictObject({
              status: z.literal('not_run'),
              reason: z.string().min(1),
            }),
          ]),
        }),
      )
      .min(3),
  })
  .superRefine((c, ctx) => {
    const ids = new Set<string>(),
      slots = new Set<string>();
    for (const r of c.runs) {
      const slot = JSON.stringify([r.configuration, r.repetition]);
      if (ids.has(r.id) || slots.has(slot))
        ctx.addIssue({
          code: 'custom',
          message: 'Duplicate campaign ID or repetition',
        });
      ids.add(r.id);
      slots.add(slot);
    }
    for (const config of new Set(c.runs.map((r) => r.configuration)))
      if (c.runs.filter((r) => r.configuration === config).length !== 3)
        ctx.addIssue({
          code: 'custom',
          message:
            'Exactly three planned repetitions per configuration required',
        });
  });
type Slot = z.infer<typeof campaignSchema>['runs'][number];
interface Executed {
  slot: Slot;
  report: EvalReport;
}
// Metrics are derived output; older reports without this field remain readable.
const inputReportSchema = reportSchema.extend({
  metrics: reportSchema.shape.metrics.optional(),
});
async function bytes(path: string, limit = 32 * 1024 * 1024) {
  const parent = await realpath(dirname(path));
  return readPrivateBytes(parent, join(parent, path.split('/').at(-1)!), limit);
}
async function checkedFile(root: string, ref: z.infer<typeof file>) {
  const path = resolve(root, ref.path),
    data = await bytes(path);
  if (sha256(data) !== ref.sha256) throw Error(`Hash mismatch: ${ref.path}`);
  return data;
}
function unique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw Error(`Duplicate ${label}`);
}
async function verifyArtifacts(path: string, report: EvalReport) {
  const root = dirname(path);
  const ledger = z
    .strictObject({
      schemaVersion: z.literal(1),
      artifacts: reportSchema.shape.artifacts,
    })
    .parse(
      JSON.parse(
        (await bytes(join(root, 'artifact-manifest.json'))).toString(),
      ),
    );
  unique(
    ledger.artifacts.map((a) => a.path),
    'artifact paths',
  );
  const expected = [...report.artifacts, 'report.json', 'report.md'];
  if (ledger.artifacts.length !== expected.length)
    throw Error('Artifact ledger differs from report');
  for (const ref of report.artifacts)
    if (
      !ledger.artifacts.some((a) => stableStringify(a) === stableStringify(ref))
    )
      throw Error('Artifact metadata mismatch');
  for (const name of ['report.json', 'report.md'])
    if (!ledger.artifacts.some((a) => a.path === name))
      throw Error(`Missing ${name} hash`);
  const referenced = new Set(
    report.cases.flatMap((c) => c.execution?.evidence ?? []),
  );
  for (const benchmark of report.benchmarks) {
    for (const item of benchmark.items)
      for (const attempt of item.attempts) {
        attempt.execution.evidence.forEach((path) => referenced.add(path));
        for (const command of attempt.verification?.commands ?? []) {
          command.result.evidence.forEach((path) => referenced.add(path));
          // JUnit is read by the verifier outside runProcess's stream ledger.
          if (
            ['executor-tests', 'reference-tests'].includes(command.name) &&
            command.result.evidence.length
          ) {
            referenced.add(
              join(
                dirname(dirname(command.result.evidence[0]!)),
                command.name === 'executor-tests'
                  ? 'executor-junit.xml'
                  : 'reference-junit.xml',
              ),
            );
          }
        }
      }
    benchmark.finalVerification?.command.result.evidence.forEach((path) =>
      referenced.add(path),
    );
  }
  for (const path of referenced)
    if (!report.artifacts.some((a) => a.path === path))
      throw Error(`Missing referenced evidence: ${path}`);
  for (const ref of ledger.artifacts) {
    const data = await readPrivateBytes(
      root,
      join(root, ref.path),
      32 * 1024 * 1024,
    );
    if (data.length !== ref.bytes || sha256(data) !== ref.sha256)
      throw Error(`Artifact hash mismatch: ${ref.path}`);
  }
}
function validateRows(report: EvalReport, slot: Slot) {
  const configurations = new Set(
    report.manifest.configurations.map((c) => c.id),
  );
  unique(
    report.cases.map((c) =>
      stableStringify([c.configuration, c.dataset, c.id]),
    ),
    'case IDs',
  );
  unique(
    report.benchmarks.map((b) => b.configuration),
    'benchmark IDs',
  );
  const datasets = new Set(report.manifest.skillDatasets.map((d) => d.path));
  if (
    report.cases.some(
      (c) => !configurations.has(c.configuration) || !datasets.has(c.dataset),
    )
  )
    throw Error('Case outside effective manifest');
  if (report.benchmarks.some((b) => !configurations.has(b.configuration)))
    throw Error('Benchmark outside effective manifest');
  if (
    report.cases.filter((c) => c.configuration === slot.configuration)
      .length !== slot.plannedCases
  )
    throw Error('Planned case count mismatch');
  if (!report.benchmarks.some((b) => b.configuration === slot.configuration))
    throw Error('Missing planned benchmark');
  for (const b of report.benchmarks) {
    unique(
      b.items.map((i) => i.item),
      'packet IDs',
    );
    if (
      b.items
        .map((i) => i.item)
        .sort()
        .join() !==
      TASK_ITEMS.map((i) => i.id)
        .sort()
        .join()
    )
      throw Error('Unexpected packets');
    for (const i of b.items) {
      unique(
        i.attempts.map((a) => String(a.number)),
        'attempt IDs',
      );
      for (const a of i.attempts)
        if (a.handoff.item !== i.item || a.handoff.specHash !== i.specHash)
          throw Error('Attempt contract differs from frozen packet');
    }
  }
}
function accepted(attempt: ItemAttempt | undefined) {
  if (!attempt) return false;
  let reply;
  try {
    reply = parseImplementationReply(attempt.execution.finalText ?? '');
  } catch {
    return false;
  }
  const v = attempt.verification;
  const green = (t: NonNullable<typeof v>['executorTests']) =>
    !!t &&
    t.exitCode === 0 &&
    !t.collectionError &&
    !t.emptySuite &&
    t.cases.length > 0 &&
    t.cases.every((c) => c.status === 'passed');
  return (
    attempt.execution.transport === 'finished' &&
    attempt.execution.exitCode === 0 &&
    reply.status === 'done' &&
    attempt.audit?.ok === true &&
    attempt.audit.findings.length === 0 &&
    !!v &&
    v.findings.length === 0 &&
    v.itemReport?.item === attempt.handoff.item &&
    v.itemReport.status === 'done' &&
    v.itemReport.gates
      .map((g) => g.id)
      .sort()
      .join() === 'I1,I2,I3,I4,I5' &&
    v.itemReport.gates.every((g) => g.status === 'passed') &&
    green(v.executorTests) &&
    green(v.referenceTests) &&
    attempt.handoff.criteria.every((c) =>
      v.executorTests!.cases.some(
        (t) =>
          t.status === 'passed' && t.covers.includes(`criterion:0001/${c.id}`),
      ),
    ) &&
    ['verify-item', 'executor-tests', 'reference-tests', 'compile-check'].every(
      (name) =>
        v.commands.some(
          (c) =>
            c.name === name &&
            c.result.transport === 'finished' &&
            c.result.exitCode === 0,
        ),
    )
  );
}
function verdict(c: EvalReport['cases'][number]) {
  if (!c.execution) return 'not_run';
  const e = c.execution;
  if (e.transport === 'timeout') return 'timeout';
  if (e.transport !== 'finished' || e.exitCode !== 0) return 'infra_error';
  try {
    return judge(c.expect, parseAnswer(e.finalText ?? ''));
  } catch {
    return 'malformed';
  }
}
const rate = (numerator: number, denominator: number) => ({
  numerator,
  denominator,
  value: denominator
    ? available(numerator / denominator, 'evidence_counts')
    : unavailable<number>('zero_denominator'),
});
function sumUsage(usage: Usage[], complete: boolean): Usage {
  const token = (
    key: 'inputTokens' | 'cachedInputTokens' | 'outputTokens',
  ): Measured<number> =>
    complete &&
    usage.length > 0 &&
    usage.every((u) => u[key].status === 'available')
      ? available(
          usage.reduce(
            (n, u) => n + (u[key].status === 'available' ? u[key].value : 0),
            0,
          ),
          'evidence_usage_sum',
        )
      : unavailable('incomplete_measurements');
  const costs = usage.map((u) => u.cost);
  const currencies = new Set(
    costs.flatMap((c) => (c.status === 'available' ? [c.value.currency] : [])),
  );
  return {
    inputTokens: token('inputTokens'),
    cachedInputTokens: token('cachedInputTokens'),
    outputTokens: token('outputTokens'),
    cost:
      complete &&
      costs.length > 0 &&
      costs.every((c) => c.status === 'available') &&
      currencies.size === 1
        ? available(
            {
              amount: costs.reduce(
                (n, c) => n + (c.status === 'available' ? c.value.amount : 0),
                0,
              ),
              currency: [...currencies][0]!,
            },
            'evidence_cost_sum',
          )
        : unavailable('incomplete_or_incompatible_costs'),
  };
}
function summarize(executed: Executed[], planned: Slot[]) {
  let correctCases = 0,
    evaluableCases = 0,
    initialItems = 0,
    finalItems = 0,
    certifiedRuns = 0,
    corrections = 0,
    protocolFailures = 0,
    behaviorFailures = 0,
    infrastructureFailures = 0,
    timeouts = 0,
    budgetExhaustedRuns = 0,
    notRunCases = 0;
  const usage: Usage[] = [];
  for (const { slot, report } of executed) {
    if (report.status === 'budget_exhausted') budgetExhaustedRuns++;
    for (const c of report.cases.filter(
      (c) => c.configuration === slot.configuration,
    )) {
      const v = verdict(c);
      if (c.execution) usage.push(c.execution.usage);
      if (['correct', 'incorrect', 'malformed', 'timeout'].includes(v))
        evaluableCases++;
      if (v === 'correct') correctCases++;
      if (v === 'incorrect') behaviorFailures++;
      if (v === 'malformed') protocolFailures++;
      if (v === 'timeout') timeouts++;
      if (v === 'infra_error') infrastructureFailures++;
      if (v === 'not_run') notRunCases++;
    }
    const b = report.benchmarks.find(
      (b) => b.configuration === slot.configuration,
    )!;
    let final = 0;
    for (const i of b.items) {
      if (accepted(i.attempts[0])) initialItems++;
      if (accepted(i.attempts.at(-1))) {
        finalItems++;
        final++;
      }
      corrections += Math.max(0, i.attempts.length - 1);
      for (const a of i.attempts) {
        usage.push(a.execution.usage);
        if (
          a.execution.transport === 'infra_error' ||
          (a.execution.transport === 'finished' && a.execution.exitCode !== 0)
        ) {
          infrastructureFailures++;
          continue;
        }
        if (a.execution.transport === 'timeout') {
          timeouts++;
          continue;
        }
        if (a.execution.transport !== 'finished') continue;
        const verifierCommands = a.verification?.commands ?? [];
        if (
          verifierCommands.some(
            (c) =>
              c.result.transport === 'infra_error' ||
              c.result.transport === 'cancelled',
          )
        ) {
          infrastructureFailures++;
          continue;
        }
        if (verifierCommands.some((c) => c.result.transport === 'timeout')) {
          timeouts++;
          continue;
        }
        try {
          parseImplementationReply(a.execution.finalText ?? '');
        } catch {
          protocolFailures++;
          continue;
        }
        if (!accepted(a)) behaviorFailures++;
      }
    }
    if (finalVerificationState(b.finalVerification) === 'infra_error')
      infrastructureFailures++;
    if (
      final === 5 &&
      finalVerificationState(b.finalVerification) === 'verified' &&
      b.finalVerification?.report?.status === 'done' &&
      report.provenance.originAfter.status === 'available' &&
      report.provenance.originBefore === report.provenance.originAfter.value
    )
      certifiedRuns++;
  }
  const plannedCases = planned.reduce((n, r) => n + r.plannedCases, 0);
  return {
    plannedRuns: planned.length,
    executedRuns: executed.length,
    plannedCases,
    evaluableCases,
    correctCases,
    plannedItems: 5 * planned.length,
    initialItems,
    finalItems,
    certifiedRuns,
    corrections,
    protocolFailures,
    behaviorFailures,
    infrastructureFailures,
    timeouts,
    budgetExhaustedRuns,
    notRunCases,
    accuracy: rate(correctCases, evaluableCases),
    coverage: rate(evaluableCases, plannedCases),
    initial: rate(initialItems, 5 * planned.length),
    final: rate(finalItems, 5 * planned.length),
    certification: rate(certifiedRuns, planned.length),
    usage: usage.length
      ? sumUsage(usage, executed.length === planned.length && notRunCases === 0)
      : emptyUsage(),
  };
}
function grouping({ slot, report }: Executed) {
  const c = report.manifest.configurations.find(
    (c) => c.id === slot.configuration,
  )!;
  const cases = report.cases.filter(
    (c) => c.configuration === slot.configuration,
  );
  const b = report.benchmarks.find(
    (b) => b.configuration === slot.configuration,
  )!;
  const metadata = (value: Measured<string>) =>
    value.status === 'available'
      ? { status: value.status, value: value.value }
      : { status: value.status, reason: value.reason };
  const executions = [
    ...cases.flatMap((c) => (c.execution ? [c.execution] : [])),
    ...b.items.flatMap((i) => i.attempts.map((a) => a.execution)),
  ];
  const observed = [
    ...new Set(
      executions.map((e) =>
        stableStringify({
          model: metadata(e.observedModel),
          revision: metadata(e.modelRevision),
        }),
      ),
    ),
  ]
    .sort()
    .map((s) => JSON.parse(s) as unknown);
  return {
    mode: report.mode,
    source: report.provenance.sourceCommit,
    runner: report.provenance.runnerCommit,
    configuration: c,
    adapter: report.provenance.adapters[c.id] ?? null,
    environment: {
      platform: report.provenance.platform,
      bun: report.provenance.bun,
      nativeToolAccess: report.provenance.nativeToolAccess ?? null,
    },
    budget: report.manifest.budget,
    datasets: report.manifest.skillDatasets,
    cases: cases
      .map((c) => ({
        dataset: c.dataset,
        id: c.id,
        audience: c.audience,
        question: c.question,
        expect: c.expect,
        datasetSha256: c.datasetSha256,
        contextHash: c.contextHash,
      }))
      .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b))),
    packets: b.items
      .map((i) => ({
        item: i.item,
        specHash: i.specHash,
      }))
      .sort((a, b) => a.item.localeCompare(b.item)),
    observed,
  };
}
export async function aggregateCampaign(path: string) {
  const indexBytes = await bytes(resolve(path));
  const index = campaignSchema.parse(JSON.parse(indexBytes.toString()));
  const root = dirname(resolve(path));
  const executed: Executed[] = [];
  const reportIds = new Set<string>();
  for (const slot of index.runs) {
    const manifest = manifestSchema.parse(
      JSON.parse((await checkedFile(root, slot.manifest)).toString()),
    );
    if (!manifest.configurations.some((c) => c.id === slot.configuration))
      throw Error('Configuration absent from planned manifest');
    if (slot.result.status === 'not_run') continue;
    const report = inputReportSchema.parse(
      JSON.parse((await checkedFile(root, slot.result.report)).toString()),
    ) as EvalReport;
    if (reportIds.has(report.id)) throw Error('Duplicate report ID');
    reportIds.add(report.id);
    if (
      stableStringify(report.manifest) !== stableStringify(manifest) ||
      report.manifestSha256 !== sha256(stableStringify(report.manifest))
    )
      throw Error('Effective manifest mismatch');
    validateRows(report, slot);
    await verifyArtifacts(resolve(root, slot.result.report.path), report);
    executed.push({ slot, report });
  }
  const groups = new Map<
    string,
    { key: ReturnType<typeof grouping>; runs: Executed[] }
  >();
  for (const r of executed) {
    const key = grouping(r),
      id = sha256(stableStringify(key));
    const group = groups.get(id) ?? { key, runs: [] };
    group.runs.push(r);
    groups.set(id, group);
  }
  return {
    schemaVersion: 1 as const,
    id: index.id,
    campaignSha256: sha256(indexBytes),
    configurations: [...new Set(index.runs.map((r) => r.configuration))]
      .sort()
      .map((configuration) => ({
        configuration,
        ...summarize(
          executed.filter((r) => r.slot.configuration === configuration),
          index.runs.filter((r) => r.configuration === configuration),
        ),
        notRun: index.runs
          .filter(
            (r) =>
              r.configuration === configuration &&
              r.result.status === 'not_run',
          )
          .map((r) => ({
            id: r.id,
            repetition: r.repetition,
            reason: r.result.status === 'not_run' ? r.result.reason : '',
          })),
      })),
    groups: [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, g]) => ({
        id,
        provenance: g.key,
        ...summarize(
          g.runs,
          g.runs.map((r) => r.slot),
        ),
        runs: g.runs.map((r) => ({
          id: r.slot.id,
          reportId: r.report.id,
          repetition: r.slot.repetition,
          reportSha256:
            r.slot.result.status === 'executed'
              ? r.slot.result.report.sha256
              : null,
          status: r.report.status,
        })),
        baselines: g.runs.map((r) => ({
          run: r.slot.id,
          baselineHash: r.report.benchmarks.find(
            (b) => b.configuration === r.slot.configuration,
          )!.baselineHash,
          attempts: r.report.benchmarks
            .find((b) => b.configuration === r.slot.configuration)!
            .items.flatMap((i) =>
              i.attempts.map((a) => ({
                item: i.item,
                number: a.number,
                hash: a.baselineHash,
              })),
            ),
        })),
      })),
  };
}
export type CampaignReport = Awaited<ReturnType<typeof aggregateCampaign>>;
const escape = (value: string) =>
  value.replaceAll('|', '\\|').replaceAll('\n', ' ').replaceAll('<', '&lt;');
export function renderAggregate(report: CampaignReport) {
  const lines = [
    `# Campanha ${escape(report.id)}`,
    '',
    `Índice SHA-256: ${report.campaignSha256}.`,
    '',
    'Comparação descritiva. Denominadores da configuração incluem todas as posições planejadas. Grupos incluem somente runs executados: a proveniência de posições não executadas permanece desconhecida.',
    'A tabela por configuração é um inventário de resultados e cobertura. Comparações com os mesmos inputs e proveniência usam os grupos abaixo; divergências permanecem separadas.',
    '',
    '| Configuração | Runs executados/planejados | Acurácia | Cobertura planejada | Itens inicial/final/planejados | Certificações | Correções |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const c of report.configurations) {
    lines.push(
      `| ${escape(c.configuration)} | ${c.executedRuns}/${c.plannedRuns} | ${c.correctCases}/${c.evaluableCases} | ${c.evaluableCases}/${c.plannedCases} | ${c.initialItems}/${c.finalItems}/${c.plannedItems} | ${c.certifiedRuns}/${c.plannedRuns} | ${c.corrections} |`,
    );
  }
  for (const c of report.configurations) {
    lines.push(
      `\nFalhas ${escape(c.configuration)}: protocolo ${c.protocolFailures}, comportamento ${c.behaviorFailures}, infraestrutura ${c.infrastructureFailures}, timeouts ${c.timeouts}; orçamento esgotado em ${c.budgetExhaustedRuns} run(s).`,
    );
    for (const r of c.notRun)
      lines.push(
        `- ${escape(r.id)} (repetição ${r.repetition}): não executado — ${escape(r.reason)}.`,
      );
    lines.push(
      `Uso ${escape(c.configuration)}: ${escape(JSON.stringify(c.usage))}.`,
    );
  }
  lines.push(
    '',
    'Grupos por fonte/runner, configuração, adapter, ambiente, dataset/contexto, contratos e modelo/revisão observados:',
    '',
  );
  for (const g of report.groups) {
    lines.push(
      `- ${g.id}: ${g.runs.map((r) => escape(r.id)).join(', ')}; fonte ${g.provenance.source}; runner ${g.provenance.runner}; observados ${escape(JSON.stringify(g.provenance.observed))}; certificações ${g.certifiedRuns}/${g.executedRuns}.`,
    );
    lines.push(
      `  Acurácia ${g.correctCases}/${g.evaluableCases}; cobertura ${g.evaluableCases}/${g.plannedCases}; itens inicial/final ${g.initialItems}/${g.finalItems} de ${g.plannedItems}; correções ${g.corrections}; protocolo ${g.protocolFailures}, comportamento ${g.behaviorFailures}, infraestrutura ${g.infrastructureFailures}, timeouts ${g.timeouts}, orçamento ${g.budgetExhaustedRuns} run(s).`,
    );
    lines.push(
      `  Baselines brutos por run (não definem equivalência): ${escape(JSON.stringify(g.baselines))}.`,
    );
  }
  return lines.join('\n') + '\n';
}
export async function main(argv: readonly string[]) {
  try {
    if (argv.length === 1 && argv[0] === '--help') {
      console.log(
        'Uso: bun run evals:aggregate --campaign <índice.json> --out <diretório novo>',
      );
      return 0;
    }
    let campaign: string | undefined, out: string | undefined;
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i],
        value = argv[++i];
      if (!value || value.startsWith('--')) throw Error('Missing argument');
      if (arg === '--campaign' && !campaign) campaign = value;
      else if (arg === '--out' && !out) out = value;
      else throw Error('Unknown or duplicate argument');
    }
    if (!campaign || !out) throw Error('Expected --campaign and --out');
    if (await lstat(resolve(out)).catch(() => null))
      throw Error('Output already exists');
    const report = await aggregateCampaign(resolve(campaign));
    await mkdir(resolve(out), { recursive: false });
    const json = JSON.stringify(report, null, 2) + '\n',
      markdown = renderAggregate(report);
    await writeFile(join(out, 'aggregate.json'), json);
    await writeFile(join(out, 'aggregate.md'), markdown);
    await writeFile(
      join(out, 'artifact-manifest.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          artifacts: [
            {
              path: 'aggregate.json',
              sha256: sha256(json),
              bytes: Buffer.byteLength(json),
            },
            {
              path: 'aggregate.md',
              sha256: sha256(markdown),
              bytes: Buffer.byteLength(markdown),
            },
          ],
        },
        null,
        2,
      ) + '\n',
    );
    return 0;
  } catch (error) {
    console.error(String(error));
    return 2;
  }
}
if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
