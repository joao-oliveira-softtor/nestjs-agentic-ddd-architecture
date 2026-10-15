import { match } from 'ts-pattern';
import type {
  AdapterRequest,
  AdapterResult,
  EvalAdapter,
  EvalConfiguration,
  InputParts,
  Measured,
  ModelUsage,
  ProcessResult,
  RequestUsage,
  RequestsUsage,
  Usage,
} from '../contracts';
import { available, unavailable } from '../contracts';
import {
  createNativeAdapter,
  events,
  object,
  processResult,
  type NativeAdapterOptions,
} from './native';

const READ_TOOLS = ['Read', 'Grep', 'Glob'];
const IMPLEMENTATION_TOOLS = [...READ_TOOLS, 'Edit', 'Write', 'Bash'];

/**
 * `--tools` e `--allowed-tools` são opções variádicas do CLI: na forma `--opção valor` elas
 * consomem os argumentos seguintes, inclusive o prompt posicional ("Input must be provided…").
 * A forma `--opção=valor` não consome, e `--` encerra as opções antes do prompt. Lista vazia
 * desliga todas as ferramentas.
 */
export function claudeToolFlags(tools: readonly string[]): string[] {
  const list = tools.join(',');
  return [
    `--tools=${list}`,
    ...(tools.length ? [`--allowed-tools=${list}`] : []),
  ];
}

