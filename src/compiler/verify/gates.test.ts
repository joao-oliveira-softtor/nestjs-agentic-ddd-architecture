import { describe, expect, test } from 'bun:test';
import { sha256 } from '../canonical';
import { EMPTY_IR } from '../diff';
import { markApplied, parseProposal } from '../changes/proposal';
import type { DomainLock } from '../lock';
import { evaluateGates, type GateInput } from './gates';
import type { TestCaseResult } from './test-run';

const RAW = markApplied(`---
id: "0002"
title: Cancelamento exige motivo
status: proposed
origin: proposal-first
delta:
  added: ["invariant:Order/cancelamento-exige-motivo"]
  modified: ["usecase:cancel_order"]
  removed: []
acceptance:
  - id: rejeita-sem-motivo
    covers: ["invariant:Order/cancelamento-exige-motivo"]
    given: pedido pendente
    when: cancelar sem motivo
    then: falha com CANCELLATION_REASON_REQUIRED
  - id: revisao-de-copy
    manual: true
    then: mensagem revisada
---

## Motivo

Saber por que cancelaram.
`);

const PATH = 'changes/archive/0002-cancelamento-exige-motivo/proposal.md';
const archived = parseProposal(
  RAW,
  '0002-cancelamento-exige-motivo',
  PATH,
  true,
).proposal!;
const automaticOnly = parseProposal(
  RAW.replace(
    / {2}- id: revisao-de-copy\n {4}manual: true\n {4}then: mensagem revisada\n/,
    '',
  ),
  '0002-cancelamento-exige-motivo',
  PATH,
  true,
).proposal!;

const lock = (raw = RAW): DomainLock => ({
  lockVersion: 1,
  ir: EMPTY_IR,
  changes: [
    {
      id: '0002',
      title: 'x',
      path: PATH,
      summary: 'x',
      hash: sha256(raw),
      items: [],
    },
  ],
});

const testCase = (
  covers: string[],
  status: TestCaseResult['status'] = 'passed',
  line = 1,
): TestCaseResult => ({
  name: `[covers: ${covers.join(', ')}] teste ${line}`,
  file: 'examples/orders/test/order.test.ts',
  line,
  status,
  covers,
});

const goodTests = [
  testCase(
    [
      'criterion:0002/rejeita-sem-motivo',
      'invariant:Order/cancelamento-exige-motivo',
    ],
    'passed',
    10,
  ),
  testCase(['usecase:cancel_order'], 'passed', 20),
];

const knownIds = new Set([
  'invariant:Order/cancelamento-exige-motivo',
  'usecase:cancel_order',
  'criterion:0002/rejeita-sem-motivo',
  'criterion:0002/revisao-de-copy',
]);

function input(overrides: Partial<GateInput> = {}): GateInput {
  return {
    proposal: archived,
    lock: lock(),
    diff: [],
    checkOk: true,
    checkProblems: [],
    tests: { exitCode: 0, cases: goodTests },
    commands: [
      { name: 'typecheck', command: ['bun', 'run', 'typecheck'], exitCode: 0 },
      { name: 'lint', command: ['bun', 'run', 'lint'], exitCode: 0 },
    ],
    knownIds,
    ...overrides,
  };
}

const statusOf = (report: ReturnType<typeof evaluateGates>) =>
  Object.fromEntries(report.gates.map((g) => [g.id, g.status]));

