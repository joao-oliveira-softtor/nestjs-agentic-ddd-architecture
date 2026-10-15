import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { InputParts, RequestUsage, Usage } from './contracts';

const price = z.number().finite().nonnegative();
const tierSchema = z.strictObject({
  /** Maior entrada da requisição (inclusive) que paga esta faixa; `null` = sem limite. */
  maxPromptTokens: z.number().int().positive().nullable(),
  input: price,
  cacheWrite5m: price,
  cacheWrite1h: price,
  cacheRead: price,
  output: price,
});
export const pricingSchema = z.strictObject({
  schemaVersion: z.literal(1),
  currency: z.literal('USD'),
  unit: z.literal('per_million_tokens'),
  source: z.url(),
  retrievedAt: z.iso.date(),
  label: z.literal('derived'),
  note: z.string().min(1),
  models: z.record(
    z.string().min(1),
    z.strictObject({
      tiers: z
        .array(tierSchema)
        .min(1)
        // O custo usa só a primeira e a última faixa (resíduo e saída); intermediárias seriam ignoradas.
        .max(2)
        .refine(
          (tiers) =>
            tiers.every((tier, i) =>
              i === tiers.length - 1
                ? tier.maxPromptTokens === null
                : tier.maxPromptTokens !== null &&
                  (i === 0 ||
                    tier.maxPromptTokens > tiers[i - 1]!.maxPromptTokens!),
            ),
          'tiers in ascending maxPromptTokens, only the last unbounded',
        ),
    }),
  ),
});
export type Pricing = z.infer<typeof pricingSchema>;
type Tier = z.infer<typeof tierSchema>;

