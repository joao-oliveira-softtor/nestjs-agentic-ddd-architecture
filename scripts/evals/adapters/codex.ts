import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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

export function codexArgv(
  executable: string,
  configuration: EvalConfiguration,
  request: AdapterRequest,
): string[] {
  return [
    executable,
    'exec',
    '--json',
    '--model',
    configuration.model,
    '--ignore-user-config',
    '--ignore-rules',
    '--skip-git-repo-check',
    '--sandbox',
    'danger-full-access',
    '-c',
    'approval_policy="never"',
    '-c',
    'features.multi_agent=false',
    ...(configuration.parameters.reasoningEffort
      ? [
          '-c',
          `model_reasoning_effort=${JSON.stringify(configuration.parameters.reasoningEffort)}`,
        ]
      : []),
    '--cd',
    request.cwd,
    request.prompt,
  ];
}
export function parseCodexTranscript(process: ProcessResult): AdapterResult {
  const result = processResult(process);
  if (result.transport !== 'finished') return result;
  try {
    let terminal = false;
    for (const event of events(process.stdout)) {
      if (event.type === 'turn.failed' || event.type === 'error')
        throw Error('native turn failed');
      if (
        event.type === 'thread.started' &&
        typeof event.thread_id === 'string'
      )
        result.sessionId = available(
          event.thread_id,
          'codex.thread.started.thread_id',
        );
      if (event.type === 'item.completed') {
        const item = object(event.item);
        if (item?.type === 'agent_message') {
          if (terminal || typeof item.text !== 'string')
            throw Error('inconsistent final message');
          result.finalText = item.text;
        }
      }
      if (event.type === 'turn.completed') {
        if (terminal) throw Error('multiple terminal events');
        terminal = true;
        result.usage = nativeUsage(event.usage, 'codex.turn.completed.usage');
      }
      if (event.type === 'turn.started' && terminal)
        throw Error('new turn after completion');
    }
    if (!terminal || result.finalText === null)
      throw Error('missing terminal or final assistant');
  } catch (error) {
    result.transport = 'infra_error';
    result.finalText = null;
    result.diagnostic = `codex_transport: ${String(error)}`;
  }
  return result;
}
async function collectModel(
  home: string,
  result: AdapterResult,
  evidenceDir: string,
  secrets: readonly string[],
): Promise<void> {
  if (result.sessionId.status !== 'available') return;
  const sessionId = result.sessionId.value;
  const root = join(home, '.codex');
  for await (const path of new Bun.Glob('sessions/**/*.jsonl').scan({
    cwd: root,
    onlyFiles: true,
  })) {
    const records = (await readFile(join(root, path), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [object(JSON.parse(line))];
        } catch {
          return [];
        }
      })
      .filter((record) => record !== null);
    if (
      !records.some(
        (record) =>
          record.type === 'session_meta' &&
          object(record.payload)?.id === sessionId,
      )
    )
      continue;
    const model = records
      .filter((record) => record.type === 'turn_context')
      .map((record) => object(record.payload)?.model)
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0,
      )
      .at(-1);
    if (model) {
      result.observedModel = available(
        secrets.reduce(
          (value, secret) => value.replaceAll(secret, '[REDACTED]'),
          model,
        ),
        'codex.rollout.turn_context.model',
      );
      const evidence = join(evidenceDir, 'model-metadata.json');
      await writeFile(
        evidence,
        JSON.stringify(
          {
            sessionId: result.sessionId,
            observedModel: result.observedModel,
            modelRevision: result.modelRevision,
          },
          null,
          2,
        ) + '\n',
      );
      result.evidence.push(evidence);
    }
  }
}
export function createCodexAdapter(
  configuration: EvalConfiguration,
  options: NativeAdapterOptions = {},
): EvalAdapter {
  return createNativeAdapter(
    configuration,
    {
      command: 'codex',
      credential: 'CODEX_API_KEY',
      bundle: false,
      argv: codexArgv,
      parse: parseCodexTranscript,
      collect: collectModel,
    },
    options,
  );
}
