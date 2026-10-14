import type {
  AdapterRequest,
  AdapterResult,
  EvalAdapter,
  EvalConfiguration,
  Measured,
  ProcessResult,
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

export function claudeArgv(
  executable: string,
  configuration: EvalConfiguration,
  request: AdapterRequest,
): string[] {
  const effort = configuration.parameters.reasoningEffort;
  if (effort === 'none')
    throw Error('Claude reasoningEffort "none" not supported by this adapter');
  const tools = request.mode === 'skills' ? READ_TOOLS : IMPLEMENTATION_TOOLS;
  return [
    executable,
    '--print',
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    configuration.model,
    ...(effort ? ['--effort', effort] : []),
    '--no-session-persistence',
    '--setting-sources',
    'project',
    '--strict-mcp-config',
    '--tools',
    tools.join(','),
    '--permission-mode',
    'dontAsk',
    '--allowed-tools',
    tools.join(','),
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
  return {
    inputTokens: input,
    cachedInputTokens: parts[2]!,
    outputTokens: sum('outputTokens'),
    cost: unavailable('derived_cost_not_adopted'),
  };
}

export function parseClaudeTranscript(process: ProcessResult): AdapterResult {
  const result = processResult(process);
  try {
    let terminal = false;
    let initModel: string | null = null;
    for (const event of events(process.stdout)) {
      if (terminal && event.type !== 'rate_limit_event')
        throw Error('event after terminal result');
      if (event.type === 'system' && event.subtype === 'init') {
        if (typeof event.model === 'string') initModel = event.model;
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
  } catch (error) {
    if (result.transport === 'finished') result.transport = 'infra_error';
    result.finalText = null;
    result.diagnostic ??= `claude_transport: ${String(error)}`;
  }
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
      bundle: false,
      env: { DISABLE_AUTOUPDATER: '1' },
      argv: claudeArgv,
      parse: parseClaudeTranscript,
    },
    options,
  );
}
