import { afterAll, beforeAll, expect, test as bunTest } from 'bun:test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditSubmission } from '../scripts/evals/audit';
import {
  evaluateImplementation,
  prepareTasksBaseline,
} from '../scripts/evals/implementation';
import { createScriptedAdapter } from '../scripts/evals/adapters/scripted';
import { completeItem } from './helpers/tasks-solution';
import { evalManifest, frozenSource } from './helpers/evals';
// Domain verify collects business coverage; benchmark campaigns run in the
// outer framework suite instead of being repeated inside that collection.
const insideVerify = process.env.AGENTIC_DDD_VERIFY === '1';
const test = bunTest.skipIf(insideVerify);
const IDS = [
  'entity:Task',
  'method:Task.complete',
  'usecase:create_task',
  'usecase:complete_task',
  'operator:task-operator',
];
let fixture: Awaited<ReturnType<typeof frozenSource>>;
let out: string;
let baseline: string;
beforeAll(async () => {
  if (insideVerify) return;
  fixture = await frozenSource();
  out = await mkdtemp(join(tmpdir(), 'eval-implementation-out-'));
  baseline = await prepareTasksBaseline(fixture.source, {
    outDir: out,
    real: false,
    signal: new AbortController().signal,
  });
}, 60000);
afterAll(async () => {
  await fixture?.cleanup();
  if (out) await rm(out, { recursive: true, force: true });
}, 60000);
test('audit permits selected body and test while preserving source coordinates and all other bytes', async () => {
  const root = join(fixture.source.root, 'audit-valid');
  await cp(baseline, root, { recursive: true, verbatimSymlinks: true });
  await completeItem(root, IDS[0]!);
  expect((await auditSubmission(baseline, root, IDS[0]!)).ok).toBe(true);
  const source = join(root, 'app/domain/task.ts');
  let text = await readFile(source, 'utf8');
  await writeFile(
    source,
    text.replace('Tarefa com título', 'Alterada com título'),
  );
  expect((await auditSubmission(baseline, root, IDS[0]!)).ok).toBe(false);
  await writeFile(
    source,
    text.replace('const normalized', '\nconst normalized'),
  );
  expect(
    (await auditSubmission(baseline, root, IDS[0]!)).findings.join(),
  ).toContain('line');
  await writeFile(source, text);
  await completeItem(root, IDS[1]!);
  expect((await auditSubmission(baseline, root, IDS[0]!)).ok).toBe(false);
});

