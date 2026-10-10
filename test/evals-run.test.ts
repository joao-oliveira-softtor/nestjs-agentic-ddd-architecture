import { afterAll, beforeAll, expect, test as bunTest } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRunControl, runEvaluation } from '../scripts/evals/run';
import {
  createScriptedAdapter,
  type ScriptedAction,
} from '../scripts/evals/adapters/scripted';
import { loadDataset } from '../scripts/evals/dataset';
import { reportSchema } from '../scripts/evals/report-schema';
import { finalVerificationState } from '../scripts/evals/final-verification';
import type {
  AdapterRequest,
  BenchmarkResult,
  EvalReport,
} from '../scripts/evals/contracts';
import { completeItem } from './helpers/tasks-solution';
import { evalManifest, frozenSource } from './helpers/evals';
let fixture: Awaited<ReturnType<typeof frozenSource>>;
let out: string;
let answers: ScriptedAction[];
// The examples' CLI verify already launches bun test. This runner suite has
// no orders coverage and must not recursively launch complete evaluation runs.
const insideVerify = process.env.AGENTIC_DDD_VERIFY === '1';
const test = bunTest.skipIf(insideVerify);
beforeAll(async () => {
  if (insideVerify) return;
  fixture = await frozenSource();
  out = await mkdtemp(join(tmpdir(), 'eval-run-regression-'));
  answers = (
    await loadDataset(
      join(fixture.source.snapshotRoot, 'evals/skills/orders.yaml'),
    )
  ).map((c) => ({ finalText: JSON.stringify(c.expect) }));
}, 60000);
afterAll(async () => {
  await fixture?.cleanup();
  if (out) await rm(out, { recursive: true, force: true });
}, 60000);
const done = (before?: ScriptedAction['before']): ScriptedAction => ({
  finalText: '{"status":"done","summary":"offline fixture"}',
  before:
    before ??
    (async (req) => {
      await completeItem(req.cwd, req.id);
    }),
});
async function run(
  name: string,
  actions: ScriptedAction[],
  options: {
    corrections?: 0 | 1;
    invocations?: number;
    onBenchmark?: (result: BenchmarkResult) => void;
    finalTimeout?: boolean;
  } = {},
): Promise<EvalReport> {
  const manifest = {
    ...evalManifest,
    budget: {
      ...evalManifest.budget,
      totalTimeoutMs: 180000,
      maxCorrectionsPerItem: options.corrections ?? 0,
      maxInvocations: options.invocations ?? 30,
    },
  };
  let benchmark: BenchmarkResult | undefined;
  let finalSchedulingReads = 0;
  const control = createRunControl(
    manifest.budget,
    new AbortController().signal,
  );
  const report = await runEvaluation(manifest, {
    sourceRoot: fixture.source.originRoot,
    outDir: join(out, name),
    real: false,
    signal: new AbortController().signal,
    adapters: new Map([
      ['scripted', createScriptedAdapter([...answers, ...actions])],
    ]),
    control: options.finalTimeout
      ? {
          ...control,
          remainingMs: () =>
            // After acceptance the runner reads status and next before verify.
            // Permit those reads, then time out the real verify-change process.
            benchmark?.items.every((i) => i.state === 'accepted') &&
            finalSchedulingReads++ >= 2
              ? 1
              : control.remainingMs(),
          get invocations() {
            return control.invocations;
          },
        }
      : control,
    onBenchmark: (result) => {
      benchmark = result;
      options.onBenchmark?.(result);
    },
  });
  control.dispose();
  const persisted = reportSchema.parse(
    JSON.parse(await readFile(join(out, name, 'report.json'), 'utf8')),
  );
  expect(persisted.id).toBe(report.id);
  expect(persisted.provenance.originAfter).toMatchObject({
    status: 'available',
    value: persisted.provenance.originBefore,
  });
  return persisted;
}
test('full run answers five questions, accepts five packets and independently certifies change', async () => {
  const report = await run(
    'positive',
    Array.from({ length: 5 }, () => done()),
  );
  expect(report.cases.map((c) => c.verdict)).toEqual(Array(5).fill('correct'));
  expect(report.benchmarks[0]!.items.map((i) => i.state)).toEqual(
    Array(5).fill('accepted'),
  );
  expect(report.benchmarks[0]!.finalVerification?.report?.status).toBe('done');
  expect(report.invocations).toBe(10);
}, 180000);

