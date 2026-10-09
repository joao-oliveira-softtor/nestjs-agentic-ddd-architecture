import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { stableStringify, type ProjectStatus } from '@agentic-ddd/compiler';
import type {
  EvalAdapter,
  EvalReport,
  PreparedSource,
  RunControl,
  RunManifest,
  RunOptions,
} from './contracts';
import { available, manifestSchema, unavailable } from './contracts';
import { buildSkillContext, evaluateSkills } from './skills';
import { evaluateImplementation, prepareTasksBaseline } from './implementation';
import {
  disposeSource,
  fingerprintOrigin,
  prepareSource,
  reserveOutput,
  sha256,
} from './isolation';
import { TASK_ITEMS } from './audit';
import { loadDataset } from './dataset';
import { createScriptedAdapter } from './adapters/scripted';
import { createCodexAdapter } from './adapters/codex';
import { createCursorAdapter } from './adapters/cursor';
import { writeReport } from './report';
import { finalVerificationState } from './final-verification';

export function classifyRunStatus(
  report: EvalReport,
  stop: ReturnType<RunControl['stopReason']>,
): EvalReport['status'] {
  if (stop) return stop;
  if (report.status !== 'completed') return report.status;
  return report.cases.some((c) => c.verdict === 'infra_error') ||
    report.benchmarks.some(
      (b) =>
        b.items.some((i) => i.state === 'infra_error') ||
        finalVerificationState(b.finalVerification) === 'infra_error',
    )
    ? 'infra_error'
    : 'completed';
}