test('audit rejects oversized sparse files, excessive entries and aggregate content before retaining a patch', async () => {
  const { mkdir, open } = await import('node:fs/promises');
  const root = join(fixture.source.root, 'audit-resource-limits');
  await cp(baseline, root, { recursive: true, verbatimSymlinks: true });
  await mkdir(join(root, 'app/test'), { recursive: true });
  const large = join(root, 'app/test/entity-Task.test.ts');
  const file = await open(large, 'w');
  await file.truncate(512 * 1024);
  await file.close();
  let audited = await auditSubmission(baseline, root, IDS[0]!);
  expect(audited.ok).toBe(false);
  expect(audited.findings.join()).toContain('limit');
  expect(audited.patch).toBe('[]');
  await rm(large);
  for (let i = 0; i < 1025; i++)
    await writeFile(join(root, 'app/test', `entry-${i}`), '');
  audited = await auditSubmission(baseline, root, IDS[0]!);
  expect(audited.findings.join()).toContain('entry limit');
  expect(audited.patch).toBe('[]');
  await rm(join(root, 'app/test'), { recursive: true });
  await mkdir(join(root, 'app/test'));
  for (let i = 0; i < 17; i++)
    await writeFile(
      join(root, 'app/test', `file-${i}`),
      Buffer.alloc(256 * 1024),
    );
  audited = await auditSubmission(baseline, root, IDS[0]!);
  expect(audited.findings.join()).toContain('aggregate limit');
  expect(audited.patch).toBe('[]');
  await rm(join(root, 'app/test'), { recursive: true });
  await mkdir(join(root, 'app/test'));
  for (let i = 0; i < 6; i++)
    await writeFile(
      join(root, 'app/test', `escaped-${i}`),
      Buffer.alloc(256 * 1024),
    );
  audited = await auditSubmission(baseline, root, IDS[0]!);
  expect(audited.findings.join()).toContain('patch limit');
  expect(audited.patch).toBe('[]');
});
test('complete scripted benchmark independently accepts all five frozen packets and change done', async () => {
  const adapter = createScriptedAdapter(
    IDS.map(() => ({
      finalText: '{"status":"done","summary":"offline fixture"}',
      before: async (req) => {
        expect(req.prompt).toContain(req.id);
        expect(req.prompt).toContain('criterion:0001/');
        await completeItem(req.cwd, req.id);
      },
    })),
  );
  const result = await evaluateImplementation(
    evalManifest,
    fixture.source,
    new Map([['scripted', adapter]]),
    {
      outDir: join(out, 'complete'),
      real: false,
      signal: new AbortController().signal,
    },
  );
  const benchmark = result[0]!;
  expect(benchmark.items.map((i) => i.state)).toEqual(
    Array(5).fill('accepted'),
  );
  expect(benchmark.finalVerification?.report?.status).toBe('done');
  for (const item of benchmark.items) {
    expect(item.specHash).not.toBeNull();
    expect(item.attempts[0]?.handoff.specHash).toBe(item.specHash!);
    expect(
      item.attempts[0]?.verification?.referenceTests?.cases.length,
    ).toBeGreaterThan(0);
    expect(item.attempts[0]?.audit?.ok).toBe(true);
  }
}, 120000);
test('one fresh correction keeps packet/hash; failed method leaves independent create executable', async () => {
  const seen: { item: string; packet: string; cwd: string }[] = [];
  const script = [
    {
      finalText: '{"status":"done","summary":"weak"}',
      before: async (
        req: import('../scripts/evals/contracts').AdapterRequest,
      ) => {
        await completeItem(req.cwd, IDS[0]!);
        const p = join(req.cwd, 'app/domain/task.ts');
        await writeFile(
          p,
          (await readFile(p, 'utf8')).replace('title.trim()', 'title       '),
        );
        await writeFile(
          join(req.cwd, 'app/test/entity-Task.test.ts'),
          `import { test,expect } from 'bun:test'; import { covers } from '@agentic-ddd/testing'; test(covers(['method:Task.create','invariant:Task/titulo-obrigatorio','criterion:0001/criacao','criterion:0001/titulo-invalido'],'weak green test'),()=>{expect(true).toBe(true)});\n`,
        );
        seen.push({
          item: IDS[0]!,
          packet: req.prompt.split('\nEnd packet')[0]!,
          cwd: req.cwd,
        });
      },
    },
    {
      finalText: '{"status":"done","summary":"fixed"}',
      before: async (
        req: import('../scripts/evals/contracts').AdapterRequest,
      ) => {
        await completeItem(req.cwd, IDS[0]!);
        seen.push({
          item: IDS[0]!,
          packet: req.prompt.split('\nEnd packet')[0]!,
          cwd: req.cwd,
        });
      },
    },
    { finalText: '{"status":"failed","summary":"cannot implement"}' },
    { finalText: '{"status":"failed","summary":"still cannot implement"}' },
    {
      finalText: '{"status":"done","summary":"independent create"}',
      before: async (
        req: import('../scripts/evals/contracts').AdapterRequest,
      ) => {
        await completeItem(req.cwd, IDS[2]!);
      },
    },
  ];
  const adapter = createScriptedAdapter(script);
  const result = (
    await evaluateImplementation(
      evalManifest,
      fixture.source,
      new Map([['scripted', adapter]]),
      {
        outDir: join(out, 'correction'),
        real: false,
        signal: new AbortController().signal,
      },
    )
  )[0]!;
  expect(result.items.find((i) => i.item === IDS[0])?.attempts).toHaveLength(2);
  const first = result.items.find((i) => i.item === IDS[0])!.attempts[0]!;
  expect(first.verification?.itemReport?.status).toBe('done');
  expect(first.verification?.executorTests?.exitCode).toBe(0);
  expect(
    first.verification?.referenceTests?.cases.some(
      (c) => c.status === 'failed',
    ),
  ).toBe(true);
  expect(new Set(seen.map((s) => s.cwd)).size).toBe(2);
  expect(seen[0]?.packet).toBe(seen[1]?.packet);
  expect(result.items.find((i) => i.item === IDS[1])?.state).toBe('failed');
  expect(result.items.find((i) => i.item === IDS[2])?.state).toBe('accepted');
  expect(result.items.find((i) => i.item === IDS[3])?.state).toBe('blocked');
}, 120000);

