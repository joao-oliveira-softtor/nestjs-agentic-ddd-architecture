import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { match } from 'ts-pattern';
import { parseClaudeTranscript } from '../scripts/evals/adapters/claude';
import {
  emptyUsage,
  type RequestUsage,
  type Usage,
} from '../scripts/evals/contracts';
import {
  type DerivedCost,
  deriveCost,
  loadPricing,
  pricingSchema,
  reportedCost,
} from '../scripts/evals/pricing';

const pricing = await loadPricing();
const priced = (cost: DerivedCost) =>
  match(cost)
    .with({ status: 'available' }, (c) => c)
    .with({ status: 'unavailable' }, (c) => {
      throw Error(c.reason);
    })
    .exhaustive();
const derive = (u: Usage) => priced(deriveCost(u, pricing));
const reasonOf = (u: Usage) =>
  match(deriveCost(u, pricing))
    .with({ status: 'unavailable' }, (c) => c.reason)
    .with({ status: 'available' }, () => null)
    .exhaustive();
const HAIKU = 'claude-haiku-5-5';
const SONNET = 'claude-sonnet-5-5';
const request = (
  model: string,
  read: number,
  patch: Partial<RequestUsage> = {},
): RequestUsage => ({
  model,
  uncachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  cacheReadInputTokens: read,
  cacheWrite1hInputTokens: 0,
  ...patch,
});
const usage = (patch: Partial<Usage>): Usage => ({ ...emptyUsage(), ...patch });
const model = (read: number, output: number) => ({
  uncachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  cacheReadInputTokens: read,
  outputTokens: output,
});
const zero = {
  uncachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  cacheReadInputTokens: 0,
};

test('pricing.json versionado é válido e cita a fonte oficial', async () => {
  expect(pricing.source).toBe(
    'https://platform.claude.com/docs/en/about-claude/pricing',
  );
  expect(pricing.models[HAIKU]!.tiers.map((t) => t.maxPromptTokens)).toEqual([
    100000,
    null,
  ]);
  const broken = structuredClone(pricing);
  broken.models[HAIKU]!.tiers.reverse();
  expect(pricingSchema.safeParse(broken).success).toBe(false);
});

test('custo do smoke real: derivado bate com o costUSD de lista do CLI', async () => {
  const stdout = await Bun.file(
    join(
      import.meta.dir,
      'fixtures/evals/transcripts/claude-haiku-requests.ndjson',
    ),
  ).text();
  const parsed = parseClaudeTranscript({
    transport: 'finished',
    exitCode: 0,
    signal: null,
    stdout,
    stderr: '',
    durationMs: 1,
    evidence: [],
    diagnostic: null,
  });
  const cost = derive(parsed.usage);
  expect(cost).toMatchObject({ status: 'available', lowerBound: false });
  expect(cost.expensive).toBeCloseTo(0.0131208, 9);
  expect(cost.cheap).toBeCloseTo(0.0131208, 9);
  expect(reportedCost(parsed.usage)).toBeCloseTo(cost.expensive, 9);
});

test('faixa por requisição: plana, cruzou o limiar (saída na cara, barata como sensibilidade)', () => {
  const flat = derive(
    usage({
      byModel: { [HAIKU]: model(150_000, 1_000_000) },
      requests: {
        status: 'reconciled',
        items: [request(HAIKU, 100_000), request(HAIKU, 50_000)],
        residual: {},
      },
    }),
  );
  // Leitura 0,01/MTok na faixa ≤100k (inclusive) e saída 0,50/MTok.
  expect(flat.expensive).toBeCloseTo(0.0015 + 0.5, 12);
  expect(flat.cheap).toBeCloseTo(0.0015 + 0.5, 12);
  const crossed = derive(
    usage({
      byModel: { [HAIKU]: model(150_001, 1_000_000) },
      requests: {
        status: 'reconciled',
        items: [request(HAIKU, 100_001), request(HAIKU, 50_000)],
        residual: {},
      },
    }),
  );
  // A requisição acima do limiar paga tudo a 0,05/MTok; a saída vai para 2,50 ou 0,50.
  expect(crossed.expensive).toBeCloseTo(100_001 * 0.05e-6 + 0.0005 + 2.5, 12);
  expect(crossed.cheap).toBeCloseTo(100_001 * 0.05e-6 + 0.0005 + 0.5, 12);
});

test('escrita de cache: TTL por requisição; sem TTL informado paga 1 h', () => {
  const cost = (cacheWrite1hInputTokens: number | null) => {
    const derived = derive(
      usage({
        requests: {
          status: 'unreconciled',
          items: [
            request(SONNET, 0, {
              cacheWriteInputTokens: 1_000_000,
              cacheWrite1hInputTokens,
            }),
          ],
          residual: {},
        },
      }),
    );
    return derived.expensive;
  };
  expect(cost(0)).toBeCloseTo(2.5, 12);
  expect(cost(1_000_000)).toBeCloseTo(4, 12);
  expect(cost(null)).toBeCloseTo(4, 12);
});

