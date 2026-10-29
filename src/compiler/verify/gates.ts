import { sha256 } from '../canonical';
import type { Proposal } from '../changes/proposal';
import { deltaProblems } from '../changes/reconcile';
import type { DiffItem } from '../diff';
import type { ErrorCode } from '../ir';
import type { DomainLock } from '../lock';
import type { TestCaseResult, TestRun } from './test-run';

export type GateId =
  | 'G1'
  | 'G2'
  | 'G3'
  | 'G4'
  | 'G5'
  | 'G6'
  | 'G7'
  | 'I1'
  | 'I2'
  | 'I3'
  | 'I4'
  | 'I5'
  | 'T';
export type GateStatus = 'passed' | 'failed' | 'pending';

export interface Finding {
  readonly code: ErrorCode;
  readonly message: string;
  readonly fix: string | null;
  readonly source: string | null;
}

export interface GateResult {
  readonly id: GateId;
  readonly name: string;
  readonly status: GateStatus;
  readonly findings: Finding[];
  readonly warnings: Finding[];
}

export type VerifyStatus = 'done' | 'needs-human' | 'failed';

export interface VerifyReport {
  readonly change: string;
  readonly title: string;
  readonly status: VerifyStatus;
  readonly gates: GateResult[];
}

export interface CommandResult {
  readonly name: string;
  readonly command: readonly string[];
  readonly exitCode: number;
}

export interface GateInput {
  readonly workItemFindings?: readonly Finding[];
  readonly proposal: Proposal;
  readonly lock: DomainLock | null;
  readonly diff: readonly DiffItem[];
  readonly checkOk: boolean;
  readonly checkProblems: readonly string[];
  readonly tests: TestRun;
  readonly commands: readonly CommandResult[];
  readonly knownIds: ReadonlySet<string>;
}

const RULE_PREFIXES = [
  'invariant:',
  'method:',
  'usecase:',
  'operator:',
  'valueobject:',
];
const at = (testCase: TestCaseResult): string =>
  `${testCase.file}:${testCase.line}`;
const failure = (testCase: TestCaseResult): Finding => ({
  code:
    testCase.status === 'skipped'
      ? 'verify.test-skipped'
      : 'verify.test-failed',
  message: `test ${testCase.status === 'skipped' ? 'skipped' : 'failed'}: ${testCase.name}`,
  fix: 'fix the code or the test until it passes',
  source: at(testCase),
});
const gate = (
  id: GateId,
  name: string,
  findings: Finding[],
  warnings: Finding[] = [],
): GateResult => ({
  id,
  name,
  status: findings.length > 0 ? 'failed' : 'passed',
  findings,
  warnings,
});

