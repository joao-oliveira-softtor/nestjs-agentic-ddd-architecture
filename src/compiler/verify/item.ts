import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { AgenticError, type ErrorCode } from '../ir';
import {
  statusFromEvidence,
  stateContext,
  type StateContext,
} from '../project-state';
import type { ProjectStatus, WorkItemStatus } from '../state';
import { IGNORED_TEST_PATH } from '../static-tests';
import type { Finding, GateResult } from './gates';
import { hasTacticalElements, tacticalGate } from './tactical';
import { runTests, VERIFY_ENV, type TestRun } from './test-run';

export interface ItemVerifyOptions {
  readonly configPath: string;
  readonly item: string;
  readonly specHash: string;
}
export interface ItemVerifyReport {
  readonly item: string;
  readonly status: 'done' | 'failed';
  readonly gates: GateResult[];
}

const TEST_FILES = '**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}';
const PATH_ARGUMENT = /^(\.\.?\/|\/)/;
const NO_EVIDENCE: TestRun = { cases: [], exitCode: 0 };

const posix = (path: string): string => path.replaceAll('\\', '/');

/** Obligation ids of the item and of everything it depends on, directly or not. */
function closureObligations(
  items: readonly WorkItemStatus[],
  id: string,
): string[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const visit = (current: string): void => {
    const item = byId.get(current);
    if (!item || seen.has(current)) return;
    seen.add(current);
    item.dependsOn.forEach(visit);
  };
  visit(id);
  return [...seen].flatMap((i) => byId.get(i)!.obligations);
}

/**
 * Test files under `root`, of any extension, that quote one of the obligation
 * ids. Reading the text instead of the syntax tree also finds `test.each`,
 * computed titles and `test` re-exported from a helper.
 */
export async function testFilesFor(
  root: string,
  obligations: readonly string[],
): Promise<string[]> {
  const quoted = obligations.flatMap((id) => [
    `'${id}'`,
    `"${id}"`,
    `\`${id}\``,
  ]);
  const files: string[] = [];
  for await (const scanned of new Bun.Glob(TEST_FILES).scan({
    cwd: root,
    onlyFiles: true,
  }))
    if (!IGNORED_TEST_PATH.test(posix(scanned))) files.push(posix(scanned));
  const texts = await Promise.all(
    files.map((file) => readFile(join(root, file), 'utf8')),
  );
  return files
    .filter((_, i) => quoted.some((q) => texts[i]!.includes(q)))
    .sort();
}

/**
 * Narrows a `bun test` command to `files`, keeping its flags and only the
 * files that sit under one of its configured paths (`test/evals-*` stay out).
 * Returns null when nothing is left to run. Any other command, or one where a
 * path may be the value of a flag (`--preload ./setup.ts`), is returned whole.
 * shortcut: a bare name filter (`app.test.ts`) stays in the command and keeps
 * running; write the path as `./app.test.ts` to narrow it.
 * shortcut: an ambiguous command runs whole; write `--flag=value` to narrow it.
 */
export function scopedTestCommand(
  command: readonly string[],
  root: string,
  files: readonly string[],
): string[] | null {
  const args = command.slice(2);
  const valueOfFlag = (arg: string, i: number): boolean =>
    PATH_ARGUMENT.test(arg) &&
    (args[i - 1]?.startsWith('-') ?? false) &&
    !args[i - 1]!.includes('=');
  if (command[1] !== 'test' || args.some(valueOfFlag)) return [...command];
  const scopes = args
    .filter((arg) => PATH_ARGUMENT.test(arg))
    .map((arg) => posix(relative(root, resolve(root, arg))));
  const inScope = (file: string): boolean =>
    scopes.length === 0 ||
    scopes.some((s) => s === '' || file === s || file.startsWith(`${s}/`));
  const selected = files.map(posix).filter(inScope);
  return selected.length
    ? [
        ...command.slice(0, 2),
        ...args.filter((arg) => !PATH_ARGUMENT.test(arg)),
        ...selected.map((file) => `./${file}`),
      ]
    : null;
}