test('resíduo auxiliar sem requisição: faixa cara e barata quando pode ter cruzado; atalho abaixo do limiar', () => {
  const residual = (read: number) =>
    derive(
      usage({
        byModel: { [SONNET]: model(10, 0), [HAIKU]: model(read, 0) },
        requests: {
          status: 'residual',
          items: [request(SONNET, 10)],
          residual: { [HAIKU]: { ...zero, cacheReadInputTokens: read } },
        },
      }),
    );
  const small = residual(100_000);
  expect(small.expensive).toBeCloseTo(small.cheap, 12);
  const large = residual(200_000);
  expect(large.expensive).toBeCloseTo(10 * 0.1e-6 + 200_000 * 0.05e-6, 12);
  expect(large.cheap).toBeCloseTo(10 * 0.1e-6 + 200_000 * 0.01e-6, 12);
});

test('timeout: só a entrada das requisições recebidas, sem saída, como limite inferior', () => {
  const cost = derive(
    usage({
      requests: {
        status: 'unreconciled',
        items: [request(HAIKU, 500_000), request(HAIKU, 50_000)],
        residual: {},
      },
    }),
  );
  expect(cost).toMatchObject({ status: 'available', lowerBound: true });
  expect(cost.expensive).toBeCloseTo(500_000 * 0.05e-6 + 50_000 * 0.01e-6, 12);
});

test('indisponível: sem detalhamento, modelo sem preço, faixas sem requisições acima do limiar, leitura divergente', () => {
  expect(reasonOf(emptyUsage())).toBe('no_usage_breakdown');
  expect(reasonOf(usage({ byModel: { 'outro-modelo': model(1, 1) } }))).toBe(
    'model_without_price:outro-modelo',
  );
  expect(reasonOf(usage({ byModel: { [HAIKU]: model(100_001, 1) } }))).toBe(
    `tiered_model_without_requests:${HAIKU}`,
  );
  // Abaixo do limiar no total, o preço plano vale mesmo sem requisições.
  expect(
    reasonOf(usage({ byModel: { [HAIKU]: model(100_000, 1) } })),
  ).toBeNull();
  expect(
    reasonOf(usage({ byModel: { [SONNET]: model(5_000_000, 1) } })),
  ).toBeNull();
  expect(
    reasonOf(
      usage({
        byModel: { [HAIKU]: model(5, 1) },
        requests: {
          status: 'residual',
          items: [request(HAIKU, 10)],
          residual: { [HAIKU]: { ...zero, cacheReadInputTokens: -5 } },
        },
      }),
    ),
  ).toBe(`requests_exceed_model_usage:${HAIKU}`);
});

test('modelo só nas requisições, ausente do modelUsage, deixa o custo indisponível', () => {
  expect(
    reasonOf(
      usage({
        byModel: { [SONNET]: model(10, 5) },
        requests: {
          status: 'residual',
          items: [request(HAIKU, 1000)],
          residual: { [HAIKU]: { ...zero, cacheReadInputTokens: -1000 } },
        },
      }),
    ),
  ).toBe(`model_not_in_model_usage:${HAIKU}`);
});

test('TTL desconhecido: o piso paga 5 min e o teto paga 1 h', () => {
  const derived = derive(
    usage({
      requests: {
        status: 'unreconciled',
        items: [
          request(SONNET, 0, {
            cacheWriteInputTokens: 1_000_000,
            cacheWrite1hInputTokens: null,
          }),
        ],
        residual: {},
      },
    }),
  );
  expect(derived.lowerBound).toBe(true);
  expect(derived.cheap).toBeCloseTo(2.5, 12);
  expect(derived.expensive).toBeCloseTo(4, 12);
});

test('evento sem uso (mensagem sintética) não exige preço nem derruba o custo', () => {
  const derived = derive(
    usage({
      byModel: { [SONNET]: model(1_000_000, 0) },
      requests: {
        status: 'reconciled',
        items: [request('<synthetic>', 0), request(SONNET, 1_000_000)],
        residual: {},
      },
    }),
  );
  expect(derived.expensive).toBeCloseTo(0.1, 12);
});

test('requisições sem reconciliação são limite inferior mesmo com modelUsage presente', () => {
  expect(
    derive(
      usage({
        byModel: { [SONNET]: model(10, 1) },
        requests: {
          status: 'unreconciled',
          items: [request(SONNET, 10)],
          residual: {},
        },
      }),
    ).lowerBound,
  ).toBe(true);
});

test('o schema de preços aceita no máximo duas faixas', () => {
  const three = structuredClone(pricing);
  const [first] = three.models[HAIKU]!.tiers;
  three.models[HAIKU]!.tiers = [
    { ...first!, maxPromptTokens: 50_000 },
    { ...first!, maxPromptTokens: 100_000 },
    { ...first!, maxPromptTokens: null },
  ];
  expect(pricingSchema.safeParse(three).success).toBe(false);
});
