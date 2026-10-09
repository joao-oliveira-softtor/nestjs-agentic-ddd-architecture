import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseJUnit, type TestRun } from '@agentic-ddd/compiler';
import type {
  AttemptWorkspace,
  ItemHandoff,
  PreparedSource,
  RunOptions,
  VerificationEvidence,
  CommandEvidence,
} from './contracts';
import { createAttemptWorkspace, disposeWorkspace } from './isolation';
import { workspaceCommand, cliArgv } from './commands';
import { TASK_ITEMS, readTree } from './audit';
import { readPrivateFile } from './private-files';
import { OUTPUT_LIMIT_BYTES } from './process';

function tests(command: CommandEvidence, xml: string): TestRun {
  const cases = parseJUnit(xml);
  const valid =
    /<testsuites?\b/.test(xml) && /<\/testsuites?>\s*$/.test(xml.trim());
  const incomplete =
    command.result.transport !== 'finished' ||
    !valid ||
    !cases.length ||
    /(?:^|\n)# Unhandled error between tests\b/.test(command.result.stderr) ||
    (command.result.exitCode !== 0 &&
      !cases.some((c) => c.status === 'failed'));
  return {
    exitCode: command.result.exitCode ?? 1,
    cases,
    ...(incomplete
      ? { collectionError: 'JUnit missing, invalid or incomplete' }
      : {}),
  };
}
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
        report.gates.length !== 5
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
    const executor = await record('executor-tests', [
      process.execPath,
      'test',
      '--reporter=junit',
      `--reporter-outfile=${junit}`,
    ]);
    const xml = await readPrivateFile(
      workspace.root,
      junit,
      OUTPUT_LIMIT_BYTES,
    ).catch(() => '');
    await writeFile(join(evidenceDir, 'executor-junit.xml'), xml);
    evidence.executorTests = tests(executor, xml);
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
    const oracle = await record(
      'reference-tests',
      [
        process.execPath,
        'test',
        referencePath,
        '--reporter=junit',
        `--reporter-outfile=${oracleJunit}`,
      ],
      [referenceDir],
    );
    const oracleXml = await readPrivateFile(
      workspace.root,
      oracleJunit,
      OUTPUT_LIMIT_BYTES,
    ).catch(() => '');
    await writeFile(join(evidenceDir, 'reference-junit.xml'), oracleXml);
    evidence.referenceTests = tests(oracle, oracleXml);
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
    const finalTree = await readTree(workspace.root);
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
  }
}
