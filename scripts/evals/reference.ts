import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseJUnit, type TestRun } from '@agentic-ddd/compiler';
import type {
  AttemptWorkspace,
  ItemHandoff,
  PreparedSource,
  ProcessResult,
  RunOptions,
  VerificationEvidence,
} from './contracts';
import { createAttemptWorkspace, disposeWorkspace } from './isolation';
import { workspaceCommand, cliArgv } from './commands';
import { TASK_ITEMS, readTree } from './audit';
import { readPrivateFile } from './private-files';
import { OUTPUT_LIMIT_BYTES } from './process';

/** Private oracle test names per item, as a multiset: each template loops over two ids. */
export const ORACLE_CASES: Readonly<Record<string, readonly string[]>> = {
  'entity:Task': [
    'cria tarefa normalizada e registra evento',
    'cria tarefa normalizada e registra evento',
    'rejeita título vazio ou só espaços',
    'rejeita título vazio ou só espaços',
  ],
  'method:Task.complete': Array(2).fill('conclui, emite e rejeita repetição'),
  'usecase:create_task': Array(2).fill('persiste, publica e rejeita duplicado'),
  'usecase:complete_task': Array(2).fill(
    'conclui, persiste, publica e rejeita id ausente',
  ),
  'operator:task-operator': Array(2).fill(
    'operator executa tools reais e publica eventos',
  ),
};
// Bun prints this summary last; a run left early has none of its own.
const SUMMARY = /(?:^|\n)Ran (\d+) tests? across \d+ files?\./g;
const multiset = (names: readonly string[]) => [...names].sort().join('\n');

export function testRunOf(
  result: ProcessResult,
  xml: string,
  expected?: readonly string[],
): TestRun {
  const cases = parseJUnit(xml);
  const valid =
    /<testsuites?\b/.test(xml) && /<\/testsuites?>\s*$/.test(xml.trim());
  const ran = [...result.stderr.matchAll(SUMMARY)].at(-1)?.[1];
  const incomplete =
    result.transport !== 'finished' ||
    !valid ||
    !cases.length ||
    /(?:^|\n)# Unhandled error between tests\b/.test(result.stderr) ||
    (result.exitCode !== 0 && !cases.some((c) => c.status === 'failed')) ||
    Number(ran) !== cases.length ||
    (expected !== undefined &&
      multiset(cases.map((c) => c.name)) !== multiset(expected));
  return {
    exitCode: result.exitCode ?? 1,
    cases,
    ...(incomplete
      ? { collectionError: 'JUnit missing, invalid or incomplete' }
      : {}),
  };
}
/** Removes a JUnit outfile before its run; true when one was already there. */
async function clearOutfile(path: string): Promise<boolean> {
  const existed = await lstat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );
  await rm(path, { force: true, recursive: true });
  return existed;
}
const PLANTED = { collectionError: 'JUnit output existed before the run' };
/** 5 gates, ou 6 quando o sexto é o T (matriculas). */
export const gateCountValid = (gates: readonly { id: string }[]) =>
  gates.length === 5 || (gates.length === 6 && gates.some((g) => g.id === 'T'));