export function evaluateGates(input: GateInput): VerifyReport {
  const { proposal } = input;
  const sortedCases = [...input.tests.cases].sort((a, b) => {
    if (a.file < b.file) return -1;
    if (a.file > b.file) return 1;
    if (a.line < b.line) return -1;
    if (a.line > b.line) return 1;
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
  });
  const covering = (id: string): TestCaseResult[] =>
    sortedCases.filter((c) => c.covers.includes(id));

  const g1: Finding[] = [];
  if (proposal.archived) {
    const recorded = input.lock?.changes.find(
      (change) => change.id === proposal.id,
    );
    if (!recorded) {
      g1.push({
        code: 'verify.proposal-not-in-lock',
        message: `the proposal ${proposal.id} is in archive but not in the lock`,
        fix: 'restore the lock from git',
        source: proposal.path,
      });
    } else if (recorded.hash !== sha256(proposal.raw)) {
      g1.push({
        code: 'verify.proposal-edited',
        message: `the proposal ${proposal.id} was edited after being applied`,
        fix: 'restore it from git; archived proposals are immutable',
        source: proposal.path,
      });
    }
    for (const item of input.diff.filter((i) => i.classification !== 'docs')) {
      g1.push({
        code: 'verify.domain-changed-after-proposal',
        message: `the code has a domain change after the proposal: ${item.kind} ${item.id}`,
        fix: 'open a new proposal for this change',
        source: null,
      });
    }
  } else {
    for (const problem of deltaProblems(proposal, input.diff)) {
      g1.push({
        code: 'verify.delta-mismatch',
        message: problem,
        fix: 'adjust the proposal delta or the code so they match',
        source: proposal.path,
      });
    }
  }

  const g2: Finding[] = input.checkOk
    ? []
    : (input.checkProblems.length > 0
        ? input.checkProblems
        : ['compile --check failed']
      ).map((message) => ({
        code: 'verify.docs-outdated' as const,
        message,
        fix: 'run `bun run agentic compile` and commit the generated files',
        source: null,
      }));

  const g3: Finding[] = [];
  for (const criterion of proposal.acceptance.filter((c) => !c.manual)) {
    const id = `criterion:${proposal.id}/${criterion.id}`;
    const cases = covering(id);
    if (cases.length === 0) {
      g3.push({
        code: 'verify.criterion-untested',
        message: `criterion ${id} has no test`,
        fix: `create a test with covers(['${id}'], ${JSON.stringify(criterion.then)})`,
        source: proposal.path,
      });
    }
    g3.push(...cases.filter((c) => c.status !== 'passed').map(failure));
  }

  const g4: Finding[] = [];
  const g4Warnings: Finding[] = [];
  const rules = [
    ...new Set([...proposal.delta.added, ...proposal.delta.modified]),
  ]
    .filter((id) => RULE_PREFIXES.some((prefix) => id.startsWith(prefix)))
    .sort();
  for (const id of rules) {
    const cases = covering(id);
    if (cases.length === 0)
      g4.push({
        code: 'verify.rule-untested',
        message: `${id} has no test with covers`,
        fix: `create a test with covers(['${id}'], '…')`,
        source: null,
      });
    g4.push(...cases.filter((c) => c.status !== 'passed').map(failure));
    if (proposal.delta.modified.includes(id)) {
      for (const c of cases)
        g4Warnings.push({
          code: 'verify.rule-modified-review',
          message: `review: ${c.name} covers ${id}, which was modified`,
          fix: null,
          source: at(c),
        });
    }
  }
  for (const c of sortedCases) {
    for (const id of c.covers) {
      if (!input.knownIds.has(id))
        g4.push({
          code: 'verify.covers-unknown',
          message: `covers cites ${id}, which does not exist`,
          fix: "fix the ID in the test's covers",
          source: at(c),
        });
    }
  }

  const g5: Finding[] = input.commands
    .filter((c) => c.exitCode !== 0)
    .map((c) => ({
      code: 'verify.command-failed' as const,
      message: `${c.name} exited with ${c.exitCode}`,
      fix: `run ${c.command.join(' ')} and fix it`,
      source: null,
    }));
  if (input.tests.collectionError) {
    g5.push({
      code: 'verify.collection-error',
      message: input.tests.collectionError,
      fix: "restore the suite's JUnit collection",
      source: null,
    });
  }
  if (input.tests.exitCode !== 0) {
    g5.push({
      code: 'verify.suite-failed',
      message: `the test suite exited with ${input.tests.exitCode}`,
      fix: 'run bun test and fix the failures',
      source: null,
    });
  }

  const g6: Finding[] = proposal.acceptance
    .filter((c) => c.manual)
    .map((c) => ({
      code: 'verify.criterion-manual-pending' as const,
      message: `manual criterion pending: criterion:${proposal.id}/${c.id} — ${c.then}`,
      fix: 'ask a person to validate it',
      source: proposal.path,
    }));

  const gates: GateResult[] = [
    gate('G1', 'Delta', g1),
    gate('G2', 'Docs', g2),
    gate('G3', 'Criteria', g3),
    gate('G4', 'Rules', g4, g4Warnings),
    gate('G5', 'Quality', g5),
    {
      id: 'G6',
      name: 'Manual',
      status: g6.length > 0 ? 'pending' : 'passed',
      findings: g6,
      warnings: [],
    },
    gate('G7', 'Work items', [...(input.workItemFindings ?? [])]),
  ];
  const status: VerifyStatus = gates.some((g) => g.status === 'failed')
    ? 'failed'
    : g6.length > 0
      ? 'needs-human'
      : 'done';
  return { change: proposal.id, title: proposal.title, status, gates };
}
