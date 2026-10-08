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
  test('tudo coberto e sem critério manual → done', () => {
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

  test('com critério manual → needs-human e G6 lista o critério', () => {
    const report = evaluateGates(input());
    expect(report.status).toBe('needs-human');
    expect(report.gates.find((g) => g.id === 'G6')!.findings[0]!.message).toBe(
      'critério manual pendente: criterion:0002/revisao-de-copy — mensagem revisada',
    );
  });

  test('critério sem teste → failed com instrução acionável', () => {
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
        message: 'critério criterion:0002/rejeita-sem-motivo sem teste',
        fix: `crie um teste com covers(['criterion:0002/rejeita-sem-motivo'], "falha com CANCELLATION_REASON_REQUIRED")`,
        source: PATH,
      },
    ]);
  });

  test('teste do critério falhando aparece com arquivo:linha', () => {
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
      message: expect.stringContaining('teste falhou: '),
      source: 'examples/orders/test/order.test.ts:42',
    });
  });

  test('G4: regra sem teste, regra modificada vira aviso e covers com ID desconhecido falha', () => {
    const cases = [
      goodTests[0]!,
      testCase(['usecase:cancel_ordr'], 'passed', 7),
    ];
    const g4 = evaluateGates(
      input({ tests: { exitCode: 0, cases } }),
    ).gates.find((g) => g.id === 'G4')!;
    expect(g4.status).toBe('failed');
    expect(g4.findings.map((f) => f.message)).toEqual([
      'usecase:cancel_order não tem teste com covers',
      'covers cita usecase:cancel_ordr, que não existe',
    ]);
    expect(g4.findings[1]!.source).toBe('examples/orders/test/order.test.ts:7');

    const ok = evaluateGates(input()).gates.find((g) => g.id === 'G4')!;
    expect(ok.status).toBe('passed');
    expect(ok.warnings.map((w) => w.message)).toEqual([
      'revisar: [covers: usecase:cancel_order] teste 20 cobre usecase:cancel_order, que foi modificado',
    ]);
  });

  test('G1: proposta arquivada editada ou com mudança de domínio depois dela', () => {
    const edited = evaluateGates(
      input({ lock: lock('outro conteúdo') }),
    ).gates.find((g) => g.id === 'G1')!;
    expect(edited.findings[0]!.message).toBe(
      'a proposta 0002 foi editada depois de aplicada',
    );
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
    expect(later.findings[0]!.message).toBe(
      'o código tem mudança de domínio depois da proposta: modified method:Order.confirm',
    );
  });

  test('G1: proposta aberta compara delta e diff', () => {
    const open = parseProposal(
      RAW.replace('status: applied', 'status: proposed'),
      '0002-cancelamento-exige-motivo',
      PATH.replace('archive/', ''),
      false,
    ).proposal!;
    const g1 = evaluateGates(
      input({ proposal: open, lock: null, diff: [] }),
    ).gates.find((g) => g.id === 'G1')!;
    expect(g1.findings.map((f) => f.message)).toEqual([
      'ID no delta sem mudança correspondente no código: added invariant:Order/cancelamento-exige-motivo',
      'ID no delta sem mudança correspondente no código: modified usecase:cancel_order',
    ]);
  });

  test('G2 e G5: check sujo, comando e suíte falhando', () => {
    const report = evaluateGates(
      input({
        checkOk: false,
        checkProblems: ['desatualizado (changed): AGENTS.md'],
        commands: [
          { name: 'lint', command: ['bun', 'run', 'lint'], exitCode: 1 },
        ],
        tests: { exitCode: 1, cases: goodTests },
      }),
    );
    expect(report.status).toBe('failed');
    expect(report.gates.find((g) => g.id === 'G2')!.findings[0]).toEqual({
      message: 'desatualizado (changed): AGENTS.md',
      fix: 'rode `bun run agentic compile` e commite os arquivos gerados',
      source: null,
    });
    expect(
      report.gates.find((g) => g.id === 'G5')!.findings.map((f) => f.message),
    ).toEqual(['lint saiu com 1', 'a suíte de testes saiu com 1']);
  });

  test('G4: findings de testes com covers desconhecido saem em ordem estável (arquivo, linha, nome)', () => {
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
});

test('G7 reprova um finding por proprietário de ADDED/MODIFIED, preserva needs-human quando done', () => {
  const pending = evaluateGates(
    input({
      workItemFindings: [
        {
          message: 'method:Order.cancel está blocked(declared)',
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
