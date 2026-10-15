import { expect, test } from 'bun:test';
import { classifyPilot, pilotArm, type PilotArm } from '../scripts/evals/pilot';
import type { CampaignReport } from '../scripts/evals/aggregate';

// Braço com custo total `cost` (as duas faixas iguais, salvo `cheap`) e `accepted` itens aceitos.
const arm = (
  accepted: number,
  cost: number | null,
  patch: Partial<PilotArm> & { cheap?: number; lowerBound?: boolean } = {},
): PilotArm => ({
  accepted,
  cost:
    cost === null
      ? null
      : {
          expensive: cost,
          cheap: patch.cheap ?? cost,
          lowerBound: patch.lowerBound ?? false,
        },
  inconclusive: patch.inconclusive ?? false,
});
const classify = (a0: PilotArm, a1: PilotArm, a3: PilotArm) =>
  classifyPilot({ a0, a1, a3 });

test('P: o A3 aceita ao menos tanto e custa menos que os dois controles', () => {
  expect(classify(arm(8, 80), arm(8, 90), arm(9, 60))).toMatchObject({
    classification: 'P',
    reason: 'rule',
  });
  // Empate de aceite entra em "ao menos"; empate de custo não é "menos".
  expect(classify(arm(8, 80), arm(8, 90), arm(8, 60)).classification).toBe('P');
  expect(classify(arm(8, 80), arm(8, 90), arm(8, 80)).classification).toBe('M');
});

test('S: um controle aceita ao menos tanto e custa menos que o A3', () => {
  expect(classify(arm(8, 50), arm(7, 40), arm(8, 60)).classification).toBe('S');
  // Aceite do controle menor que o do A3 não é S.
  expect(classify(arm(7, 50), arm(7, 40), arm(8, 60)).classification).toBe('M');
  // Empate de custo não é "menos".
  expect(classify(arm(8, 60), arm(7, 70), arm(8, 60)).classification).toBe('M');
});

test('M: qualquer outro caso', () => {
  // O A3 aceita mais, mas custa mais que um controle.
  expect(classify(arm(7, 40), arm(7, 90), arm(9, 60)).classification).toBe('M');
  // O A3 custa menos, mas aceita menos que um controle (e o controle é mais caro).
  expect(classify(arm(9, 90), arm(7, 80), arm(8, 60)).classification).toBe('M');
});

test('aceite 0 vira custo infinito', () => {
  // A3 sem aceite: um controle com aceite 0 também tem custo +∞, então não simplifica.
  expect(classify(arm(0, 50), arm(0, 40), arm(0, 60)).classification).toBe('M');
  // A3 sem aceite e controle com aceite: S, mesmo com o custo total do A3 menor.
  expect(classify(arm(3, 90), arm(0, 10), arm(0, 5)).classification).toBe('S');
  // Controle sem aceite e A3 com aceite: P.
  expect(classify(arm(0, 10), arm(0, 10), arm(2, 99)).classification).toBe('P');
});

test('I: execução inconclusiva em A0, A1 ou A3, inclusive slot not_run', () => {
  for (const [a0, a1, a3] of [
    [arm(8, 80, { inconclusive: true }), arm(8, 90), arm(9, 60)],
    [arm(8, 80), arm(8, 90, { inconclusive: true }), arm(9, 60)],
    [arm(8, 80), arm(8, 90), arm(9, 60, { inconclusive: true })],
  ] as const)
    expect(classify(a0, a1, a3)).toMatchObject({
      classification: 'I',
      reason: 'inconclusive_run',
    });
});

test('I: custo indisponível prevalece sobre o aceite 0', () => {
  expect(classify(arm(0, null), arm(8, 90), arm(9, 60))).toMatchObject({
    classification: 'I',
    reason: 'cost_unavailable',
  });
  expect(classify(arm(8, 80), arm(8, 90), arm(0, null)).classification).toBe(
    'I',
  );
});

test('I: o resíduo auxiliar pela faixa cara e pela barata muda a classificação', () => {
  // Faixa cara: o A3 custa 100 e perde para o controle (S); faixa barata: custa 30 e ganha (P).
  const result = classify(arm(8, 80), arm(8, 90), arm(8, 100, { cheap: 30 }));
  expect(result).toMatchObject({
    classification: 'I',
    reason: 'band_sensitivity',
    bands: { expensive: 'S', cheap: 'P' },
  });
  // Mesma classificação nas duas faixas: vale a regra.
  expect(
    classify(arm(8, 80), arm(8, 90), arm(9, 60, { cheap: 50 })),
  ).toMatchObject({ classification: 'P', reason: 'rule' });
});