export async function verifySubmission(
  source: PreparedSource,
  submitted: AttemptWorkspace,
  handoff: ItemHandoff,
  options: {
    signal: AbortSignal;
    outDir?: string;
    control?: RunOptions['control'];
  },
): Promise<VerificationEvidence> {
  const workspace = await createAttemptWorkspace(
    source,
    submitted.root,
    'implementation',
  );
  const evidenceDir =
    options.outDir ?? join(source.root, 'verification-evidence');
  const runOptions = { ...options, outDir: evidenceDir, real: false };
  const evidence: VerificationEvidence = {
    ok: false,
    findings: [],
    commands: [],
    itemReport: null,
    executorTests: null,
    referenceTests: null,
  };
  const originalTree = await readTree(submitted.root);
  let guardDir: string | undefined;
  const record = async (
    name: string,
    argv: readonly string[],
    readOnly: readonly string[] = [],
  ) => {
    const command = await workspaceCommand(
      workspace,
      name,
      argv,
      runOptions,
      join(evidenceDir, name),
      readOnly,
    );
    evidence.commands.push(command);
    return command;
  };
  try {
    // Outside the workspace and mounted read-only, so submitted code cannot
    // edit it. The empty config keeps Bun from reading a bunfig.toml the
    // executor suite may plant in the workspace, whose preload would run first.
    guardDir = await mkdtemp(join(tmpdir(), 'eval-guard-'));
    const guard = join(guardDir, 'preload-guard.ts');
    const config = join(guardDir, 'bunfig.toml');
    await copyFile(join(import.meta.dir, 'preload-guard.ts'), guard);
    await writeFile(config, '');
    const verify = await record(
      'verify-item',
      cliArgv(workspace, [
        'verify',
        '--item',
        handoff.item,
        '--spec-hash',
        handoff.specHash,
        '--json',
      ]),
    );
    try {
      const report = JSON.parse(
        verify.result.stdout,
      ) as VerificationEvidence['itemReport'];
      if (
        !report ||
        report.item !== handoff.item ||
        !['done', 'failed'].includes(report.status) ||
        !gateCountValid(report.gates)
      )
        throw Error('invalid gates');
      evidence.itemReport = report;
    } catch {
      evidence.findings.push('Individual verify produced no valid gate report');
    }
    if (
      verify.result.transport !== 'finished' ||
      verify.result.exitCode !== 0 ||
      evidence.itemReport?.status !== 'done'
    )
      evidence.findings.push('Individual verify did not certify done');
    const junit = join(workspace.root, '.executor-junit.xml');
    const plantedExecutor = await clearOutfile(junit);
    const executor = await record(
      'executor-tests',
      [
        process.execPath,
        'test',
        `--config=${config}`,
        `--preload=${guard}`,
        '--reporter=junit',
        `--reporter-outfile=${junit}`,
      ],
      [guardDir],
    );
    const xml = await readPrivateFile(
      workspace.root,
      junit,
      OUTPUT_LIMIT_BYTES,
    ).catch(() => '');
    await writeFile(join(evidenceDir, 'executor-junit.xml'), xml);
    evidence.executorTests = {
      ...testRunOf(executor.result, xml),
      ...(plantedExecutor ? PLANTED : {}),
    };
    if (
      evidence.executorTests.collectionError ||
      executor.result.exitCode !== 0 ||
      evidence.executorTests.cases.some((c) => c.status !== 'passed')
    )
      evidence.findings.push('Executor suite did not pass completely');
    for (const criterion of handoff.criteria)
      if (
        !evidence.executorTests.cases.some(
          (c) =>
            c.status === 'passed' &&
            c.covers.includes(`criterion:0001/${criterion.id}`),
        )
      )
        evidence.findings.push(
          `Missing executor coverage: criterion:0001/${criterion.id}`,
        );
    // Hidden oracle is added only after the executor suite; it carries no covers declarations.
    const assignment = TASK_ITEMS.find((i) => i.id === handoff.item)!;
    const template = await readFile(
      resolve(
        import.meta.dir,
        '../../evals/implementation/tasks/reference',
        assignment.test.split('/').at(-1)! + '.txt',
      ),
      'utf8',
    );
    const referenceDir = join(workspace.root, '.eval-reference');
    await mkdir(referenceDir);
    const referencePath = join(referenceDir, 'behavior.test.ts');
    await writeFile(
      referencePath,
      template.replaceAll('__WORKSPACE__', workspace.root),
    );
    const oracleJunit = join(workspace.root, '.reference-junit.xml');
    // The executor suite ran in this workspace and may have left it there.
    const plantedOracle = await clearOutfile(oracleJunit);
    const oracle = await record(
      'reference-tests',
      [
        process.execPath,
        'test',
        `--config=${config}`,
        `--preload=${guard}`,
        referencePath,
        '--reporter=junit',
        `--reporter-outfile=${oracleJunit}`,
      ],
      [referenceDir, guardDir],
    );
    const oracleXml = await readPrivateFile(
      workspace.root,
      oracleJunit,
      OUTPUT_LIMIT_BYTES,
    ).catch(() => '');
    await writeFile(join(evidenceDir, 'reference-junit.xml'), oracleXml);
    evidence.referenceTests = {
      ...testRunOf(oracle.result, oracleXml, ORACLE_CASES[handoff.item] ?? []),
      ...(plantedOracle ? PLANTED : {}),
    };
    if (
      evidence.referenceTests.collectionError ||
      oracle.result.exitCode !== 0 ||
      evidence.referenceTests.cases.some((c) => c.status !== 'passed')
    )
      evidence.findings.push(
        `Private behavior oracle failed for criteria ${handoff.criteria.map((c) => c.id).join(', ')}: ${
          evidence.referenceTests.collectionError ??
          evidence.referenceTests.cases
            .filter((c) => c.status !== 'passed')
            .map((c) => c.name)
            .join('; ')
        }`,
      );
    const compile = await record(
      'compile-check',
      cliArgv(workspace, ['compile', '--check']),
    );
    if (
      compile.result.transport !== 'finished' ||
      compile.result.exitCode !== 0
    )
      evidence.findings.push('Generated files / compile --check diverged');
    let finalTree: Awaited<ReturnType<typeof readTree>>;
    try {
      finalTree = await readTree(workspace.root);
    } catch (error) {
      evidence.findings.push(`Unsafe verifier workspace: ${String(error)}`);
      return evidence;
    }
    for (const path of new Set([...originalTree.keys(), ...finalTree.keys()])) {
      if (
        path === '.executor-junit.xml' ||
        path === '.reference-junit.xml' ||
        path === '.eval-reference' ||
        path.startsWith('.eval-reference/')
      )
        continue;
      const before = originalTree.get(path),
        after = finalTree.get(path);
      if (
        before?.kind !== after?.kind ||
        before?.hash !== after?.hash ||
        before?.mode !== after?.mode
      )
        evidence.findings.push(
          `Verifier workspace mutated by submitted code: ${path}`,
        );
    }
    evidence.ok = evidence.findings.length === 0;
    return evidence;
  } finally {
    await disposeWorkspace(workspace);
    if (guardDir) await rm(guardDir, { recursive: true, force: true });
  }
}