export function claudeArgv(
  executable: string,
  configuration: EvalConfiguration,
  request: AdapterRequest,
): string[] {
  // O degrau do roteamento (modelo e esforço do pedido) prevalece sobre a configuração.
  const model = request.model ?? configuration.model;
  const effort =
    request.reasoningEffort ?? configuration.parameters.reasoningEffort;
  if (effort === 'none')
    throw Error('Claude reasoningEffort "none" not supported by this adapter');
  const tools = match(request.mode)
    .with('skills', 'review', () => READ_TOOLS)
    .with('implementation', () => IMPLEMENTATION_TOOLS)
    .exhaustive();
  return [
    executable,
    '--print',
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    model,
    ...(effort ? ['--effort', effort] : []),
    '--no-session-persistence',
    '--setting-sources',
    'project',
    '--strict-mcp-config',
    '--permission-mode',
    'dontAsk',
    ...claudeToolFlags(tools),
    '--',
    request.prompt,
  ];
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * Uso total do `result`: soma de `modelUsage` de todos os modelos. O `usage` de nível superior
 * é só do laço principal e por turno; `modelUsage` é cumulativo e cobre todas as chamadas
 * (changelog do Claude Agent SDK 0.3.223), então só ele entra na contabilidade. A API exclui o
 * cache de `inputTokens`: a entrada total soma as três parcelas e `cachedInputTokens` é só a
 * leitura de cache. Campo ausente ou inválido em qualquer modelo → indisponível (nunca
 * estimar). O custo em dólar do CLI é derivado e não é adotado aqui.
 */
export function claudeUsage(modelUsage: unknown, source: string): Usage {
  const entries = Object.values(object(modelUsage) ?? {}).map(object);
  const sum = (key: string): Measured<number> => {
    if (!entries.length) return unavailable<number>('model_usage_missing');
    const values = entries.map((entry) => entry?.[key]);
    return values.every(isCount)
      ? available(
          values.reduce((total, value) => total + value, 0),
          `${source}.*.${key}`,
        )
      : unavailable<number>('model_usage_incomplete');
  };
  const parts = [
    sum('inputTokens'),
    sum('cacheCreationInputTokens'),
    sum('cacheReadInputTokens'),
  ];
  const input = parts.every((part) => part.status === 'available')
    ? available(
        parts.reduce(
          (total, part) =>
            total + (part.status === 'available' ? part.value : 0),
          0,
        ),
        `${source}.*.inputTokens+cacheCreationInputTokens+cacheReadInputTokens`,
      )
    : unavailable<number>(
        parts.find((part) => part.status === 'unavailable')?.reason ??
          'model_usage_incomplete',
      );
  const byModel = claudeByModel(modelUsage);
  return {
    inputTokens: input,
    cachedInputTokens: parts[2]!,
    outputTokens: sum('outputTokens'),
    cost: unavailable('derived_cost_not_adopted'),
    cacheWriteInputTokens: parts[1]!,
    ...(byModel ? { byModel } : {}),
  };
}

/** Uso por modelo servido, das mesmas parcelas de `modelUsage`; parcela inválida → ausente. */
export function claudeByModel(
  modelUsage: unknown,
): Record<string, ModelUsage> | undefined {
  const entries = Object.entries(object(modelUsage) ?? {});
  if (!entries.length) return undefined;
  const byModel: Record<string, ModelUsage> = {};
  for (const [model, value] of entries) {
    const entry = object(value);
    const counts = [
      entry?.inputTokens,
      entry?.cacheCreationInputTokens,
      entry?.cacheReadInputTokens,
      entry?.outputTokens,
    ];
    if (!counts.every(isCount)) return undefined;
    const [uncached, write, read, output] = counts as number[];
    const cost = entry?.costUSD;
    byModel[model] = {
      uncachedInputTokens: uncached!,
      cacheWriteInputTokens: write!,
      cacheReadInputTokens: read!,
      outputTokens: output!,
      ...(typeof cost === 'number' && Number.isFinite(cost) && cost >= 0
        ? { reportedCostUSD: cost }
        : {}),
    };
  }
  return byModel;
}

/**
 * Entrada por requisição: `message.usage` do último evento `assistant` de cada `message.id`
 * (os eventos parciais de um id repetem o mesmo uso de entrada e um `output_tokens`
 * provisório, por isso a saída não é lida). Tolerante a linha inválida, porque no timeout o
 * stdout pode terminar no meio de um evento; requisição com parcela inválida fica de fora e
 * aparece como resíduo na reconciliação.
 */
export function claudeRequests(stdout: string): RequestUsage[] {
  const byId = new Map<string, RequestUsage>();
  for (const line of stdout.split('\n')) {
    let event: Record<string, unknown> | null;
    try {
      event = object(JSON.parse(line));
    } catch {
      continue;
    }
    const message = object(event?.message);
    const usage = object(message?.usage);
    if (
      event?.type !== 'assistant' ||
      typeof message?.id !== 'string' ||
      typeof message.model !== 'string' ||
      !usage
    )
      continue;
    const counts = [
      usage.input_tokens,
      usage.cache_creation_input_tokens ?? 0,
      usage.cache_read_input_tokens ?? 0,
    ];
    if (!counts.every(isCount)) continue;
    const [uncached, write, read] = counts as number[];
    const longTtl = object(usage.cache_creation)?.ephemeral_1h_input_tokens;
    byId.set(message.id, {
      model: message.model,
      uncachedInputTokens: uncached!,
      cacheWriteInputTokens: write!,
      cacheReadInputTokens: read!,
      // 1 h maior que a escrita total é incoerente: TTL desconhecido, não preço negativo.
      cacheWrite1hInputTokens:
        isCount(longTtl) && longTtl <= write! ? longTtl : null,
    });
  }
  return [...byId.values()];
}

const INPUT_KEYS = [
  'uncachedInputTokens',
  'cacheWriteInputTokens',
  'cacheReadInputTokens',
] as const;

/**
 * Compara a entrada por requisição com `byModel`, modelo a modelo. A diferença positiva são
 * chamadas auxiliares do CLI sem evento `assistant`; a negativa, leitura divergente.
 */
export function reconcileRequests(
  items: RequestUsage[],
  byModel: Record<string, ModelUsage> | undefined,
): RequestsUsage {
  if (!byModel) return { status: 'unreconciled', items, residual: {} };
  const residual: Record<string, InputParts> = {};
  const models = new Set([
    ...Object.keys(byModel),
    ...items.map((i) => i.model),
  ]);
  for (const model of [...models].sort()) {
    const parts = Object.fromEntries(
      INPUT_KEYS.map((key) => [
        key,
        (byModel[model]?.[key] ?? 0) -
          items
            .filter((i) => i.model === model)
            .reduce((total, i) => total + i[key], 0),
      ]),
    ) as unknown as InputParts;
    if (INPUT_KEYS.some((key) => parts[key] !== 0)) residual[model] = parts;
  }
  return {
    status: Object.keys(residual).length ? 'residual' : 'reconciled',
    items,
    residual,
  };
}

/**
 * Origens aceitas com `oauth-token`: só a do token de assinatura. Uma chave de API no ambiente
 * ou um `apiKeyHelper` nas settings vence o token no CLI e mudaria a cobrança em silêncio.
 * `none` é o valor que o Claude Code 2.1.299 informou pela assinatura no smoke de 2026-10-14
 * (harness e driver).
 */
const SUBSCRIPTION_SOURCES: readonly string[] = ['none'];

export function authSourceMismatch(
  authentication: EvalConfiguration['authentication'],
  authSource: Measured<string> | undefined,
): boolean {
  return match(authentication ?? 'api-key')
    .with(
      'oauth-token',
      () =>
        authSource?.status === 'available' &&
        !SUBSCRIPTION_SOURCES.includes(authSource.value),
    )
    .with('api-key', 'local-login', () => false)
    .exhaustive();
}

export function parseClaudeTranscript(
  process: ProcessResult,
  configuration?: Pick<EvalConfiguration, 'authentication'>,
): AdapterResult {
  const result = processResult(process);
  const requests = claudeRequests(process.stdout);
  try {
    let terminal = false;
    let initModel: string | null = null;
    for (const event of events(process.stdout)) {
      if (terminal && event.type !== 'rate_limit_event')
        throw Error('event after terminal result');
      if (event.type === 'system' && event.subtype === 'init') {
        if (typeof event.model === 'string') initModel = event.model;
        if (typeof event.apiKeySource === 'string')
          result.authSource = available(
            event.apiKeySource,
            'claude.init.apiKeySource',
          );
        if (typeof event.session_id === 'string')
          result.sessionId = available(
            event.session_id,
            'claude.init.session_id',
          );
      }
      if (event.type === 'result') {
        terminal = true;
        if (event.is_error !== false || event.subtype !== 'success')
          throw Error('native result is an error');
        if (typeof event.result !== 'string')
          throw Error('missing final result text');
        result.finalText = event.result;
        if (typeof event.session_id === 'string') {
          if (
            result.sessionId.status === 'available' &&
            result.sessionId.value !== event.session_id
          )
            throw Error('session mismatch');
          result.sessionId = available(
            event.session_id,
            'claude.result.session_id',
          );
        }
        result.usage = claudeUsage(
          event.modelUsage,
          'claude.result.modelUsage',
        );
        result.usage.requests = reconcileRequests(
          requests,
          result.usage.byModel,
        );
        if (isCount(event.num_turns))
          result.numTurns = available(
            event.num_turns,
            'claude.result.num_turns',
          );
        const served = Object.keys(object(event.modelUsage) ?? {});
        if (served.length === 1)
          result.observedModel = available(
            served[0]!,
            'claude.result.modelUsage',
          );
        else if (served.length > 1)
          result.observedModel = unavailable('multiple_models_observed');
      }
    }
    if (!terminal || result.finalText === null)
      throw Error('missing terminal result');
    if (
      initModel &&
      result.observedModel.status === 'unavailable' &&
      result.observedModel.reason === 'not_reported'
    )
      result.observedModel = available(initModel, 'claude.init.model');
    if (authSourceMismatch(configuration?.authentication, result.authSource))
      throw Error('auth_source_mismatch');
  } catch (error) {
    if (result.transport === 'finished') result.transport = 'infra_error';
    result.finalText = null;
    result.diagnostic ??= `claude_transport: ${String(error)}`;
  }
  // Sem `result` (timeout, transcript truncado) a entrada por requisição ainda é medida.
  if (!result.usage.requests && requests.length)
    result.usage.requests = reconcileRequests(requests, undefined);
  if (result.transport !== 'finished') result.finalText = null;
  return result;
}

export function createClaudeAdapter(
  configuration: EvalConfiguration,
  options: NativeAdapterOptions = {},
): EvalAdapter {
  return createNativeAdapter(
    configuration,
    {
      command: 'claude',
      credential: 'ANTHROPIC_API_KEY',
      oauthCredential: 'CLAUDE_CODE_OAUTH_TOKEN',
      bundle: false,
      env: { DISABLE_AUTOUPDATER: '1' },
      argv: claudeArgv,
      parse: parseClaudeTranscript,
    },
    options,
  );
}