test('boundary audit rejects generated/config files, unexpected paths, malformed source and edits to accepted tests', async () => {
  const valid = join(fixture.source.root, 'audit-extra');
  await cp(baseline, valid, { recursive: true, verbatimSymlinks: true });
  await completeItem(valid, IDS[0]!);
  for (const [path, content] of [
    ['AGENTS.md', 'tampered'],
    ['agentic.config.ts', 'tampered'],
    ['app/unapproved.ts', 'export {};'],
  ]) {
    const old = await readFile(join(valid, path), 'utf8').catch(() => null);
    await writeFile(join(valid, path), content!);
    expect((await auditSubmission(baseline, valid, IDS[0]!)).ok).toBe(false);
    if (old === null) await rm(join(valid, path));
    else await writeFile(join(valid, path), old);
  }
  const accepted = join(fixture.source.root, 'audit-accepted');
  await cp(valid, accepted, { recursive: true, verbatimSymlinks: true });
  await completeItem(valid, IDS[1]!);
  await writeFile(
    join(valid, 'app/test/entity-Task.test.ts'),
    'changed accepted test',
  );
  expect((await auditSubmission(accepted, valid, IDS[1]!)).ok).toBe(false);
  const path = join(valid, 'app/domain/task.ts');
  const code = await readFile(path, 'utf8');
  await writeFile(path, code.replace('return task;', 'return ???;'));
  expect((await auditSubmission(baseline, valid, IDS[0]!)).ok).toBe(false);
});
test('archived coverage must come from executor; missing JUnit and verification timeout cannot certify done', async () => {
  const { createAttemptWorkspace, disposeWorkspace } =
    await import('../scripts/evals/isolation');
  const { verifySubmission } = await import('../scripts/evals/reference');
  const workspace = await createAttemptWorkspace(
    fixture.source,
    baseline,
    'implementation',
  );
  try {
    await completeItem(workspace.root, IDS[0]!);
    const path = join(workspace.root, 'app/test/entity-Task.test.ts');
    const original = await readFile(path, 'utf8');
    await writeFile(
      path,
      original.replaceAll(/, 'criterion:0001\/[a-z-]+'/g, ''),
    );
    const status = JSON.parse(
      await readFile(join(out, 'preparation/status/stdout.log'), 'utf8'),
    ) as { items: { id: string; specHash: string }[] };
    const handoff = {
      item: IDS[0]!,
      packet: 'frozen',
      specHash: status.items.find((i) => i.id === IDS[0])!.specHash,
      configPath: workspace.configPath,
      testFile: 'app/test/entity-Task.test.ts',
      criteria: [
        // eslint-disable-next-line unicorn/no-thenable
        { id: 'criacao', then: 'cria tarefa' },
        // eslint-disable-next-line unicorn/no-thenable
        { id: 'titulo-invalido', then: 'rejeita título' },
      ],
    };
    const first = await verifySubmission(fixture.source, workspace, handoff, {
      signal: new AbortController().signal,
      outDir: join(out, 'coverage'),
    });
    expect(first.itemReport?.status).toBe('done');
    expect(first.referenceTests?.exitCode).toBe(0);
    expect(first.ok).toBe(false);
    expect(first.findings.join()).toContain('Missing executor coverage');
    await writeFile(path, 'process.exit(0);\n');
    const missing = await verifySubmission(fixture.source, workspace, handoff, {
      signal: new AbortController().signal,
      outDir: join(out, 'missing-junit'),
    });
    expect(missing.ok).toBe(false);
    expect(missing.executorTests?.collectionError).toBeDefined();
    await writeFile(path, original);
    const timed = await verifySubmission(fixture.source, workspace, handoff, {
      signal: new AbortController().signal,
      outDir: join(out, 'verify-timeout'),
      control: {
        signal: new AbortController().signal,
        remainingMs: () => 1,
        stopReason: () => null,
        reserveInvocation: () => true,
        invocations: 0,
      },
    });
    expect(timed.ok).toBe(false);
    expect(timed.commands.some((c) => c.result.transport === 'timeout')).toBe(
      true,
    );
  } finally {
    await disposeWorkspace(workspace);
  }
}, 30000);
test('infrastructure gets no correction and preserves unstarted items', async () => {
  const adapter = createScriptedAdapter([{ argv: ['/missing-eval-agent'] }]);
  const result = (
    await evaluateImplementation(
      evalManifest,
      fixture.source,
      new Map([['scripted', adapter]]),
      {
        outDir: join(out, 'infrastructure'),
        real: false,
        signal: new AbortController().signal,
      },
    )
  )[0]!;
  expect(result.items[0]?.state).toBe('infra_error');
  expect(result.items[0]?.attempts).toHaveLength(1);
  expect(result.items.slice(1).map((i) => i.state)).toEqual(
    Array(4).fill('not_run'),
  );
  expect(result.finalVerification).toBeNull();
}, 30000);