// Every mutation edits only the assigned body and replaces its allowed test with
// intentionally superficial, executed coverage. These are behavioral regressions.
const defects: {
  name: string;
  item: string;
  file: string;
  from: string;
  to: string;
}[] = [
  {
    name: 'normalization',
    item: 'entity:Task',
    file: 'domain/task.ts',
    from: 'title.trim()',
    to: 'title',
  },
  {
    name: 'empty-title',
    item: 'entity:Task',
    file: 'domain/task.ts',
    from: 'if (!normalized)',
    to: 'if (false)',
  },
  {
    name: 'wrong-id',
    item: 'entity:Task',
    file: 'domain/task.ts',
    from: 'new Task(id, normalized)',
    to: "new Task('wrong', normalized)",
  },
  {
    name: 'hardcoded-oracle-id',
    item: 'entity:Task',
    file: 'domain/task.ts',
    from: 'new Task(id, normalized)',
    to: "new Task('oracle-17', normalized)",
  },
  {
    name: 'created-event-missing',
    item: 'entity:Task',
    file: 'domain/task.ts',
    from: 'task.record(new TaskCreated({ taskId: id, title: normalized }));',
    to: ';',
  },
  {
    name: 'created-payload',
    item: 'entity:Task',
    file: 'domain/task.ts',
    from: 'taskId: id, title: normalized',
    to: "taskId: 'wrong', title: normalized",
  },
  {
    name: 'title-error-code',
    item: 'entity:Task',
    file: 'domain/task.ts',
    from: "'TASK_TITLE_REQUIRED'",
    to: "'WRONG_CODE'",
  },
  {
    name: 'wrong-state',
    item: 'method:Task.complete',
    file: 'domain/task.ts',
    from: "this.#status = 'completed'",
    to: "this.#status = 'pending'",
  },
  {
    name: 'completed-event-missing',
    item: 'method:Task.complete',
    file: 'domain/task.ts',
    from: 'this.record(new TaskCompleted({ taskId: this.id }));',
    to: ';',
  },
  {
    name: 'completed-payload',
    item: 'method:Task.complete',
    file: 'domain/task.ts',
    from: 'taskId: this.id',
    to: "taskId: 'wrong'",
  },
  {
    name: 'repetition-accepted',
    item: 'method:Task.complete',
    file: 'domain/task.ts',
    from: "if (this.#status !== 'pending')",
    to: 'if (false)',
  },
  {
    name: 'repeat-error-code',
    item: 'method:Task.complete',
    file: 'domain/task.ts',
    from: "'TASK_ALREADY_COMPLETED'",
    to: "'WRONG_CODE'",
  },
  {
    name: 'duplicate-accepted',
    item: 'usecase:create_task',
    file: 'application/create-task.ts',
    from: 'if (await this.tasks.findById(input.task_id))',
    to: 'if (false)',
  },
  {
    name: 'duplicate-error-code',
    item: 'usecase:create_task',
    file: 'application/create-task.ts',
    from: "'TASK_ALREADY_EXISTS'",
    to: "'WRONG_CODE'",
  },
  {
    name: 'create-save-omitted',
    item: 'usecase:create_task',
    file: 'application/create-task.ts',
    from: 'await this.tasks.save(task);',
    to: ';',
  },
  {
    name: 'create-publish-omitted',
    item: 'usecase:create_task',
    file: 'application/create-task.ts',
    from: 'await ctx.publish(task.pullEvents());',
    to: ';',
  },
  {
    name: 'complete-save-omitted',
    item: 'usecase:complete_task',
    file: 'application/complete-task.ts',
    from: 'await this.tasks.save(task);',
    to: ';',
  },
  {
    name: 'complete-publish-omitted',
    item: 'usecase:complete_task',
    file: 'application/complete-task.ts',
    from: 'await ctx.publish(task.pullEvents());',
    to: ';',
  },
  {
    name: 'missing-error-code',
    item: 'usecase:complete_task',
    file: 'application/complete-task.ts',
    from: "'TASK_NOT_FOUND'",
    to: "'WRONG_CODE'",
  },
];
async function defective(
  req: AdapterRequest,
  defect: (typeof defects)[number],
) {
  await completeItem(req.cwd, req.id);
  const path = join(req.cwd, 'app', defect.file),
    source = await readFile(path, 'utf8');
  expect(source).toContain(defect.from);
  await writeFile(path, source.replace(defect.from, defect.to));
  const testPath = join(
    req.cwd,
    'app/test',
    req.id.replaceAll(/[:.]/g, '-') + '.test.ts',
  );
  const original = await readFile(testPath, 'utf8');
  const ids = [
    ...new Set(
      [
        ...original.matchAll(
          /'((?:method|invariant|criterion|usecase|operator):[^']+)'/g,
        ),
      ].map((m) => m[1]),
    ),
  ];
  await writeFile(
    testPath,
    `import {test,expect} from 'bun:test'; import {covers} from '@agentic-ddd/testing'; test(covers(${JSON.stringify(ids)},'superficial green coverage'),()=>expect(true).toBe(true));\n`,
  );
}
for (const defect of defects)
  test(`full run rejects ${defect.name} after audit and green executor suite`, async () => {
    const report = await run(
      defect.name,
      Array.from({ length: 5 }, () =>
        done(async (req) => {
          if (req.id === defect.item) await defective(req, defect);
          else await completeItem(req.cwd, req.id);
        }),
      ),
    );
    const benchmark = report.benchmarks[0]!,
      item = benchmark.items.find((i) => i.item === defect.item)!,
      attempt = item.attempts[0]!;
    expect(attempt.audit?.ok).toBe(true);
    expect(attempt.verification?.itemReport?.status).toBe('done');
    expect(attempt.verification?.executorTests?.exitCode).toBe(0);
    expect(
      attempt.verification?.referenceTests?.cases.some(
        (c) => c.status === 'failed',
      ),
    ).toBe(true);
    expect(attempt.verification?.findings.join()).toContain(
      'Private behavior oracle failed',
    );
    expect(attempt.accepted).toBe(false);
    expect(item.state).toBe('failed');
    expect(benchmark.finalVerification?.report?.status).not.toBe('done');
    if (defect.item === 'method:Task.complete') {
      expect(
        benchmark.items.find((i) => i.item === 'usecase:create_task')!.state,
      ).toBe('accepted');
      expect(
        benchmark.items.find((i) => i.item === 'usecase:complete_task')!.state,
      ).toBe('blocked');
      expect(
        benchmark.items.find((i) => i.item === 'operator:task-operator')!.state,
      ).toBe('blocked');
    }
  }, 180000);
