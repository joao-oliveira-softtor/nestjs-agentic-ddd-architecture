import type { CampaignReport } from './aggregate';

/**
 * Regra de leitura do piloto cycle-21 (`evals/campaigns/cycle-21-pilot/PREREGISTRATION.md`).
 * Função pura: o piloto produz uma recomendação, a decisão é do usuário.
 *
 * - I: inconclusivo (execução inconclusiva, custo indisponível ou classificação que muda com a
 *   faixa de preço do resíduo auxiliar);
 * - S: simplificar (um controle aceita ao menos tanto e custa menos que o A3);
 * - P: prosseguir (o A3 aceita ao menos tanto e custa menos que os dois controles);
 * - M: misto (qualquer outro caso).
 */
export type PilotClass = 'I' | 'S' | 'P' | 'M';
export type PilotReason =
  'inconclusive_run' | 'cost_unavailable' | 'band_sensitivity' | 'rule';
type Band = 'expensive' | 'cheap';

export interface PilotArm {
  /** `configurations[].final.numerator` do agregado, já somado nas repetições. */
  accepted: number;
  /** Custo derivado total das repetições (o A3 inclui a revisão); `null` = indisponível. */
  cost: { expensive: number; cheap: number; lowerBound: boolean } | null;
  /** Alguma execução inconclusiva depois da política de refazimento (inclui slot `not_run`). */
  inconclusive: boolean;
}
export interface PilotInput {
  a0: PilotArm;
  a1: PilotArm;
  a3: PilotArm;
}
export interface PilotResult {
  classification: PilotClass;
  reason: PilotReason;
  /** Classificação em cada faixa de preço do resíduo auxiliar, para o PR-4 descrever. */
  bands: Record<Band, PilotClass>;
}

/** Custo por item aceito (agrupado); aceite 0 vira custo infinito. */
const unitCost = (arm: PilotArm, band: Band) =>
  arm.accepted === 0 ? Infinity : arm.cost![band] / arm.accepted;

function classifyBand({ a0, a1, a3 }: PilotInput, band: Band): PilotClass {
  const controls = [a0, a1];
  const cost3 = unitCost(a3, band);
  const simplify = controls.some(
    (x) =>
      x.accepted >= a3.accepted &&
      unitCost(x, band) < cost3 &&
      (!x.cost!.lowerBound || cost3 === Infinity),
  );
  if (simplify) return 'S';
  const proceed =
    !a3.cost!.lowerBound &&
    controls.every(
      (x) => a3.accepted >= x.accepted && cost3 < unitCost(x, band),
    );
  return proceed ? 'P' : 'M';
}

export function classifyPilot(input: PilotInput): PilotResult {
  const arms = [input.a0, input.a1, input.a3];
  const bands = { expensive: 'I', cheap: 'I' } as Record<Band, PilotClass>;
  if (arms.some((arm) => arm.inconclusive))
    return { classification: 'I', reason: 'inconclusive_run', bands };
  // O custo indisponível prevalece sobre a regra do aceite 0.
  if (arms.some((arm) => arm.cost === null))
    return { classification: 'I', reason: 'cost_unavailable', bands };
  bands.expensive = classifyBand(input, 'expensive');
  bands.cheap = classifyBand(input, 'cheap');
  return bands.expensive === bands.cheap
    ? { classification: bands.expensive, reason: 'rule', bands }
    : { classification: 'I', reason: 'band_sensitivity', bands };
}

type Configuration = CampaignReport['configurations'][number];
type Run = Configuration['runMetrics'][number];

/** Execução inconclusiva: item sem resultado de infraestrutura ou de orçamento, ou relatório incompleto. */
function inconclusiveRun(run: Run, requiresReview: boolean): boolean {
  if (run.status !== 'completed') return true;
  if (run.items.some((i) => i.state === 'infra_error' || i.state === 'not_run'))
    return true;
  // Com ao menos um item aceito, o A3 só vale com a revisão despachada e terminada.
  if (requiresReview && run.finalItems > 0)
    return !(
      run.review?.dispatched === true && run.review.transport === 'finished'
    );
  return false;
}

/** Extrai a evidência de um braço de `configurations` (nunca de `groups`). */
export function pilotArm(
  configuration: Configuration,
  options: { requiresReview?: boolean } = {},
): PilotArm {
  const total = configuration.cost.available ? configuration.cost.total : null;
  return {
    accepted: configuration.final.numerator,
    cost: total
      ? {
          expensive: total.expensive,
          cheap: total.cheap,
          lowerBound: configuration.cost.lowerBound,
        }
      : null,
    inconclusive:
      configuration.executedRuns < configuration.plannedRuns ||
      configuration.runMetrics.some((run) =>
        inconclusiveRun(run, options.requiresReview === true),
      ),
  };
}

/** Os ids de configuração do piloto (um por braço). */
export const PILOT_ARMS = {
  a0: 'a0-sonnet-medium',
  a1: 'a1-sonnet-low',
  a2: 'a2-opus-low',
  a3: 'a3-routed',
} as const;

/** Classifica o agregado do piloto; braço ausente do agregado torna o resultado inconclusivo. */
export function classifyPilotReport(report: CampaignReport): PilotResult {
  const arm = (id: string, requiresReview = false): PilotArm => {
    const configuration = report.configurations.find(
      (c) => c.configuration === id,
    );
    return configuration
      ? pilotArm(configuration, { requiresReview })
      : { accepted: 0, cost: null, inconclusive: true };
  };
  return classifyPilot({
    a0: arm(PILOT_ARMS.a0),
    a1: arm(PILOT_ARMS.a1),
    a3: arm(PILOT_ARMS.a3, true),
  });
}