export function createRunControl(
  budget: RunManifest['budget'],
  external: AbortSignal,
): RunControl & { dispose(): void } {
  const controller = new AbortController();
  const deadline = performance.now() + budget.totalTimeoutMs;
  let invocations = 0;
  let reason: ReturnType<RunControl['stopReason']> = null;
  const stop = (next: NonNullable<typeof reason>) => {
    if (!reason) {
      reason = next;
      controller.abort(next);
    }
  };
  const abort = () => stop('cancelled');
  external.addEventListener('abort', abort, { once: true });
  if (external.aborted) abort();
  const timer = setTimeout(
    () => stop('budget_exhausted'),
    budget.totalTimeoutMs,
  );
  return {
    signal: controller.signal,
    get invocations() {
      return invocations;
    },
    remainingMs: () => Math.max(0, deadline - performance.now()),
    stopReason: () => {
      if (performance.now() >= deadline) stop('budget_exhausted');
      return reason;
    },
    reserveInvocation: () => {
      if (reason) return false;
      if (
        performance.now() >= deadline ||
        invocations >= budget.maxInvocations
      ) {
        stop('budget_exhausted');
        return false;
      }
      invocations++;
      return true;
    },
    dispose() {
      clearTimeout(timer);
      external.removeEventListener('abort', abort);
    },
  };
}
export interface EvaluationOptions extends RunOptions {
  sourceRoot?: string;
  adapters?: ReadonlyMap<string, EvalAdapter>;
}
export async function runEvaluation(
  input: RunManifest,
  options: EvaluationOptions,
): Promise<EvalReport> {
  const manifest = manifestSchema.parse(input);
  const native = manifest.configurations.some((c) => c.adapter !== 'scripted');
  if (
    !options.real &&
    manifest.configurations.some((c) => c.adapter !== 'scripted')
  )
    throw Error('Real adapters require --real');
  if (native && !options.trustedSource)
    throw Error(
      'Real adapters require explicit trusted source acknowledgement; native tools can access credentials and host network',
    );
  const startedAt = new Date().toISOString(),
    started = performance.now();
  const sourceRoot = resolve(options.sourceRoot ?? process.cwd());
  const control =
    options.control ?? createRunControl(manifest.budget, options.signal);
  let source: PreparedSource | undefined;
  let report: EvalReport | undefined;
  let outDir: string | undefined;
  const secrets = new Set(
    [process.env.CODEX_API_KEY, process.env.CURSOR_API_KEY].filter(
      (s): s is string => Boolean(s),
    ),
  );
  try {
    outDir = await reserveOutput(options.outDir, sourceRoot);
    source = await prepareSource(sourceRoot, manifest.sourceRef);
    report = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      mode: manifest.configurations.some((c) => c.adapter !== 'scripted')
        ? 'real'
        : 'scripted',
      startedAt,
      finishedAt: startedAt,
      durationMs: 0,
      status: 'completed',
      diagnostics: [],
      manifest,
      manifestSha256: sha256(stableStringify(manifest)),
      invocations: 0,
      provenance: {
        sourceCommit: source.commit,
        runnerCommit: source.runnerCommit,
        platform: `${process.platform}/${process.arch}`,
        bun: Bun.version,
        originBefore: source.fingerprint,
        originAfter: unavailable('not_checked'),
        adapters: {},
        ...(native
          ? {
              nativeToolAccess: {
                sourceTrustAcknowledged: true as const,
                credentials: 'accessible' as const,
                network: 'host' as const,
              },
            }
          : {}),
      },
      cases: [],
      benchmarks: manifest.configurations.map((c) => ({
        configuration: c.id,
        baselineHash: null,
        items: TASK_ITEMS.map((item) => ({
          item: item.id,
          specHash: null,
          state: 'not_run',
          reason: 'not_prepared',
          attempts: [],
        })),
        finalVerification: null,
      })),
      artifacts: [],
    };
    // Materialize the complete planned ledger before dispatch, retaining not_run
    // rows even if later infrastructure fails or the budget stops execution.
    for (const datasetEntry of manifest.skillDatasets) {
      const path = join(source.snapshotRoot, datasetEntry.path);
      const cases = await loadDataset(path);
      const hash = sha256(await readFile(path));
      const contexts = {
        dev: await buildSkillContext(source, datasetEntry.contextRoots.dev),
        runtime: await buildSkillContext(
          source,
          datasetEntry.contextRoots.runtime,
        ),
      };
      for (const config of manifest.configurations)
        for (const c of cases)
          report.cases.push({
            configuration: config.id,
            dataset: datasetEntry.path,
            datasetSha256: hash,
            id: c.id,
            audience: c.audience,
            question: c.question,
            expect: c.expect,
            answer: null,
            verdict: 'not_run',
            reason: 'not_dispatched',
            contextHash: contexts[c.audience].bundleSha256,
            execution: null,
          });
    }
    const runOptions: RunOptions = {
      ...options,
      outDir,
      control,
      onCase: (result) => {
        const index = report!.cases.findIndex(
          (c) =>
            c.configuration === result.configuration &&
            c.dataset === result.dataset &&
            c.id === result.id,
        );
        if (index < 0) throw Error('Unexpected case');
        report!.cases[index] = result;
      },
      onBenchmark: (result) => {
        const index = report!.benchmarks.findIndex(
          (b) => b.configuration === result.configuration,
        );
        if (index < 0) throw Error('Unexpected configuration');
        report!.benchmarks[index] = result;
      },
    };
    if (!control.stopReason()) {
      await prepareTasksBaseline(source, {
        ...runOptions,
        outDir: join(outDir, 'startup'),
      });
      const status = JSON.parse(
        await readFile(
          join(outDir, 'startup/preparation/status/stdout.log'),
          'utf8',
        ),
      ) as ProjectStatus;
      const baselineManifest = JSON.parse(
        await readFile(
          join(outDir, 'startup/preparation/baseline-tree.json'),
          'utf8',
        ),
      ) as { hash: string };
      for (const benchmark of report.benchmarks) {
        benchmark.baselineHash = baselineManifest.hash;
        for (const item of benchmark.items)
          item.specHash = status.items.find(
            (i) => i.id === item.item,
          )!.specHash;
      }
    }
    const adapters = new Map<string, EvalAdapter>();
    for (const config of manifest.configurations) {
      if (control.stopReason()) break;
      const supplied = options.adapters?.get(config.id);
      const count = report.cases.filter(
        (c) => c.configuration === config.id,
      ).length;
      const nativeOptions = {
        onSecrets: (values: readonly string[]) =>
          values.forEach((value) => secrets.add(value)),
        probeSignal: control.signal,
        probeEvidenceDir: join(outDir, 'adapters', config.id, 'probe'),
      };
      const adapter =
        supplied ??
        (config.adapter === 'codex-cli'
          ? createCodexAdapter(config, nativeOptions)
          : config.adapter === 'cursor-cli'
            ? createCursorAdapter(config, nativeOptions)
            : createScriptedAdapter([
                ...Array.from({ length: count }, () => ({
                  finalText:
                    '{"type":"exact","value":"scripted offline response"}',
                })),
                ...Array.from({ length: 10 }, () => ({
                  finalText:
                    '{"status":"blocked","summary":"scripted fixture does not implement code"}',
                })),
              ]));
      adapters.set(config.id, adapter);
      report.provenance.adapters[config.id] = await adapter.probe();
    }
    if (!control.stopReason())
      await evaluateSkills(manifest, source, adapters, runOptions);
    if (!control.stopReason())
      await evaluateImplementation(manifest, source, adapters, runOptions);
  } catch (error) {
    if (!report) {
      if (outDir)
        await writeFile(
          join(outDir, 'run-failure.json'),
          JSON.stringify(
            {
              schemaVersion: 1,
              status: control.stopReason() ?? 'infra_error',
              diagnostic: String(error),
              metrics: { status: 'unavailable', reason: 'preflight_failed' },
            },
            null,
            2,
          ) + '\n',
        );
      throw error;
    }
    report.status = 'infra_error';
    report.diagnostics.push(String(error));
  } finally {
    try {
      if (report && source && outDir) {
        const stop = control.stopReason();
        if (stop) report.status = stop;
        for (const c of report.cases)
          if (c.verdict === 'not_run')
            c.reason =
              stop ??
              (report.status === 'infra_error'
                ? 'run_infrastructure_failed'
                : c.reason);
        for (const b of report.benchmarks)
          for (const i of b.items)
            if (i.state === 'not_run')
              i.reason =
                stop ??
                (report.status === 'infra_error'
                  ? 'run_infrastructure_failed'
                  : i.reason);
        report.status = classifyRunStatus(report, stop);
        try {
          const after = await fingerprintOrigin(source.originRoot);
          report.provenance.originAfter = available(
            after,
            'filesystem_and_git_fingerprint',
          );
          if (after !== source.fingerprint) {
            report.diagnostics.push(
              'Origin changed during evaluation; no changes restored',
            );
            if (report.status === 'completed') report.status = 'infra_error';
          }
        } catch (error) {
          report.provenance.originAfter = unavailable(String(error));
          if (report.status === 'completed') report.status = 'infra_error';
        }
        report.invocations = control.invocations;
        await disposeSource(source);
        source = undefined;
        report.finishedAt = new Date().toISOString();
        report.durationMs = performance.now() - started;
        await writeReport(report, outDir, { secrets: [...secrets] });
      }
    } finally {
      try {
        if (source) await disposeSource(source);
      } finally {
        if ('dispose' in control && typeof control.dispose === 'function')
          control.dispose();
      }
    }
  }
  if (!report) throw Error('Evaluation report unavailable');
  return report;
}
