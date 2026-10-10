import { afterEach, expect, test as bunTest } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stableStringify } from '@agentic-ddd/compiler';
import { aggregateCampaign, main } from '../scripts/evals/aggregate';
import { sha256 } from '../scripts/evals/isolation';
import { writeReport } from '../scripts/evals/report';
import {
  available,
  emptyUsage,
  type EvalReport,
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