test('fresh correction preserves original packet and hash while rejecting first behavior', async () => {
  const workspaces: string[] = [];
  const report = await run(
    'correction',
    [
      done(async (req) => {
        workspaces.push(req.cwd);
        await defective(req, defects[0]!);
      }),
      done(async (req) => {
        workspaces.push(req.cwd);
        await completeItem(req.cwd, req.id);
      }),
      ...Array.from({ length: 4 }, () => done()),
    ],
    { corrections: 1 },
  );
  const item = report.benchmarks[0]!.items[0]!;
  expect(item.attempts.map((a) => a.accepted)).toEqual([false, true]);
  expect(new Set(workspaces).size).toBe(2);
  expect(item.attempts[0]!.handoff.packet).toBe(
    item.attempts[1]!.handoff.packet,
  );
  expect(item.attempts.map((a) => a.handoff.specHash)).toEqual([
    item.specHash!,
    item.specHash!,
  ]);
  expect(report.benchmarks[0]!.finalVerification?.report?.status).toBe('done');
}, 180000);
for (const [name, action, reason] of [
  [
    'protocol',
    { finalText: '{"status":"done","unexpected":true}' },
    'invalid_implementation_reply',
  ],
  ['infrastructure', { argv: ['/missing-agent'] }, 'process_nonzero'],
] as const)
  test(`full run cannot certify ${name}`, async () => {
    const report = await run(name, [action]);
    const item = report.benchmarks[0]!.items[0]!;
    expect(item.attempts[0]!.accepted).toBe(false);
    expect(item.attempts[0]!.reason).toContain(reason);
    expect(report.benchmarks[0]!.finalVerification?.report?.status).not.toBe(
      'done',
    );
    if (name === 'infrastructure') {
      expect(report.status).toBe('infra_error');
      expect(item.state).toBe('infra_error');
      expect(item.attempts).toHaveLength(1);
      const stderr = item.attempts[0]!.execution.evidence.find((path) =>
        path.endsWith('stderr.log'),
      )!;
      expect(await readFile(join(out, name, stderr), 'utf8')).toContain(
        '/missing-agent',
      );
    }
  }, 180000);
test('invocation budget stops before implementation and persists all planned items', async () => {
  const report = await run('budget', [], { invocations: 5 });
  expect(report.status).toBe('budget_exhausted');
  expect(report.invocations).toBe(5);
  expect(report.benchmarks[0]!.items.map((i) => i.state)).toEqual(
    Array(5).fill('not_run'),
  );
  expect(report.benchmarks[0]!.finalVerification).toBeNull();
}, 180000);
test('final verification timeout after five acceptances cannot certify change', async () => {
  const report = await run(
    'final-unavailable',
    Array.from({ length: 5 }, () => done()),
    { finalTimeout: true },
  );
  expect(report.benchmarks[0]!.items.map((i) => i.state)).toEqual(
    Array(5).fill('accepted'),
  );
  expect(finalVerificationState(report.benchmarks[0]!.finalVerification)).toBe(
    'infra_error',
  );
  expect(report.status).toBe('infra_error');
  expect(report.metrics!.benchmarks[0]!.completion.status).toBe('unavailable');
}, 180000);
