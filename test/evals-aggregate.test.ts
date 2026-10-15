import { afterEach, expect, test as bunTest } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stableStringify } from '@agentic-ddd/compiler';
import {
  aggregateCampaign,
  main,
  nearestRank,
  renderAggregate,
} from '../scripts/evals/aggregate';
import { sha256 } from '../scripts/evals/isolation';
import { computeMetrics, writeReport } from '../scripts/evals/report';
import {
  available,
  emptyUsage,
  type EvalReport,
  type Usage,
} from '../scripts/evals/contracts';
const roots: string[] = [];
// Fixtures retain and hash raw evidence, including multiple campaign variants.
const test = (name: string, body: () => Promise<void>) =>
  bunTest.skipIf(process.env.AGENTIC_DDD_VERIFY === '1')(name, body, 60000);
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function campaign(executed = 3) {
  const root = await mkdtemp(join(tmpdir(), 'eval-campaign-'));
  roots.push(root);
  const historical = (await Bun.file(
    join(
      import.meta.dir,
      '../docs/superpowers/validation/2026-10-09-plan6/reference/report.json',
    ),
  ).json()) as EvalReport;
  const config = historical.manifest.configurations[0]!;
  const manifest = { ...historical.manifest, configurations: [config] };
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  const manifestHash = sha256(await readFile(join(root, 'manifest.json')));
  const runs = [];
  for (let repetition = 1; repetition <= 3; repetition++) {
    const entry = {
      id: `run-${repetition}`,
      configuration: config.id,
      repetition,
      plannedCases: 5,
      manifest: { path: 'manifest.json', sha256: manifestHash },
    };
    if (repetition > executed) {
      runs.push({
        ...entry,
        result: { status: 'not_run', reason: 'budget_not_authorized' },
      });
      continue;
    }
    const report: EvalReport = structuredClone(historical);
    report.id = `report-${repetition}`;
    report.manifest = manifest;
    report.manifestSha256 = sha256(stableStringify(manifest));
    report.cases = report.cases.filter((c) => c.configuration === config.id);
    for (const c of report.cases) {
      c.verdict = 'correct';
      c.answer = c.expect;
      c.execution = {
        ...c.execution!,
        transport: 'finished',
        exitCode: 0,
        finalText: JSON.stringify(c.expect),
        usage: emptyUsage(),
      };
    }
    report.provenance.adapters = {
      [config.id]: report.provenance.adapters[config.id]!,
    };
    report.benchmarks = report.benchmarks.filter(
      (b) => b.configuration === config.id,
    );
    for (const b of report.benchmarks) {
      b.finalVerification = null;
      for (const i of b.items) {
        i.state = 'not_run';
        i.attempts = [];
      }
    }
    report.artifacts = [];
    report.invocations = 5;
    const folder = join(root, entry.id);
    await mkdir(folder);
    // Preserve the raw evidence referenced by the historical report fixture.
    const template = historical.benchmarks[0]!.items[0]!.attempts[0]!;
    const commands = template.verification!.commands;
    const references = new Set([
      ...report.cases.flatMap((c) => c.execution?.evidence ?? []),
      ...template.execution.evidence,
      ...commands.flatMap((c) => c.result.evidence),
      ...historical.benchmarks[0]!.finalVerification!.command.result.evidence,
      ...commands
        .filter((c) => ['executor-tests', 'reference-tests'].includes(c.name))
        .map((c) =>
          join(
            dirname(dirname(c.result.evidence[0]!)),
            c.name === 'executor-tests'
              ? 'executor-junit.xml'
              : 'reference-junit.xml',
          ),
        ),
    ]);
    for (const path of references) {
      await mkdir(dirname(join(folder, path)), { recursive: true });
      await writeFile(
        join(folder, path),
        await readFile(
          join(
            import.meta.dir,
            '../docs/superpowers/validation/2026-10-09-plan6/reference',
            path,
          ),
        ),
      );
    }
    await writeReport(report, folder);
    runs.push({
      ...entry,
      result: {
        status: 'executed',
        report: {
          path: `${entry.id}/report.json`,
          sha256: sha256(await readFile(join(folder, 'report.json'))),
        },
      },
    });
  }
  const index = { schemaVersion: 1, id: 'campaign', runs };
  const path = join(root, 'index.json');
  await writeFile(path, JSON.stringify(index));
  return { root, path, index, config };
}
async function mutate(
  fixture: Awaited<ReturnType<typeof campaign>>,
  modify: (report: EvalReport) => void,
  repetition = 1,
) {
  const path = join(fixture.root, `run-${repetition}/report.json`);
  const report = (await Bun.file(path).json()) as EvalReport;
  modify(report);
  await writeReport(report, join(fixture.root, `run-${repetition}`));
  (
    fixture.index.runs[repetition - 1]!.result as { report: { sha256: string } }
  ).report.sha256 = sha256(await readFile(path));
  await writeFile(fixture.path, JSON.stringify(fixture.index));
}
async function rejectsIndex(path: string, message?: string) {
  let caught: unknown;
  try {
    await aggregateCampaign(path);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  if (message) expect(String(caught)).toContain(message);
}
test('complete and partial campaigns preserve planned/executed denominators and deterministic output', async () => {
  for (const n of [3, 1, 0]) {
    const f = await campaign(n),
      a = await aggregateCampaign(f.path);
    expect(a).toEqual(await aggregateCampaign(f.path));
    expect(a.configurations[0]).toMatchObject({
      plannedRuns: 3,
      executedRuns: n,
      plannedCases: 15,
      evaluableCases: 5 * n,
      correctCases: 5 * n,
      plannedItems: 15,
    });
    expect(a.configurations[0]!.coverage).toMatchObject({
      numerator: 5 * n,
      denominator: 15,
    });
    expect(a.configurations[0]!.accuracy).toMatchObject({
      numerator: 5 * n,
      denominator: 5 * n,
    });
    expect(a.configurations[0]!.notRun).toHaveLength(3 - n);
    expect(a.configurations[0]!.usage.cost.status).toBe('unavailable');
    expect(a.groups).toHaveLength(n ? 1 : 0);
    expect(
      await main(['--campaign', f.path, '--out', join(f.root, 'aggregate')]),
    ).toBe(0);
    const json = await readFile(
      join(f.root, 'aggregate/aggregate.json'),
      'utf8',
    );
    expect(JSON.parse(json)).toEqual(a);
    const markdown = await readFile(
      join(f.root, 'aggregate/aggregate.md'),
      'utf8',
    );
    expect(markdown).toContain(`${n}/3`);
    expect(
      await main(['--campaign', f.path, '--out', join(f.root, 'aggregate')]),
    ).toBe(2);
  }
});
test('recomputes answer correctness and acceptance rather than trusting derived metrics and flags', async () => {
  const f = await campaign();
  await mutate(f, (report) => {
    report.cases[0]!.verdict = 'incorrect';
    report.metrics!.skills[0]!.accuracy.numerator = 999;
    report.benchmarks[0]!.items[0]!.state = 'accepted';
    // Final "done" alone, with no accepted attempts, cannot certify the change.
    report.metrics!.benchmarks[0]!.final.numerator = 5;
  });
  const a = await aggregateCampaign(f.path);
  expect(a.configurations[0]).toMatchObject({
    correctCases: 15,
    initialItems: 0,
    finalItems: 0,
    certifiedRuns: 0,
  });
  await mutate(f, (report) => {
    delete report.metrics;
    report.cases[0]!.execution!.finalText = '{"type":"exact","value":"wrong"}';
  });
  expect(
    (await aggregateCampaign(f.path)).configurations[0]!.correctCases,
  ).toBe(14);
});
test('separates requested configuration, source/runner/adapter/environment/context/packet and observed metadata', async () => {
  const mutations: ((r: EvalReport) => void)[] = [
    (r) => {
      r.provenance.sourceCommit = '1'.repeat(40);
    },
    (r) => {
      r.provenance.runnerCommit = '2'.repeat(40);
    },
    (r) => {
      r.provenance.adapters[fallbackId(r)]!.version = 'other';
    },
    (r) => {
      r.provenance.adapters[fallbackId(r)]!.executableSha256 = '3'.repeat(64);
    },
    (r) => {
      r.provenance.bun = 'other';
    },
    (r) => {
      r.provenance.platform = 'other';
    },
    (r) => {
      r.cases[0]!.contextHash = '4'.repeat(64);
    },
    (r) => {
      r.cases[0]!.datasetSha256 = '5'.repeat(64);
    },
    (r) => {
      r.benchmarks[0]!.items[0]!.specHash = '6'.repeat(64);
    },
    (r) => {
      r.cases[0]!.execution!.observedModel = available('other', 'native');
    },
    (r) => {
      r.cases[0]!.execution!.modelRevision = available('other', 'native');
    },
  ];
  for (const change of mutations) {
    const f = await campaign();
    await mutate(f, change);
    expect((await aggregateCampaign(f.path)).groups).toHaveLength(2);
  }
  const f = await campaign();
  await mutate(f, (r) => {
    r.benchmarks[0]!.baselineHash = '7'.repeat(64);
    r.provenance.originBefore = '8'.repeat(64);
  });
  const a = await aggregateCampaign(f.path);
  expect(a.groups).toHaveLength(1);
  expect(a.groups[0]!.baselines).toHaveLength(3);
});
function fallbackId(r: EvalReport) {
  return r.manifest.configurations[0]!.id;
}
test('rejects duplicate slots, report IDs, case IDs, incompatible schema and declared hash mismatches', async () => {
  for (const defect of [
    'slot',
    'report-id',
    'case-id',
    'schema',
    'manifest-hash',
    'report-hash',
    'artifact-hash',
    'effective-manifest',
    'missing-slot',
  ]) {
    const f = await campaign();
    if (defect === 'slot') f.index.runs[1]!.id = f.index.runs[0]!.id;
    if (defect === 'missing-slot') f.index.runs.pop();
    if (defect === 'report-id')
      await mutate(f, (r) => {
        r.id = 'report-2';
      });
    if (defect === 'case-id')
      await mutate(f, (r) => {
        r.cases[1]!.id = r.cases[0]!.id;
      });
    if (defect === 'schema') {
      const p = join(f.root, 'run-1/report.json');
      const r = await Bun.file(p).json();
      r.schemaVersion = 2;
      await Bun.write(p, JSON.stringify(r));
      (
        f.index.runs[0]!.result as { report: { sha256: string } }
      ).report.sha256 = sha256(await readFile(p));
    }
    if (defect === 'manifest-hash')
      f.index.runs[0]!.manifest.sha256 = '0'.repeat(64);
    if (defect === 'report-hash')
      (
        f.index.runs[0]!.result as { report: { sha256: string } }
      ).report.sha256 = '0'.repeat(64);
    if (defect === 'artifact-hash')
      await writeFile(join(f.root, 'run-1/report.md'), 'changed');
    if (defect === 'effective-manifest')
      await mutate(f, (r) => {
        r.manifest = {
          ...r.manifest,
          budget: { ...r.manifest.budget, maxInvocations: 29 },
        };
        r.manifestSha256 = sha256(stableStringify(r.manifest));
      });
    await writeFile(f.path, JSON.stringify(f.index));
    await rejectsIndex(f.path);
  }
});
test('incomplete token measurements and distinct currencies remain unavailable', async () => {
  const f = await campaign();
  await mutate(f, (r) => {
    for (const c of r.cases)
      c.execution!.usage = {
        inputTokens: available(10, 'native'),
        cachedInputTokens: available(0, 'native'),
        outputTokens: available(2, 'native'),
        cost: available({ amount: 1, currency: 'USD' }, 'native'),
      };
  });
  const a = await aggregateCampaign(f.path);
  expect(a.configurations[0]!.usage.inputTokens.status).toBe('unavailable');
  for (const repetition of [2, 3])
    await mutate(
      f,
      (r) => {
        for (const c of r.cases)
          c.execution!.usage = {
            inputTokens: available(10, 'native'),
            cachedInputTokens: available(0, 'native'),
            outputTokens: available(2, 'native'),
            cost: available(
              { amount: 1, currency: repetition === 2 ? 'BRL' : 'USD' },
              'native',
            ),
          };
      },
      repetition,
    );
  const mixed = await aggregateCampaign(f.path);
  expect(mixed.configurations[0]!.usage.inputTokens).toMatchObject({
    status: 'available',
    value: 150,
  });
  expect(mixed.configurations[0]!.usage.cost.status).toBe('unavailable');
  await mutate(
    f,
    (r) => {
      for (const c of r.cases)
        c.execution!.usage.cost = available(
          { amount: 1, currency: 'USD' },
          'native',
        );
    },
    2,
  );
  expect(
    (await aggregateCampaign(f.path)).configurations[0]!.usage.cost,
  ).toMatchObject({
    status: 'available',
    value: { amount: 15, currency: 'USD' },
  });
  // A revisão despachada entra no uso e no custo do braço.
  await mutate(f, (r) => {
    const execution = r.cases[0]!.execution!;
    r.benchmarks[0]!.review = {
      outcome: 'approved',
      dispatched: true,
      execution: {
        ...execution,
        usage: {
          ...execution.usage,
          inputTokens: available(7, 'native'),
          cost: available({ amount: 2, currency: 'USD' }, 'native'),
        },
      },
      briefTokens: 100,
      findings: 0,
      reason: null,
    };
  });
  const reviewed = await aggregateCampaign(f.path);
  expect(reviewed.configurations[0]!.usage.inputTokens).toMatchObject({
    value: 157,
  });
  expect(reviewed.configurations[0]!.usage.cost).toMatchObject({
    value: { amount: 17, currency: 'USD' },
  });
  const report = (await Bun.file(
    join(f.root, 'run-1/report.json'),
  ).json()) as EvalReport;
  expect(computeMetrics(report).usage[f.config.id]!.inputTokens).toMatchObject({
    value: 57,
  });
});

test('item completion and certification derive from executed gates and both test suites', async () => {
  const f = await campaign();
  const historical = (await Bun.file(
    join(
      import.meta.dir,
      '../docs/superpowers/validation/2026-10-09-plan6/reference/report.json',
    ),
  ).json()) as EvalReport;
  const template = historical.benchmarks[0]!.items[0]!.attempts[0]!;
  await mutate(f, (report) => {
    const benchmark = report.benchmarks[0]!;
    for (const item of benchmark.items) {
      const attempt = structuredClone(template);
      attempt.handoff.item = item.item;
      attempt.handoff.specHash = item.specHash!;
      attempt.handoff.criteria = [];
      attempt.verification!.itemReport = {
        ...attempt.verification!.itemReport!,
        item: item.item,
      };
      attempt.accepted = false; // Intentionally false derived flags do not override evidence.
      item.state = 'failed';
      item.attempts = [attempt];
    }
    const final = structuredClone(historical.benchmarks[0]!.finalVerification!);
    final.report = {
      ...final.report!,
      status: 'done',
      gates: final.report!.gates.map((g) => ({
        ...g,
        status: 'passed',
        findings: [],
      })),
    };
    final.command.result.transport = 'finished';
    final.command.result.exitCode = 0;
    benchmark.finalVerification = final;
    report.provenance.originAfter = available(
      report.provenance.originBefore,
      'fixture',
    );
  });
  const completed = await aggregateCampaign(f.path);
  expect(completed.configurations[0]).toMatchObject({
    initialItems: 5,
    finalItems: 5,
    certifiedRuns: 1,
  });
  await mutate(f, (report) => {
    const v = report.benchmarks[0]!.items[0]!.attempts[0]!.verification!;
    v.referenceTests = { ...v.referenceTests!, exitCode: 1 };
  });
  expect((await aggregateCampaign(f.path)).configurations[0]).toMatchObject({
    initialItems: 4,
    finalItems: 4,
    certifiedRuns: 0,
  });
  await mutate(f, (report) => {
    const v = report.benchmarks[0]!.items[0]!.attempts[0]!.verification!;
    v.referenceTests = { ...v.referenceTests!, exitCode: 0 };
    report.benchmarks[0]!.finalVerification!.command.result.transport =
      'timeout';
  });
  expect((await aggregateCampaign(f.path)).configurations[0]).toMatchObject({
    finalItems: 5,
    certifiedRuns: 0,
    infrastructureFailures: 1,
  });
  await mutate(f, (r) => {
    const b = r.benchmarks[0]!;
    b.finalVerification!.command.result.transport = 'finished';
    b.items[0]!.attempts[0]!.verification!.commands[0]!.result.transport =
      'infra_error';
  });
  expect((await aggregateCampaign(f.path)).configurations[0]).toMatchObject({
    infrastructureFailures: 1,
    behaviorFailures: 0,
  });
  await mutate(f, (r) => {
    const a = r.benchmarks[0]!.items[0]!.attempts[0]!;
    a.verification!.commands[0]!.result.transport = 'finished';
    a.execution.exitCode = 7;
  });
  expect((await aggregateCampaign(f.path)).configurations[0]).toMatchObject({
    infrastructureFailures: 1,
    behaviorFailures: 0,
  });
});

test('rejects evidence references even when missing files are also removed from hash ledger', async () => {
  const f = await campaign();
  await mutate(f, (r) => {
    r.cases[0]!.execution!.evidence.push('missing-process.json');
  });
  await rejectsIndex(f.path, 'Missing referenced evidence');
  const report = (await Bun.file(
    join(f.root, 'run-1/report.json'),
  ).json()) as EvalReport;
  await rm(join(f.root, 'run-1', report.cases[0]!.execution!.evidence[0]!));
  await mutate(f, (r) => {
    r.cases[0]!.execution!.evidence.pop();
  });
  await rejectsIndex(f.path, 'Missing referenced evidence');
});

test('offline aggregator dependency graph contains no inference adapter or runner import', async () => {
  const visited = new Set<string>();
  async function visit(path: string) {
    if (visited.has(path)) return;
    visited.add(path);
    const source = await readFile(path, 'utf8');
    for (const match of source.matchAll(
      /(?:from\s+|import\s*\()['"]([^'"]+)['"]/g,
    )) {
      const target = match[1]!;
      expect(target).not.toContain('adapters/');
      expect(target).not.toBe('./run');
      if (target.startsWith('.')) {
        const paths = await import('node:path');
        const next = paths.resolve(paths.dirname(path), target) + '.ts';
        if (await Bun.file(next).exists()) await visit(next);
      }
    }
  }
  await visit(join(import.meta.dir, '../scripts/evals/aggregate.ts'));
});

test('accepts a checksummed current-schema report with derived metrics omitted', async () => {
  const f = await campaign();
  const reportPath = join(f.root, 'run-1/report.json');
  const report = await Bun.file(reportPath).json();
  delete report.metrics;
  const text = JSON.stringify(report, null, 2) + '\n';
  await writeFile(reportPath, text);
  const manifestPath = join(f.root, 'run-1/artifact-manifest.json');
  const ledger = await Bun.file(manifestPath).json();
  const artifact = ledger.artifacts.find(
    (a: { path: string }) => a.path === 'report.json',
  );
  artifact.sha256 = sha256(text);
  artifact.bytes = Buffer.byteLength(text);
  await writeFile(manifestPath, JSON.stringify(ledger));
  (f.index.runs[0]!.result as { report: { sha256: string } }).report.sha256 =
    sha256(text);
  await writeFile(f.path, JSON.stringify(f.index));
  expect(
    (await aggregateCampaign(f.path)).configurations[0]!.correctCases,
  ).toBe(15);
});

test('mediana e p90 nearest-rank: posição ⌈p·n⌉ da amostra ordenada, sem média', async () => {
  expect(nearestRank([], 0.5)).toBeNull();
  expect(nearestRank([5], 0.9)).toBe(5);
  expect(nearestRank([4, 1, 3, 2], 0.5)).toBe(2);
  expect(nearestRank([4, 1, 3, 2], 0.9)).toBe(4);
  expect(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
  expect(nearestRank([3, 1, 2], 0.5)).toBe(2);
});

test('índice: repetitionsPerConfiguration (ausente = 3) define a contagem e o teto da repetição', async () => {
  const f = await campaign();
  const write = (index: unknown) => writeFile(f.path, JSON.stringify(index));
  const two = { ...f.index, repetitionsPerConfiguration: 2 };
  await write(two);
  await rejectsIndex(f.path);
  await write({ ...two, runs: f.index.runs.slice(0, 2) });
  const a = await aggregateCampaign(f.path);
  expect(a.configurations[0]).toMatchObject({
    plannedRuns: 2,
    executedRuns: 2,
  });
  await write({
    ...two,
    runs: [f.index.runs[0], { ...f.index.runs[1]!, repetition: 3 }],
  });
  await rejectsIndex(f.path);
  await write({ ...f.index, runs: f.index.runs.slice(0, 2) });
  await rejectsIndex(f.path);
  await write({ ...f.index, repetitionsPerConfiguration: 11 });
  await rejectsIndex(f.path);
});

test('braço roteado: escalação, falso verde, fronteira, turnos e custo derivado com a revisão', async () => {
  const HAIKU = 'claude-haiku-5-5',
    SONNET = 'claude-sonnet-5-5',
    OPUS = 'claude-opus-5-5';
  const f = await campaign();
  const historical = (await Bun.file(
    join(
      import.meta.dir,
      '../docs/superpowers/validation/2026-10-09-plan6/reference/report.json',
    ),
  ).json()) as EvalReport;
  const template = historical.benchmarks[0]!.items[0]!.attempts[0]!;
  // Sonnet: 1 MTok de leitura de cache (US$ 0,10) e 0,1 MTok de saída (US$ 1,00).
  const sonnet = (): Usage => ({
    ...emptyUsage(),
    cacheWriteInputTokens: available(0, 'fixture'),
    byModel: {
      [SONNET]: {
        uncachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        cacheReadInputTokens: 1_000_000,
        outputTokens: 100_000,
      },
    },
    requests: {
      status: 'reconciled',
      items: [
        {
          model: SONNET,
          uncachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          cacheReadInputTokens: 1_000_000,
          cacheWrite1hInputTokens: 0,
        },
      ],
      residual: {},
    },
  });
  const free = (): Usage => ({
    ...emptyUsage(),
    byModel: {
      [SONNET]: {
        uncachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        cacheReadInputTokens: 0,
        outputTokens: 0,
      },
    },
  });
  for (const repetition of [1, 2, 3])
    await mutate(
      f,
      (r) => {
        for (const c of r.cases) c.execution!.usage = free();
      },
      repetition,
    );
  await mutate(f, (report) => {
    const benchmark = report.benchmarks[0]!;
    const attempt = (
      index: number,
      number: number,
      tier: number,
      model: string,
    ) => {
      const item = benchmark.items[index]!;
      const a = structuredClone(template);
      a.number = number;
      a.tier = tier;
      a.model = model;
      a.handoff.item = item.item;
      a.handoff.specHash = item.specHash!;
      a.handoff.criteria = [];
      a.verification!.itemReport = {
        ...a.verification!.itemReport!,
        item: item.item,
      };
      a.execution.usage = sonnet();
      a.execution.numTurns = available(4, 'fixture');
      a.execution.durationMs = 1000;
      return a;
    };
    const greenButWrong = attempt(0, 1, 0, HAIKU);
    greenButWrong.verification!.referenceTests = {
      ...greenButWrong.verification!.referenceTests!,
      exitCode: 1,
    };
    const escalated = attempt(0, 2, 1, SONNET);
    escalated.reasoningEffort = 'medium';
    benchmark.items[0]!.attempts = [greenButWrong, escalated];
    benchmark.items[0]!.state = 'accepted';
    const outside = attempt(1, 1, 0, HAIKU);
    outside.audit = { ...outside.audit!, ok: false };
    benchmark.items[1]!.attempts = [outside];
    benchmark.items[1]!.state = 'failed';
    const execution = structuredClone(template.execution);
    execution.usage = {
      ...emptyUsage(),
      byModel: {
        [OPUS]: {
          uncachedInputTokens: 1_000_000,
          cacheWriteInputTokens: 0,
          cacheReadInputTokens: 0,
          outputTokens: 0,
        },
      },
      // Entrada sem evento assistant: resíduo, na faixa única do Opus.
      requests: {
        status: 'residual',
        items: [],
        residual: {
          [OPUS]: {
            uncachedInputTokens: 1_000_000,
            cacheWriteInputTokens: 0,
            cacheReadInputTokens: 0,
          },
        },
      },
    };
    execution.numTurns = available(1, 'fixture');
    execution.durationMs = 500;
    benchmark.review = {
      outcome: 'approved',
      dispatched: true,
      execution,
      briefTokens: 1000,
      findings: 0,
      reason: null,
    };
  });
  // writeReport valida o relatório com todos os campos novos pelo reportSchema.
  const written = (await Bun.file(
    join(f.root, 'run-1/report.json'),
  ).json()) as EvalReport;
  expect(written.metrics!.benchmarks[0]).toMatchObject({
    escalations: 1,
    turns: { status: 'available', value: 13 },
    review: { outcome: 'approved', dispatched: true, findings: 0 },
  });
  expect(await Bun.file(join(f.root, 'run-1/report.md')).text()).toContain(
    `(${HAIKU} → ${SONNET})`,
  );
  const c = (await aggregateCampaign(f.path)).configurations[0]!;
  expect(c).toMatchObject({
    escalations: 1,
    escalatedItems: 1,
    falseGreen: { attempts: 1, finalItems: 0, unavailableAttempts: 0 },
    boundaryViolations: 1,
    finalItems: 1,
  });
  const run = c.runMetrics[0]!;
  expect(run).toMatchObject({
    repetition: 1,
    status: 'budget_exhausted',
    review: { outcome: 'approved', dispatched: true, transport: 'finished' },
    turns: { status: 'available', value: 13 },
    agentDurationMs: 3500,
  });
  expect(run.items[0]).toMatchObject({
    state: 'accepted',
    attempts: 2,
    models: [HAIKU, SONNET],
  });
  expect(c.cost).toMatchObject({
    label: 'derived',
    available: true,
    reason: null,
    lowerBound: false,
    reportedUSD: null,
  });
  expect(c.cost.total!.expensive).toBeCloseTo(3 * 1.1 + 4, 9);
  expect(c.cost.review!.expensive).toBeCloseTo(4, 9);
  expect(c.cost.perAcceptedItem.withReview!.expensive).toBeCloseTo(7.3, 9);
  expect(c.cost.perAcceptedItem.withoutReview!.cheap).toBeCloseTo(3.3, 9);
  expect(c.cost.perRun.expensive.median).toBe(0);
  expect(c.cost.perRun.expensive.p90).toBeCloseTo(7.3, 9);
  // Turnos indisponíveis nas execuções sem tentativa não entram na distribuição.
  expect(c.distribution.turns).toEqual({ median: 13, p90: 13 });
  // Timeout com requisições e sem `byModel`: custo vira limite inferior.
  await mutate(f, (report) => {
    const usage = report.benchmarks[0]!.items[1]!.attempts[0]!.execution.usage;
    delete usage.byModel;
    usage.requests!.status = 'unreconciled';
  });
  const bounded = (await aggregateCampaign(f.path)).configurations[0]!.cost;
  expect(bounded.lowerBound).toBe(true);
  expect(bounded.total!.expensive).toBeCloseTo(2 * 1.1 + 0.1 + 4, 9);
  // Um uso sem detalhamento torna o custo do braço indisponível, nunca estimado.
  await mutate(f, (report) => {
    report.benchmarks[0]!.items[1]!.attempts[0]!.execution.usage = emptyUsage();
  });
  expect(
    (await aggregateCampaign(f.path)).configurations[0]!.cost,
  ).toMatchObject({
    available: false,
    reason: 'no_usage_breakdown',
    total: null,
  });
});

// Compatibilidade com o cycle-20 (evidência imutável): o agregador só acrescenta
// chaves. Os hashes vêm da saída do agregador da main em dd58fb3, gerada com
// `bun run evals:aggregate --campaign evals/campaigns/cycle-20/index.json --out <novo>`
// (sha256 de aggregate.json e de aggregate.md).
const CYCLE_20_JSON_SHA256 =
  '3de8157d74607266819d5b4059e26628d9552ec086ee3a0219374c5bf74f2a42';
const CYCLE_20_MD_SHA256 =
  'bbae2385df51432de55bc446059a4b0f2c9ca425ab654af17ffb3422f1722b4e';
const NEW_AGGREGATE_KEYS = [
  'boundaryViolations',
  'cost',
  'distribution',
  'escalatedItems',
  'escalations',
  'falseGreen',
  'runMetrics',
];
test('cycle-20: o agregado só ganha chaves novas e o markdown não muda', async () => {
  const report = await aggregateCampaign(
    join(import.meta.dir, '../evals/campaigns/cycle-20/index.json'),
  );
  expect(sha256(renderAggregate(report))).toBe(CYCLE_20_MD_SHA256);
  const legacy = structuredClone(report) as unknown as {
    configurations: Record<string, unknown>[];
    groups: Record<string, unknown>[];
  };
  for (const entry of [...legacy.configurations, ...legacy.groups])
    for (const key of NEW_AGGREGATE_KEYS) delete entry[key];
  expect(sha256(JSON.stringify(legacy, null, 2) + '\n')).toBe(
    CYCLE_20_JSON_SHA256,
  );
});