describe('evaluateGates', () => {
  test('everything covered and no manual criterion → done', () => {
    const report = evaluateGates(
      input({ proposal: automaticOnly, lock: lock(automaticOnly.raw) }),
    );
    expect(report.status).toBe('done');
    expect(statusOf(report)).toEqual({
      G1: 'passed',
      G2: 'passed',
      G3: 'passed',
      G4: 'passed',
      G5: 'passed',
      G6: 'passed',
      G7: 'passed',
    });
  });

  test('manual criterion → needs-human and G6 lists it', () => {
    const report = evaluateGates(input());
    expect(report.status).toBe('needs-human');
    const finding = report.gates.find((g) => g.id === 'G6')!.findings[0]!;
    expect(finding.code).toBe('verify.criterion-manual-pending');
    expect(finding.message).toContain('criterion:0002/revisao-de-copy');
  });

  test('criterion without a test → failed with an actionable fix', () => {
    const report = evaluateGates(
      input({
        tests: {
          exitCode: 0,
          cases: [
            testCase(['usecase:cancel_order']),
            testCase(['invariant:Order/cancelamento-exige-motivo']),
          ],
        },
      }),
    );
    expect(report.status).toBe('failed');
    const g3 = report.gates.find((g) => g.id === 'G3')!;
    expect(g3.status).toBe('failed');
    expect(g3.findings).toEqual([
      {
        code: 'verify.criterion-untested',
        message: 'criterion criterion:0002/rejeita-sem-motivo has no test',
        fix: `create a test with covers(['criterion:0002/rejeita-sem-motivo'], "falha com CANCELLATION_REASON_REQUIRED")`,
        source: PATH,
      },
    ]);
  });

  test('failing criterion test shows up with file:line', () => {
    const cases = [
      testCase(
        [
          'criterion:0002/rejeita-sem-motivo',
          'invariant:Order/cancelamento-exige-motivo',
        ],
        'failed',
        42,
      ),
      goodTests[1]!,
    ];
    const g3 = evaluateGates(
      input({ tests: { exitCode: 1, cases } }),
    ).gates.find((g) => g.id === 'G3')!;
    expect(g3.findings[0]).toMatchObject({
      code: 'verify.test-failed',
      source: 'examples/orders/test/order.test.ts:42',
    });
  });

  test('G4: untested rule, modified rule becomes a warning and covers with an unknown ID fails', () => {
    const cases = [
      goodTests[0]!,
      testCase(['usecase:cancel_ordr'], 'passed', 7),
    ];
    const g4 = evaluateGates(
      input({ tests: { exitCode: 0, cases } }),
    ).gates.find((g) => g.id === 'G4')!;
    expect(g4.status).toBe('failed');
    expect(g4.findings.map((f) => f.code)).toEqual([
      'verify.rule-untested',
      'verify.covers-unknown',
    ]);
    expect(g4.findings[0]!.message).toContain('usecase:cancel_order');
    expect(g4.findings[1]!.message).toContain('usecase:cancel_ordr');
    expect(g4.findings[1]!.source).toBe('examples/orders/test/order.test.ts:7');

    const ok = evaluateGates(input()).gates.find((g) => g.id === 'G4')!;
    expect(ok.status).toBe('passed');
    expect(ok.warnings.map((w) => w.code)).toEqual([
      'verify.rule-modified-review',
    ]);
    expect(ok.warnings[0]!.message).toContain('usecase:cancel_order');
  });

  test('G4: new value object in the delta requires covers; covers of an existing VO is not unknown', () => {
    const delta = {
      added: ['valueobject:Dinheiro'],
      modified: [],
      removed: [],
    };
    const proposal = { ...automaticOnly, delta };
    const g4 = evaluateGates(input({ proposal })).gates.find(
      (g) => g.id === 'G4',
    )!;
    expect(g4.findings.map((f) => f.code)).toEqual(['verify.rule-untested']);
    expect(g4.findings[0]!.message).toContain('valueobject:Dinheiro');

    const cases = [
      ...goodTests,
      testCase(['valueobject:Dinheiro'], 'passed', 9),
    ];
    const ok = evaluateGates(
      input({
        proposal,
        tests: { exitCode: 0, cases },
        knownIds: new Set([...knownIds, 'valueobject:Dinheiro']),
      }),
    ).gates.find((g) => g.id === 'G4')!;
    expect(ok.status).toBe('passed');
  });

  test('G1: archived proposal edited or with a domain change after it', () => {
    const edited = evaluateGates(
      input({ lock: lock('outro conteúdo') }),
    ).gates.find((g) => g.id === 'G1')!;
    expect(edited.findings[0]!.code).toBe('proposal.applied-edited');
    const later = evaluateGates(
      input({
        diff: [
          {
            id: 'method:Order.confirm',
            kind: 'modified',
            classification: 'behavioral',
            module: 'orders',
          },
        ],
      }),
    ).gates.find((g) => g.id === 'G1')!;
    expect(later.findings[0]!.code).toBe(
      'verify.domain-changed-after-proposal',
    );
    expect(later.findings[0]!.message).toContain('method:Order.confirm');
  });

  test('G1: open proposal compares delta and diff', () => {
    const open = parseProposal(
      RAW.replace('status: applied', 'status: proposed'),
      '0002-cancelamento-exige-motivo',
      PATH.replace('archive/', ''),
      false,
    ).proposal!;
    const g1 = evaluateGates(
      input({ proposal: open, lock: null, diff: [] }),
    ).gates.find((g) => g.id === 'G1')!;
    expect(g1.findings.map((f) => f.code)).toEqual([
      'proposal.delta-mismatch',
      'proposal.delta-mismatch',
    ]);
    expect(g1.findings[0]!.message).toContain(
      'added invariant:Order/cancelamento-exige-motivo',
    );
    expect(g1.findings[1]!.message).toContain('modified usecase:cancel_order');
  });

  test('G2 and G5: dirty check, failing command and failing suite', () => {
    const report = evaluateGates(
      input({
        checkOk: false,
        checkProblems: [
          { code: 'write.outdated', message: 'outdated (changed): AGENTS.md' },
        ],
        commands: [
          { name: 'lint', command: ['bun', 'run', 'lint'], exitCode: 1 },
        ],
        tests: { exitCode: 1, cases: goodTests },
      }),
    );
    expect(report.status).toBe('failed');
    expect(report.gates.find((g) => g.id === 'G2')!.findings[0]).toEqual({
      code: 'write.outdated',
      message: 'outdated (changed): AGENTS.md',
      fix: 'run `bun run agentic compile` and commit the generated files',
      source: null,
    });
    expect(
      report.gates.find((g) => g.id === 'G5')!.findings.map((f) => f.code),
    ).toEqual(['verify.command-failed', 'verify.suite-failed']);
  });

  test('G4: findings of tests with unknown covers come out in stable order (file, line, name)', () => {
    const cases = [
      {
        name: '[covers: unknown:b] test b',
        file: 'b.test.ts',
        line: 1,
        status: 'passed' as const,
        covers: ['unknown:b'],
      },
      {
        name: '[covers: unknown:a] test a',
        file: 'a.test.ts',
        line: 9,
        status: 'passed' as const,
        covers: ['unknown:a'],
      },
    ];
    const g4 = evaluateGates(
      input({ tests: { exitCode: 0, cases } }),
    ).gates.find((g) => g.id === 'G4')!;
    const sourceFindings = g4.findings.filter((f) => f.source !== null);
    expect(sourceFindings.map((f) => f.source)).toEqual([
      'a.test.ts:9',
      'b.test.ts:1',
    ]);
  });

  test('done report has a stable shape (snapshot)', () => {
    const report = evaluateGates(
      input({ proposal: automaticOnly, lock: lock(automaticOnly.raw) }),
    );
    expect(JSON.stringify(report, null, 2)).toMatchSnapshot();
  });

  test('failed report has a stable shape (snapshot)', () => {
    const report = evaluateGates(
      input({
        tests: {
          exitCode: 0,
          cases: [
            testCase(['usecase:cancel_order']),
            testCase(['invariant:Order/cancelamento-exige-motivo']),
          ],
        },
      }),
    );
    expect(JSON.stringify(report, null, 2)).toMatchSnapshot();
  });
});

test('G7 fails one finding per ADDED/MODIFIED owner and keeps needs-human when done', () => {
  const pending = evaluateGates(
    input({
      workItemFindings: [
        {
          code: 'verify.item-not-done',
          message: 'method:Order.cancel is blocked(declared)',
          source: 'examples/orders/domain/order.ts:1',
          fix: 'bun run agentic packet method:Order.cancel',
        },
      ],
    }),
  );
  expect(pending.status).toBe('failed');
  expect(pending.gates.find((g) => g.id === 'G7')!.findings).toHaveLength(1);
  const done = evaluateGates(input({ workItemFindings: [] }));
  expect(done.status).toBe('needs-human');
  expect(done.gates.find((g) => g.id === 'G7')!.status).toBe('passed');
});