/** Status judged only by the tests that quote the item's or its dependencies' obligations. */
async function scopedStatus(
  context: StateContext,
  id: string,
): Promise<ProjectStatus> {
  const { root, verify } = context.project.config;
  const declared = statusFromEvidence(context, NO_EVIDENCE, 'static');
  const files = await testFilesFor(
    root,
    closureObligations(declared.items, id),
  );
  const command = scopedTestCommand(verify.test, root, files);
  const evidence = command ? await runTests(command, root) : NO_EVIDENCE;
  if (evidence.collectionError)
    throw new AgenticError('verify.collection-error', evidence.collectionError);
  return statusFromEvidence(context, evidence);
}

export async function verifyItem(
  options: ItemVerifyOptions,
): Promise<ItemVerifyReport> {
  const context = await stateContext(options.configPath);
  const report = await scopedStatus(context, options.item);
  const item = report.items.find((i) => i.id === options.item);
  if (!item)
    throw new AgenticError(
      'state.item-not-found',
      `work item ${options.item} not found`,
    );
  const findings = (
    code: ErrorCode,
    messages: string[],
    fix: string,
  ): Finding[] =>
    messages
      .sort()
      .map((message) => ({ code, message, fix, source: item.source }));
  const gate = (
    id: GateResult['id'],
    name: string,
    findings: Finding[],
  ): GateResult => ({
    id,
    name,
    status: findings.length ? 'failed' : 'passed',
    findings,
    warnings: [],
  });
  const command = context.project.config.verify.commands.find(
    (c) => c.name === 'typecheck',
  )?.command ?? ['bun', 'run', 'typecheck'];
  const proc = Bun.spawn([...command], {
    cwd: context.project.config.root,
    env: { ...process.env, [VERIFY_ENV]: '1' },
    stdout: 'ignore',
    stderr: 'ignore',
  });
  const exitCode = await proc.exited;
  const gates = [
    gate(
      'I1',
      'Dependencies',
      findings(
        'verify.item-dependency-not-done',
        item.blockedBy.map((id) => `${id} is not done`),
        'finish the dependencies with packet and verify --item',
      ),
    ),
    gate(
      'I2',
      'Implementation',
      findings(
        'verify.item-not-implemented',
        item.baseState === 'declared'
          ? ['body still contains notImplemented() or execute is missing']
          : [],
        `implement the body of ${item.id}`,
      ),
    ),
    gate(
      'I3',
      'Specification',
      findings(
        'verify.item-spec-hash-mismatch',
        item.specHash !== options.specHash
          ? ['specHash differs from the current specification']
          : [],
        `restore the declaration or request a new packet ${item.id}`,
      ),
    ),
    gate('I4', 'Obligations', [
      ...findings(
        'verify.item-obligation-untested',
        item.missingObligations.map((id) => `${id} has no test`),
        'create tests with covers for the obligations',
      ),
      ...item.unsuccessfulTests.map((t) => ({
        code: 'verify.item-test-unsuccessful' as const,
        message: `test ${t.status}: ${t.name}`,
        source: `${t.file}:${t.line}`,
        fix: 'fix the code or the test until it passes',
      })),
    ]),
    gate(
      'I5',
      'Typecheck',
      findings(
        'verify.item-typecheck-failed',
        exitCode !== 0 ? [`typecheck exited with ${exitCode}`] : [],
        `run ${command.join(' ')} and fix it`,
      ),
    ),
  ];
  const { ir, registry, config } = context.project;
  const target = (() => {
    switch (item.id.slice(0, item.id.indexOf(':'))) {
      case 'entity':
        return { kind: 'entity', records: registry.entities } as const;
      case 'valueobject':
        return { kind: 'valueobject', records: registry.valueObjects } as const;
      default:
        return null;
    }
  })();
  if (target && hasTacticalElements(ir)) {
    const { kind, records } = target;
    const name = item.id.slice(item.id.indexOf(':') + 1);
    const record = records.find((r) => r.target.name === name);
    gates.push(
      gate(
        'T',
        'Tactical',
        record
          ? tacticalGate({
              ir,
              record,
              root: config.root,
              owner: item.id,
              kind,
            })
          : [
              {
                code: 'verify.tactical-class-missing' as const,
                message: `T: class ${name} not found in the registry`,
                fix: 'check the decorator on the source line',
                source: item.source,
              },
            ],
      ),
    );
  }
  return {
    item: item.id,
    status: gates.every((g) => g.status === 'passed') ? 'done' : 'failed',
    gates,
  };
}
