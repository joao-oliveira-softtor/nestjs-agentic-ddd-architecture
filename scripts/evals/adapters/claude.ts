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

function tokens(value: unknown, source: string): Measured<number> {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? available(value, source)
    : unavailable<number>();
}

/**
 * `input_tokens` da API da Anthropic exclui o cache; a entrada total é a soma das três
 * parcelas, e `cachedInputTokens` é só a leitura de cache. Falta qualquer parcela → indisponível
 * (nunca estimar). O custo em dólar do CLI é derivado e não é adotado aqui.
 */
export function claudeUsage(value: unknown, source: string): Usage {
  const usage = object(value);
  const parts = [
    tokens(usage?.input_tokens, `${source}.input_tokens`),
    tokens(
      usage?.cache_creation_input_tokens,
      `${source}.cache_creation_input_tokens`,
    ),
    tokens(usage?.cache_read_input_tokens, `${source}.cache_read_input_tokens`),
  ];
  const input = parts.every((p) => p.status === 'available')
    ? available(
        parts.reduce(
          (sum, p) => sum + (p.status === 'available' ? p.value : 0),
          0,
        ),
        `${source}.input_tokens+cache_creation_input_tokens+cache_read_input_tokens`,
      )
    : unavailable<number>('input_token_parts_incomplete');
  return {
    inputTokens: input,
    cachedInputTokens: parts[2]!,
    outputTokens: tokens(usage?.output_tokens, `${source}.output_tokens`),
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
        result.usage = claudeUsage(event.usage, 'claude.result.usage');
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