test('submitted tests cannot disclose host files through either JUnit output symlink', async () => {
  const { createAttemptWorkspace, disposeWorkspace } =
    await import('../scripts/evals/isolation');
  const { verifySubmission } = await import('../scripts/evals/reference');
  const workspace = await createAttemptWorkspace(
    fixture.source,
    baseline,
    'implementation',
  );
  const host = join(out, 'host-only.txt');
  const marker = 'offline-host-bytes-must-never-be-published';
  await writeFile(host, marker);
  try {
    await completeItem(workspace.root, IDS[0]!);
    const original = await readFile(
      join(workspace.root, 'app/test/entity-Task.test.ts'),
      'utf8',
    );
    await writeFile(
      join(workspace.root, 'app/test/entity-Task.test.ts'),
      `import {symlinkSync,unlinkSync} from 'node:fs'; for (const name of ['.executor-junit.xml','.reference-junit.xml']) {try {unlinkSync(name)} catch {} symlinkSync(${JSON.stringify(host)},name)} process.exit(0);\n`,
    );
    const status = JSON.parse(
      await readFile(join(out, 'preparation/status/stdout.log'), 'utf8'),
    ) as { items: { id: string; specHash: string }[] };
    const evidence = join(out, 'unsafe-junit');
    const verified = await verifySubmission(
      fixture.source,
      workspace,
      {
        item: IDS[0]!,
        packet: 'frozen',
        specHash: status.items.find((i) => i.id === IDS[0])!.specHash,
        configPath: workspace.configPath,
        testFile: 'app/test/entity-Task.test.ts',
        criteria: [],
      },
      { signal: new AbortController().signal, outDir: evidence },
    );
    expect(verified.ok).toBe(false);
    for (const name of ['executor-junit.xml', 'reference-junit.xml'])
      expect(await readFile(join(evidence, name), 'utf8')).not.toContain(
        marker,
      );
    expect(verified.executorTests?.collectionError).toBeDefined();
    expect(verified.referenceTests?.collectionError).toBeDefined();
    await writeFile(
      join(workspace.root, 'app/test/entity-Task.test.ts'),
      original +
        '\nawait Bun.write("app/test/oversized.bin", Buffer.alloc(512 * 1024));\n',
    );
    const resource = await verifySubmission(
      fixture.source,
      workspace,
      {
        item: IDS[0]!,
        packet: 'frozen',
        specHash: status.items.find((i) => i.id === IDS[0])!.specHash,
        configPath: workspace.configPath,
        testFile: 'app/test/entity-Task.test.ts',
        criteria: [],
      },
      {
        signal: new AbortController().signal,
        outDir: join(out, 'unsafe-verifier-tree'),
      },
    );
    expect(resource.ok).toBe(false);
    expect(resource.findings.join()).toContain('Unsafe verifier workspace');
  } finally {
    await disposeWorkspace(workspace);
  }
}, 30000);

test('private oracle detects omitted save even when shared in-memory references make executor tests pass', async () => {
  let omit = true;
  const adapter = createScriptedAdapter(
    Array.from({ length: 6 }, () => ({
      finalText: '{"status":"done","summary":"offline persistence fixture"}',
      before: async (
        req: import('../scripts/evals/contracts').AdapterRequest,
      ) => {
        await completeItem(req.cwd, req.id);
        if (req.id === 'usecase:complete_task' && omit) {
          omit = false;
          const path = join(req.cwd, 'app/application/complete-task.ts');
          await writeFile(
            path,
            (await readFile(path, 'utf8')).replace(
              'await this.tasks.save(task);',
              '/* omitted persistence */',
            ),
          );
        }
      },
    })),
  );
  const benchmark = (
    await evaluateImplementation(
      evalManifest,
      fixture.source,
      new Map([['scripted', adapter]]),
      {
        outDir: join(out, 'persistence-oracle'),
        real: false,
        signal: new AbortController().signal,
      },
    )
  )[0]!;
  const item = benchmark.items.find((i) => i.item === 'usecase:complete_task')!;
  expect(item.attempts).toHaveLength(2);
  expect(item.attempts[0]?.verification?.itemReport?.status).toBe('done');
  expect(item.attempts[0]?.verification?.executorTests?.exitCode).toBe(0);
  expect(item.attempts[0]?.accepted).toBe(false);
  expect(item.attempts[1]?.accepted).toBe(true);
  expect(benchmark.finalVerification?.report?.status).toBe('done');
}, 120000);
