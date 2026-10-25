import { afterAll, beforeAll, expect, test as bunTest } from 'bun:test';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditSubmission, scopeFindings } from '../scripts/evals/audit';
import {
  BARE_HIDDEN,
  BARE_RETRY,
  correctionFor,
  evaluateImplementation,
  prepareTasksBaseline,
  retryPolicy,
  seedBaseline,
  wantsRetry,
  withoutAgentFiles,
} from '../scripts/evals/implementation';
import type { ItemAttempt, PreparedSource } from '../scripts/evals/contracts';
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
test('promptMode brief entrega o brief D5 nos cinco itens e mantém o mesmo critério de aceite', async () => {
  const prompts: string[] = [];
  const adapter = createScriptedAdapter(
    IDS.map(() => ({
      finalText: '{"status":"done","summary":"offline fixture"}',
      before: async (req) => {
        prompts.push(req.prompt);
        await completeItem(req.cwd, req.id);
      },
    })),
  );
  const result = await evaluateImplementation(
    {
      ...evalManifest,
      configurations: [
        { ...evalManifest.configurations[0]!, promptMode: 'brief' },
      ],
    },
    fixture.source,
    new Map([['scripted', adapter]]),
    {
      outDir: join(out, 'brief'),
      real: false,
      signal: new AbortController().signal,
    },
  );
  expect(prompts).toHaveLength(5);
  for (const prompt of prompts) {
    expect(prompt).toContain(
      'Protocolo do benchmark (prevalece sobre o brief acima)',
    );
    expect(prompt).toContain('criterion:0001/');
    expect(prompt).not.toContain('Leia .agents/skills/agentic-ddd/SKILL.md');
  }
  expect(result[0]!.items.map((i) => i.state)).toEqual(
    Array(5).fill('accepted'),
  );
  expect(result[0]!.finalVerification?.report?.status).toBe('done');
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
    expect(first.referenceTests?.collectionError).toBeUndefined();
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

// The oracle imports the submitted module in the same `bun test` process. The
// forged JUnit carries the oracle's own names and count, so only the run itself
// can tell it apart.
const ENTITY_ORACLE = [
  'cria tarefa normalizada e registra evento',
  'cria tarefa normalizada e registra evento',
  'rejeita título vazio ou só espaços',
  'rejeita título vazio ou só espaços',
];
const FORGED_JUNIT = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="bun test" tests="4" failures="0">\n<testsuite name="behavior.test.ts" file="behavior.test.ts" tests="4" failures="0">\n${ENTITY_ORACLE.map(
  (n) => `<testcase name="${n}" classname="" file="behavior.test.ts" />`,
).join('\n')}\n</testsuite>\n</testsuites>\n`;
const FORGED_SUMMARY = ' 4 pass\n 0 fail\nRan 4 tests across 1 file. [1.00ms]';
async function verifyForged(
  name: string,
  prepare: (root: string) => Promise<void>,
) {
  const { createAttemptWorkspace, disposeWorkspace } =
    await import('../scripts/evals/isolation');
  const { verifySubmission } = await import('../scripts/evals/reference');
  const workspace = await createAttemptWorkspace(
    fixture.source,
    baseline,
    'implementation',
  );
  try {
    // entity:Task stays notImplemented(): a real oracle run must fail.
    await prepare(workspace.root);
    const status = JSON.parse(
      await readFile(join(out, 'preparation/status/stdout.log'), 'utf8'),
    ) as { items: { id: string; specHash: string }[] };
    return await verifySubmission(
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
      { signal: new AbortController().signal, outDir: join(out, name) },
    );
  } finally {
    await disposeWorkspace(workspace);
  }
}
async function forgeOracleFrom(root: string, terminate: string) {
  const path = join(root, 'app/domain/task.ts');
  await writeFile(
    path,
    `import { readFileSync as __read, writeFileSync as __write } from 'node:fs';
{
  const __argv = __read('/proc/self/cmdline', 'utf8').split('\\0');
  const __out = __argv
    .find((a) => a.startsWith('--reporter-outfile='))
    ?.slice('--reporter-outfile='.length);
  if (__out?.endsWith('.reference-junit.xml')) {
    __write(__out, ${JSON.stringify(FORGED_JUNIT)});
    console.error(${JSON.stringify(FORGED_SUMMARY)});
    ${terminate};
  }
}
` + (await readFile(path, 'utf8')),
  );
}
const expectOracleRejected = (
  evidence: Awaited<ReturnType<typeof verifyForged>>,
) => {
  expect(evidence.ok).toBe(false);
  expect(evidence.findings.join('\n')).toContain(
    'Private behavior oracle failed',
  );
};
test('forged oracle JUnit read from /proc/self/cmdline is rejected when the module exits cleanly', async () => {
  for (const terminate of ['process.exit(0)', 'process.reallyExit(0)'])
    expectOracleRejected(
      await verifyForged(`forge-${terminate.slice(8, 12)}`, (root) =>
        forgeOracleFrom(root, terminate),
      ),
    );
}, 60000);
test('forged oracle JUnit is rejected when the module aborts or kills itself', async () => {
  for (const terminate of [
    'process.abort()',
    "process.kill(process.pid, 'SIGKILL')",
  ])
    expectOracleRejected(
      await verifyForged(`forge-${terminate.slice(8, 12)}`, (root) =>
        forgeOracleFrom(root, terminate),
      ),
    );
}, 60000);
test('a JUnit present before either run is an explicit failure, not evidence', async () => {
  const planted = await verifyForged('planted-junit', async (root) => {
    // The executor suite plants the oracle's fixed outfile; the module then
    // leaves the oracle run before Bun writes its own report.
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(root, 'app/test'), { recursive: true });
    await writeFile(
      join(root, 'app/test/entity-Task.test.ts'),
      `import { writeFileSync } from 'node:fs';
import { test } from 'bun:test';
writeFileSync('.reference-junit.xml', ${JSON.stringify(FORGED_JUNIT)});
test('planta o relatório do oráculo', () => {});
`,
    );
    const path = join(root, 'app/domain/task.ts');
    await writeFile(
      path,
      `if (require('node:fs').readFileSync('/proc/self/cmdline', 'utf8').includes('behavior.test.ts')) process.exit(0);\n` +
        (await readFile(path, 'utf8')),
    );
    await writeFile(join(root, '.executor-junit.xml'), FORGED_JUNIT);
  });
  expect(planted.ok).toBe(false);
  expect(planted.executorTests?.collectionError).toContain('before the run');
  expect(planted.referenceTests?.collectionError).toContain('before the run');
  expectOracleRejected(planted);
}, 60000);

test('a bunfig.toml planted by the executor suite cannot preload code ahead of the guard', async () => {
  const evidence = await verifyForged('planted-bunfig', async (root) => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(root, 'app/test'), { recursive: true });
    // Its preload would keep the original reallyExit before the guard locks it.
    await writeFile(
      join(root, 'app/test/entity-Task.test.ts'),
      `import { writeFileSync } from 'node:fs';
import { test } from 'bun:test';
writeFileSync('bunfig.toml', '[test]\\npreload = ["./keep-exit.ts"]\\n');
writeFileSync('keep-exit.ts', 'globalThis.__exit = process.reallyExit;\\n');
test('planta a configuração', () => {});
`,
    );
    const path = join(root, 'app/domain/task.ts');
    await writeFile(
      path,
      `import { rmSync as __rm, writeFileSync as __write } from 'node:fs';
if (process.argv.some((a) => a.endsWith('behavior.test.ts'))) {
  __rm('bunfig.toml', { force: true });
  __rm('keep-exit.ts', { force: true });
  __write('.reference-junit.xml', ${JSON.stringify(FORGED_JUNIT)});
  console.error(${JSON.stringify(FORGED_SUMMARY)});
  (globalThis as { __exit?: (code: number) => never }).__exit?.(0);
}
` + (await readFile(path, 'utf8')),
    );
  });
  expectOracleRejected(evidence);
}, 60000);

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

const VO = `export class Money {
  #cache = 0;
  constructor(amount: number) {
    this.#cache = amount;
  }
  #helper(): number {
    return 1;
  }
}
`;
const voAudit = (after: string) =>
  scopeFindings('valueobject:Money', VO, after, 'Money', 'x', 'a.ts');

test('auditoria de escopo de classe aceita mudança em membro #privado de VO', () => {
  expect(voAudit(VO.replace('return 1;', 'return 2;'))).toEqual([]);
});

test('auditoria de escopo de classe reprova mudança de extends', () => {
  expect(
    voAudit(VO.replace('class Money', 'class Money extends Base')),
  ).not.toEqual([]);
});

const attemptWith = (partial: object) =>
  ({
    execution: { transport: 'finished' },
    reply: { status: 'done', summary: 's' },
    accepted: false,
    reason: 'independent_verification_failed',
    ...partial,
  }) as unknown as ItemAttempt;
const ORACLE_FINDING =
  'Private behavior oracle failed for criteria c: trap:B aceita turma cheia';

test('matriculas: C0 só repete quando a execução não terminou, sem findings', () => {
  const policy = retryPolicy(true, 'bare');
  expect(policy).toBe('transport');
  const unfinished = attemptWith({ execution: { transport: 'timeout' } });
  expect(wantsRetry(policy, unfinished)).toBe(true);
  expect(correctionFor(policy, unfinished)).toBe(`\n${BARE_RETRY}`);
  expect(BARE_RETRY).toBe(
    'a submissão anterior não terminou; refaça a partir do baseline',
  );
  const failedOracle = attemptWith({
    verification: { findings: [ORACLE_FINDING] },
  });
  expect(wantsRetry(policy, failedOracle)).toBe(false);
  expect(correctionFor(policy, undefined)).toBe('');
});

test('matriculas: F repete só pelos gates do framework e tira o oráculo da correção', () => {
  const policy = retryPolicy(true, 'brief');
  expect(policy).toBe('framework');
  const onlyOracle = attemptWith({
    audit: { ok: true, findings: [], patch: '[]' },
    verification: { findings: [ORACLE_FINDING] },
  });
  expect(wantsRetry(policy, onlyOracle)).toBe(false);
  const gates = attemptWith({
    audit: { ok: false, findings: ['Forbidden file change: x'], patch: '[]' },
    verification: {
      findings: [ORACLE_FINDING, 'Missing executor coverage: criterion:0001/a'],
    },
  });
  expect(wantsRetry(policy, gates)).toBe(true);
  const text = correctionFor(policy, gates);
  expect(text).toContain('Forbidden file change: x');
  expect(text).toContain('Missing executor coverage: criterion:0001/a');
  expect(text).not.toContain('Private behavior oracle');
  expect(text).not.toContain('trap:');
});

test('tasks mantém a política e o texto de correção de sempre', () => {
  const policy = retryPolicy(false, 'bare');
  expect(policy).toBe('default');
  const failed = attemptWith({
    audit: { ok: true, findings: [], patch: '[]' },
    verification: { findings: [ORACLE_FINDING] },
  });
  expect(wantsRetry(policy, failed)).toBe(true);
  expect(correctionFor(policy, failed)).toContain(ORACLE_FINDING);
});

test('C0: esconde os arquivos de skill/regras no turno e devolve depois, também se lançar', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bare-hide-'));
  try {
    const root = join(dir, 'ws');
    await mkdir(root);
    for (const name of BARE_HIDDEN)
      if (name.includes('.md')) await writeFile(join(root, name), name);
      else {
        await mkdir(join(root, name));
        await writeFile(join(root, name, 'x'), name);
      }
    await mkdir(join(root, 'app'));
    const before = (await readdir(root)).sort();
    const during = await withoutAgentFiles(root, () => readdir(root));
    expect(during).toEqual(['app']);
    expect((await readdir(root)).sort()).toEqual(before);
    expect(await readFile(join(root, '.ai/x'), 'utf8')).toBe('.ai');
    const failure = await withoutAgentFiles(root, async () => {
      expect(await readdir(root)).toEqual(['app']);
      throw new Error('timeout');
    }).catch((error: Error) => error.message);
    expect(failure).toBe('timeout');
    expect((await readdir(root)).sort()).toEqual(before);
    expect(await readdir(dir)).toEqual(['ws']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('matriculas: baseline semeado traz só as soluções dos colaboradores', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'seeded-'));
  try {
    const initial = join(dir, 'matriculas');
    const made = Bun.spawnSync([
      process.execPath,
      'scripts/create-skills-example.ts',
      '--root',
      initial,
      '--tutorial',
      'matriculas',
    ]);
    expect(made.exitCode).toBe(0);
    const root = await seedBaseline({ root: dir } as PreparedSource, initial, [
      'entity:Aluno',
      'valueobject:AlunoId',
    ]);
    const read = (file: string) => readFile(join(root, file), 'utf8');
    for (const file of ['app/domain/aluno.ts', 'app/domain/aluno-id.ts'])
      expect(await read(file)).not.toContain('notImplemented()');
    for (const file of ['app/domain/turma.ts', 'app/domain/matricula.ts'])
      expect(await read(file)).toContain('notImplemented()');
    expect((await readdir(join(root, 'app/test'))).sort()).toEqual([
      'entity-Aluno.test.ts',
      'valueobject-AlunoId.test.ts',
    ]);
    expect(await read('app/domain/aluno.ts')).not.toBe(
      await readFile(join(initial, 'app/domain/aluno.ts'), 'utf8'),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 60000);