test('lowerBound: no controle bloqueia S, no A3 bloqueia P', () => {
  // O controle seria mais barato, mas o custo dele é só um limite inferior: não prova S.
  expect(
    classify(arm(8, 40, { lowerBound: true }), arm(7, 90), arm(8, 60))
      .classification,
  ).toBe('M');
  // O controle com lowerBound ainda vale quando o A3 tem custo +∞ (aceite 0).
  expect(
    classify(arm(3, 40, { lowerBound: true }), arm(0, 90), arm(0, 60))
      .classification,
  ).toBe('S');
  // O A3 seria P, mas o custo dele é só um limite inferior.
  expect(
    classify(arm(8, 80), arm(8, 90), arm(9, 60, { lowerBound: true }))
      .classification,
  ).toBe('M');
  // lowerBound nos controles não impede P: o custo real deles só é maior.
  expect(
    classify(
      arm(8, 80, { lowerBound: true }),
      arm(8, 90, { lowerBound: true }),
      arm(9, 60),
    ).classification,
  ).toBe('P');
});

// Configuração mínima do agregado para a extração do braço.
const configuration = (patch: Record<string, unknown> = {}) =>
  ({
    configuration: 'a3-routed',
    executedRuns: 2,
    plannedRuns: 2,
    final: { numerator: 7 },
    cost: {
      available: true,
      lowerBound: false,
      total: { expensive: 10, cheap: 8, lowerBound: false },
    },
    runMetrics: [1, 2].map(() => ({
      status: 'completed',
      finalItems: 3,
      items: [{ state: 'accepted' }, { state: 'failed' }],
      review: { dispatched: true, transport: 'finished' },
    })),
    ...patch,
  }) as unknown as CampaignReport['configurations'][number];

test('pilotArm: aceite e custo vêm de configurations, slot ausente é inconclusivo', () => {
  expect(pilotArm(configuration())).toEqual({
    accepted: 7,
    cost: { expensive: 10, cheap: 8, lowerBound: false },
    inconclusive: false,
  });
  expect(pilotArm(configuration({ executedRuns: 1 })).inconclusive).toBe(true);
  expect(
    pilotArm(
      configuration({
        cost: { available: false, lowerBound: false, total: null },
      }),
    ).cost,
  ).toBeNull();
});

test('pilotArm: relatório que não terminou completed ou item em infra_error é inconclusivo', () => {
  const run = (patch: Record<string, unknown>) => ({
    status: 'completed',
    finalItems: 0,
    items: [{ state: 'failed' }],
    review: null,
    ...patch,
  });
  for (const patch of [
    { status: 'budget_exhausted' },
    { status: 'infra_error' },
    { items: [{ state: 'infra_error' }] },
    { items: [{ state: 'not_run' }] },
  ])
    expect(
      pilotArm(configuration({ runMetrics: [run(patch)] })).inconclusive,
    ).toBe(true);
  // Item que falhou normalmente não torna a execução inconclusiva.
  expect(pilotArm(configuration({ runMetrics: [run({})] })).inconclusive).toBe(
    false,
  );
});

test('pilotArm: a revisão do A3 só vale despachada e terminada, e sem item aceito not_run é esperado', () => {
  const run = (patch: Record<string, unknown>) => ({
    status: 'completed',
    finalItems: 2,
    items: [{ state: 'accepted' }, { state: 'accepted' }],
    review: { dispatched: true, transport: 'finished' },
    ...patch,
  });
  const inconclusive = (r: ReturnType<typeof run>) =>
    pilotArm(configuration({ runMetrics: [r] }), { requiresReview: true })
      .inconclusive;
  expect(inconclusive(run({}))).toBe(false);
  expect(inconclusive(run({ review: null }))).toBe(true);
  expect(
    inconclusive(run({ review: { dispatched: false, transport: null } })),
  ).toBe(true);
  expect(
    inconclusive(run({ review: { dispatched: true, transport: 'timeout' } })),
  ).toBe(true);
  // Sem item aceito, a revisão não rodar é o esperado.
  expect(inconclusive(run({ finalItems: 0, review: null }))).toBe(false);
  // Nos controles a revisão não é exigida.
  expect(
    pilotArm(configuration({ runMetrics: [run({ review: null })] }))
      .inconclusive,
  ).toBe(false);
});