export const PRICING_PATH = join(import.meta.dir, '../../evals/pricing.json');
export async function loadPricing(path = PRICING_PATH): Promise<Pricing> {
  return pricingSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

/**
 * Custo equivalente de API derivado de `pricing.json` e dos tokens medidos; não é cobrança.
 * `expensive` e `cheap` só diferem quando a faixa não é conhecida: resíduo auxiliar (entrada
 * sem requisição) e saída de um modelo com alguma requisição acima do limiar ficam na faixa
 * mais cara em `expensive` e na mais barata em `cheap`. `lowerBound`: sem `result` (timeout),
 * só a entrada das requisições recebidas entra, sem a saída.
 */
export type DerivedCost =
  | {
      status: 'available';
      expensive: number;
      cheap: number;
      /** Piso absoluto: faixa barata e, sem TTL informado, 5 min. Só descritivo (sensibilidade de TTL). */
      floor: number;
      lowerBound: boolean;
    }
  | { status: 'unavailable'; reason: string };

const MILLION = 1_000_000;
const promptTokens = (parts: InputParts) =>
  parts.uncachedInputTokens +
  parts.cacheWriteInputTokens +
  parts.cacheReadInputTokens;
const tierFor = (tiers: readonly Tier[], size: number) =>
  tiers.find((t) => t.maxPromptTokens === null || size <= t.maxPromptTokens)!;
/**
 * Escrita de cache sem TTL informado (resíduo, `byModel` sem requisições) paga o preço de 1 h
 * em `expensive` e `cheap`, o TTL de toda a escrita observada no smoke de 2026-10-14 e o que o
 * pré-registro adota; só o piso absoluto (`floor`) paga o de 5 min. Assim a incerteza de TTL não
 * se mistura com a de faixa de preço, que é a que a regra I do piloto compara.
 */
const inputCost = (
  tier: Tier,
  parts: InputParts,
  longTtl: number | null = null,
  floor = false,
) => {
  const long = longTtl ?? (floor ? 0 : parts.cacheWriteInputTokens);
  return (
    (parts.uncachedInputTokens * tier.input +
      (parts.cacheWriteInputTokens - long) * tier.cacheWrite5m +
      long * tier.cacheWrite1h +
      parts.cacheReadInputTokens * tier.cacheRead) /
    MILLION
  );
};

/**
 * Definição única de custo indisponível: sem `requests` e sem `byModel`; modelo sem preço;
 * modelo com faixas, sem `requests`, cuja entrada total passe do limiar da primeira faixa; ou
 * requisições somando mais entrada que o `byModel` do modelo (leitura divergente). Nunca
 * estimado.
 */
export function deriveCost(usage: Usage, pricing: Pricing): DerivedCost {
  const { byModel, requests } = usage;
  // Evento sem entrada (ex.: mensagem sintética) não custa nada nem exige preço do seu modelo.
  const items: RequestUsage[] = (requests?.items ?? []).filter(
    (i) => promptTokens(i) > 0,
  );
  if (!byModel && !items.length)
    return { status: 'unavailable', reason: 'no_usage_breakdown' };
  const models = new Set([
    ...Object.keys(byModel ?? {}),
    ...items.map((i) => i.model),
  ]);
  for (const model of models)
    if (!pricing.models[model])
      return { status: 'unavailable', reason: `model_without_price:${model}` };
  let expensive = 0,
    cheap = 0,
    floor = 0;
  for (const item of items) {
    const tiers = pricing.models[item.model]!.tiers;
    const tier = tierFor(tiers, promptTokens(item));
    const request = inputCost(tier, item, item.cacheWrite1hInputTokens);
    expensive += request;
    cheap += request;
    floor += inputCost(tier, item, item.cacheWrite1hInputTokens, true);
  }
  if (!byModel)
    return { status: 'available', expensive, cheap, floor, lowerBound: true };
  // A saída vem do `modelUsage`: requisição de um modelo que ele omite deixaria a saída de fora.
  for (const item of items)
    if (!byModel[item.model])
      return {
        status: 'unavailable',
        reason: `model_not_in_model_usage:${item.model}`,
      };
  for (const [model, measured] of Object.entries(byModel)) {
    const tiers = pricing.models[model]!.tiers;
    const [first, last] = [tiers[0]!, tiers.at(-1)!];
    const threshold = first.maxPromptTokens ?? Infinity;
    // Entrada não coberta por requisições: tudo, sem `requests`; senão, o resíduo.
    const uncovered: InputParts = requests
      ? (requests.residual[model] ?? {
          uncachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          cacheReadInputTokens: 0,
        })
      : measured;
    if (
      uncovered.uncachedInputTokens < 0 ||
      uncovered.cacheWriteInputTokens < 0 ||
      uncovered.cacheReadInputTokens < 0
    )
      return {
        status: 'unavailable',
        reason: `requests_exceed_model_usage:${model}`,
      };
    // Abaixo do limiar no total, nenhuma requisição o ultrapassa: a primeira faixa vale.
    const uncertain = promptTokens(uncovered) > threshold;
    if (uncertain && !requests)
      return {
        status: 'unavailable',
        reason: `tiered_model_without_requests:${model}`,
      };
    expensive += inputCost(uncertain ? last : first, uncovered);
    cheap += inputCost(first, uncovered);
    floor += inputCost(first, uncovered, null, true);
    const crossed = items.some(
      (i) => i.model === model && promptTokens(i) > threshold,
    );
    expensive +=
      (measured.outputTokens * (crossed || uncertain ? last : first).output) /
      MILLION;
    const cheapOutput = (measured.outputTokens * first.output) / MILLION;
    cheap += cheapOutput;
    floor += cheapOutput;
  }
  return {
    status: 'available',
    expensive,
    cheap,
    floor,
    lowerBound: requests?.status === 'unreconciled',
  };
}

/** Soma do custo de lista do CLI (`costUSD`), para a checagem cruzada; `null` se faltar. */
export function reportedCost(usage: Usage): number | null {
  const entries = Object.values(usage.byModel ?? {});
  return entries.length && entries.every((e) => e.reportedCostUSD !== undefined)
    ? entries.reduce((total, e) => total + e.reportedCostUSD!, 0)
    : null;
}
