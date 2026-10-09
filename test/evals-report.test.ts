import { expect, test } from 'bun:test';
import { join } from 'node:path';
import type { CaseResult, EvalReport } from '../scripts/evals/contracts';
import { emptyUsage, unavailable } from '../scripts/evals/contracts';
import {
  computeMetrics,
  renderMarkdown,
  writeReport,
} from '../scripts/evals/report';
import { evalManifest } from './helpers/evals';
export function reportFixture(cases: CaseResult[]): EvalReport {
  return {
    schemaVersion: 1,
    id: 'offline',
    mode: 'scripted',
    startedAt: '2026-10-09T00:00:00.000Z',
    finishedAt: '2026-10-09T00:00:01.000Z',
    durationMs: 1000,
    status: 'completed',
    diagnostics: [],
    manifest: evalManifest,
    manifestSha256: 'a'.repeat(64),
    invocations: cases.length,
    provenance: {
      sourceCommit: 'a'.repeat(40),
      runnerCommit: 'b'.repeat(40),
      platform: 'linux',
      bun: Bun.version,
      originBefore: 'c'.repeat(64),
      originAfter: unavailable('fixture'),
      adapters: {},
    },
    cases,
    benchmarks: [],
    artifacts: [],
  };
}
function row(
  configuration: string,
  id: string,
  verdict: CaseResult['verdict'],
  value = verdict === 'correct' ? 'correct' : 'same',
): CaseResult {
  return {
    configuration,
    dataset: 'evals/skills/orders.yaml',
    datasetSha256: 'd'.repeat(64),
    id,
    audience: 'dev',
    question: 'offline question',
    expect: { type: 'exact', value: 'correct' },
    answer:
      verdict === 'correct' || verdict === 'incorrect'
        ? { type: 'exact', value }
        : null,
    verdict,
    reason: null,
    contextHash: 'e'.repeat(64),
    execution: {
      transport: verdict === 'infra_error' ? 'infra_error' : 'finished',
      finalText: null,
      exitCode: 0,
      signal: null,
      sessionId: unavailable(),
      observedModel: unavailable(),
      modelRevision: unavailable(),
      usage: emptyUsage(),
      durationMs: 2,
      evidence: [],
      diagnostic: null,
    },
  };
}
test('accuracy denominators include malformed/timeout but exclude infrastructure; coverage remains explicit', () => {
  const report = reportFixture(
    ['correct', 'correct', 'correct', 'correct', 'incorrect'].map((v, i) =>
      row('scripted', String(i), v as CaseResult['verdict']),
    ),
  );
  const metric = computeMetrics(report).skills[0]!;
  expect(metric.accuracy).toEqual({
    numerator: 4,
    denominator: 5,
    value: { status: 'available', value: 0.8, source: 'deterministic_counts' },
  });
  expect(metric.coverage.numerator).toBe(5);
  const partial = computeMetrics(
    reportFixture([
      row('scripted', 'a', 'correct'),
      row('scripted', 'b', 'infra_error'),
    ]),
  ).skills[0]!;
  expect(partial.accuracy.denominator).toBe(1);
  expect(partial.coverage.denominator).toBe(2);
  expect(partial.infrastructure).toBe(1);
  expect(
    computeMetrics(reportFixture([row('scripted', 'a', 'not_run')])).skills[0]!
      .accuracy.value.status,
  ).toBe('unavailable');
});
test('agreement counts identical wrong answers separately from correctness; Fleiss kappa uses binary complete rows', () => {
  const ratings = [
    ['correct', 'correct'],
    ['incorrect', 'incorrect'],
    ['correct', 'incorrect'],
    ['incorrect', 'correct'],
  ] as const;
  const report = reportFixture(
    ratings.flatMap((r, i) =>
      r.map((verdict, j) =>
        row(j === 0 ? 'first' : 'second', String(i), verdict),
      ),
    ),
  );
  report.manifest = {
    ...evalManifest,
    configurations: [
      { ...evalManifest.configurations[0]!, id: 'first' },
      { ...evalManifest.configurations[0]!, id: 'second' },
    ],
  };
  const metrics = computeMetrics(report);
  expect(metrics.agreements[0]!.agreement.numerator).toBe(2);
  expect(metrics.kappa.value).toEqual({
    status: 'available',
    value: 0,
    source: 'fleiss_binary_correctness',
  });
  report.cases = report.cases.filter((c) => c.id === '0');
  expect(computeMetrics(report).kappa.value.status).toBe('unavailable');
  report.cases.push(
    row('first', 'infra', 'infra_error'),
    row('second', 'infra', 'correct'),
  );
  expect(computeMetrics(report).kappa.completeRows).toBe(1);
  expect(computeMetrics(report).kappa.plannedRows).toBe(2);
});
test('tokens and costs remain explicitly unavailable; Markdown derives from the report and artifact hashes include preserved bytes', async () => {
  const { mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const report = reportFixture([row('scripted', 'a', 'incorrect')]);
  expect(computeMetrics(report).usage.scripted?.cost.status).toBe(
    'unavailable',
  );
  expect(renderMarkdown(report)).toContain('indisponível');
  const root = await mkdtemp(join(tmpdir(), 'eval-report-'));
  try {
    await writeFile(join(root, 'evidence.log'), 'preserved\n');
    await writeReport(report, root);
    const json = JSON.parse(
      await readFile(join(root, 'report.json'), 'utf8'),
    ) as EvalReport;
    expect(await readFile(join(root, 'report.md'), 'utf8')).toBe(
      renderMarkdown(json),
    );
    expect(json.artifacts.find((a) => a.path === 'evidence.log')?.bytes).toBe(
      10,
    );
    const manifest = JSON.parse(
      await readFile(join(root, 'artifact-manifest.json'), 'utf8'),
    ) as { artifacts: { path: string; sha256: string }[] };
    for (const artifact of manifest.artifacts) {
      const hash = new Bun.CryptoHasher('sha256')
        .update(await readFile(join(root, artifact.path)))
        .digest('hex');
      expect(hash).toBe(artifact.sha256);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('publication redacts secrets in agent patches and report strings before computing hashes', async () => {
  const { mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const root = await mkdtemp(join(tmpdir(), 'eval-redaction-'));
  const secret = 'offline-planted-secret-123456';
  const report = reportFixture([row('scripted', 'a', 'incorrect')]);
  report.diagnostics.push(secret);
  try {
    await writeFile(join(root, 'patch.json'), JSON.stringify({ body: secret }));
    await writeReport(report, root, { secrets: [secret] });
    expect(await readFile(join(root, 'patch.json'), 'utf8')).not.toContain(
      secret,
    );
    expect(await readFile(join(root, 'report.json'), 'utf8')).not.toContain(
      secret,
    );
    expect(report.redaction?.applied).toBe(true);
    expect(report.redaction?.artifacts).toEqual(['patch.json']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
