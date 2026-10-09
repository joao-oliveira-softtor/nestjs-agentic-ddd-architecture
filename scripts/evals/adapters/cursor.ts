import type {
  AdapterRequest,
  AdapterResult,
  EvalAdapter,
  EvalConfiguration,
  ProcessResult,
} from '../contracts';
import { available } from '../contracts';
import {
  createNativeAdapter,
  events,
  nativeUsage,
  object,
  processResult,
  type NativeAdapterOptions,
} from './native';

export function cursorArgv(
  executable: string,
  configuration: EvalConfiguration,
  request: AdapterRequest,
): string[] {
  if (configuration.parameters.reasoningEffort !== undefined)
    throw Error(
      'Cursor reasoningEffort override not supported by this adapter',
    );
  return [
    executable,
    '--print',
    '--output-format',
    'stream-json',
    '--model',
    configuration.model,
    '--workspace',
    request.cwd,
    '--trust',
    '--sandbox',
    'disabled',
    ...(request.mode === 'skills' ? ['--mode', 'ask'] : ['--force']),
    request.prompt,
  ];
}
export function parseCursorTranscript(process: ProcessResult): AdapterResult {
  const result = processResult(process);
  if (result.transport !== 'finished') return result;
  try {
    let terminal = false;
    for (const event of events(process.stdout)) {
      if (event.type === 'system' && event.subtype === 'init') {
        if (typeof event.model === 'string')
          result.observedModel = available(event.model, 'cursor.init.model');
        if (typeof event.session_id === 'string')
          result.sessionId = available(
            event.session_id,
            'cursor.init.session_id',
          );
      }
      if (event.type === 'assistant') {
        if (
          terminal ||
          event.timestamp_ms !== undefined ||
          event.model_call_id !== undefined
        )
          throw Error('partial or post-terminal assistant');
        const message = object(event.message);
        if (message?.role !== 'assistant' || !Array.isArray(message.content))
          throw Error('invalid complete assistant');
        const text = message.content
          .filter((block) => object(block)?.type === 'text')
          .map((block) => object(block)?.text);
        if (text.some((t) => typeof t !== 'string'))
          throw Error('invalid text blocks');
        if (text.length) result.finalText = text.join('');
      }
      if (event.type === 'result') {
        if (terminal || event.subtype !== 'success' || event.is_error !== false)
          throw Error('invalid terminal result');
        terminal = true;
        if (typeof event.session_id === 'string') {
          if (
            result.sessionId.status === 'available' &&
            result.sessionId.value !== event.session_id
          )
            throw Error('session mismatch');
          result.sessionId = available(
            event.session_id,
            'cursor.result.session_id',
          );
        }
        result.usage = nativeUsage(event.usage, 'cursor.result.usage');
      }
    }
    if (!terminal || result.finalText === null)
      throw Error('missing terminal or complete assistant');
  } catch (error) {
    result.transport = 'infra_error';
    result.finalText = null;
    result.diagnostic = `cursor_transport: ${String(error)}`;
  }
  return result;
}
export function createCursorAdapter(
  configuration: EvalConfiguration,
  options: NativeAdapterOptions = {},
): EvalAdapter {
  return createNativeAdapter(
    configuration,
    {
      command: 'cursor-agent',
      credential: 'CURSOR_API_KEY',
      bundle: true,
      argv: cursorArgv,
      parse: parseCursorTranscript,
    },
    options,
  );
}
