import { sha256 } from '../canonical';
import type { Proposal } from '../changes/proposal';
import { deltaProblems } from '../changes/reconcile';
import type { DiffItem } from '../diff';
import type { DomainLock } from '../lock';
import type { TestCaseResult, TestRun } from './test-run';

export type GateId = 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6';
export type GateStatus = 'passed' | 'failed' | 'pending';

export interface Finding {
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
  readonly proposal: Proposal;
  readonly lock: DomainLock | null;
  readonly diff: readonly DiffItem[];
  readonly checkOk: boolean;
  readonly checkProblems: readonly string[];
  readonly tests: TestRun;
  readonly commands: readonly CommandResult[];
  readonly knownIds: ReadonlySet<string>;
}

const RULE_PREFIXES = ['invariant:', 'method:', 'usecase:', 'operator:'];
const at = (testCase: TestCaseResult): string =>
  `${testCase.file}:${testCase.line}`;
const failure = (testCase: TestCaseResult): Finding => ({
  message: `teste ${testCase.status === 'skipped' ? 'pulado' : 'falhou'}: ${testCase.name}`,
  fix: 'corrija o código ou o teste até ele passar',
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
  const covering = (id: string): TestCaseResult[] =>
    input.tests.cases.filter((c) => c.covers.includes(id));

  const g1: Finding[] = [];
  if (proposal.archived) {
    const recorded = input.lock?.changes.find(
      (change) => change.id === proposal.id,
    );
    if (!recorded) {
      g1.push({
        message: `a proposta ${proposal.id} está em archive mas não está no lock`,
        fix: 'restaure o lock pelo git',
        source: proposal.path,
      });
    } else if (recorded.hash !== sha256(proposal.raw)) {
      g1.push({
        message: `a proposta ${proposal.id} foi editada depois de aplicada`,
        fix: 'restaure-a pelo git; propostas arquivadas são imutáveis',
        source: proposal.path,
      });
    }
    for (const item of input.diff.filter((i) => i.classification !== 'docs')) {
      g1.push({
        message: `o código tem mudança de domínio depois da proposta: ${item.kind} ${item.id}`,
        fix: 'abra uma nova proposta para essa mudança',
        source: null,
      });
    }
  } else {
    for (const problem of deltaProblems(proposal, input.diff)) {
      g1.push({
        message: problem,
        fix: 'ajuste o delta da proposta ou o código para que coincidam',
        source: proposal.path,
      });
    }
  }

  const g2: Finding[] = input.checkOk
    ? []
    : (input.checkProblems.length > 0
        ? input.checkProblems
        : ['compile --check falhou']
      ).map((message) => ({
        message,
        fix: 'rode `bun run agentic compile` e commite os arquivos gerados',
        source: null,
      }));

  const g3: Finding[] = [];
  for (const criterion of proposal.acceptance.filter((c) => !c.manual)) {
    const id = `criterion:${proposal.id}/${criterion.id}`;
    const cases = covering(id);
    if (cases.length === 0) {
      g3.push({
        message: `critério ${id} sem teste`,
        fix: `crie um teste com covers(['${id}'], ${JSON.stringify(criterion.then)})`,
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
        message: `${id} não tem teste com covers`,
        fix: `crie um teste com covers(['${id}'], '…')`,
        source: null,
      });
    g4.push(...cases.filter((c) => c.status !== 'passed').map(failure));
    if (proposal.delta.modified.includes(id)) {
      for (const c of cases)
        g4Warnings.push({
          message: `revisar: ${c.name} cobre ${id}, que foi modificado`,
          fix: null,
          source: at(c),
        });
    }
  }
  for (const c of input.tests.cases) {
    for (const id of c.covers) {
      if (!input.knownIds.has(id))
        g4.push({
          message: `covers cita ${id}, que não existe`,
          fix: 'corrija o ID no covers do teste',
          source: at(c),
        });
    }
  }

  const g5: Finding[] = input.commands
    .filter((c) => c.exitCode !== 0)
    .map((c) => ({
      message: `${c.name} saiu com ${c.exitCode}`,
      fix: `rode ${c.command.join(' ')} e corrija`,
      source: null,
    }));
  if (input.tests.exitCode !== 0) {
    g5.push({
      message: `a suíte de testes saiu com ${input.tests.exitCode}`,
      fix: 'rode bun test e corrija as falhas',
      source: null,
    });
  }

  const g6: Finding[] = proposal.acceptance
    .filter((c) => c.manual)
    .map((c) => ({
      message: `critério manual pendente: criterion:${proposal.id}/${c.id} — ${c.then}`,
      fix: 'peça a validação de uma pessoa',
      source: proposal.path,
    }));

  const gates: GateResult[] = [
    gate('G1', 'Delta', g1),
    gate('G2', 'Docs', g2),
    gate('G3', 'Critérios', g3),
    gate('G4', 'Regras', g4, g4Warnings),
    gate('G5', 'Qualidade', g5),
    {
      id: 'G6',
      name: 'Manual',
      status: g6.length > 0 ? 'pending' : 'passed',
      findings: g6,
      warnings: [],
    },
  ];
  const status: VerifyStatus = gates.some((g) => g.status === 'failed')
    ? 'failed'
    : g6.length > 0
      ? 'needs-human'
      : 'done';
  return { change: proposal.id, title: proposal.title, status, gates };
}
