import { lstat, opendir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AdapterRequest,
  AdapterResult,
  EvalAdapter,
  EvalConfiguration,
  ProcessResult,
} from '../contracts';
import { available, unavailable } from '../contracts';
import { readPrivateFile } from '../private-files';
import { within } from '../isolation';
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
  try {
    let terminal = false;
    let nativeFailure = false;
    for (const event of events(process.stdout)) {
      if (event.type === 'turn.failed' || event.type === 'error')
        nativeFailure = true;
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
        if (item?.type === 'error') nativeFailure = true;
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
    if (nativeFailure) throw Error('native turn or tool host failed');
  } catch (error) {
    if (result.transport === 'finished') result.transport = 'infra_error';
    result.finalText = null;
    result.diagnostic ??= `codex_transport: ${String(error)}`;
  }
  if (result.transport !== 'finished') result.finalText = null;
  return result;
}
export async function collectCodexModel(
  home: string,
  result: AdapterResult,
  evidenceDir: string,
  secrets: readonly string[],
): Promise<void> {
  if (result.sessionId.status !== 'available') return;
  const sessionId = result.sessionId.value;
  const limit = 1024 * 1024;
  let total = 0;
  async function* files() {
    const boundary = await realpath(home);
    const stack = [join(home, '.codex/sessions')];
    let entries = 0;
    while (stack.length) {
      const path = stack.pop()!;
      const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!stat) continue;
      if (!stat.isDirectory() || !within(boundary, await realpath(path)))
        throw Error('Unsafe session directory');
      const directory = await opendir(path);
      try {
        let entry;
        while ((entry = await directory.read())) {
          if (++entries > 64) throw Error('Session entry limit');
          if (entry.isDirectory()) stack.push(join(path, entry.name));
          else if (entry.name.endsWith('.jsonl')) yield join(path, entry.name);
        }
      } finally {
        await directory.close();
      }
    }
  }
  try {
    for await (const path of files()) {
      const remaining = 8 * limit - total;
      if (remaining <= 0) throw Error('Session aggregate limit');
      const text = await readPrivateFile(
        home,
        path,
        Math.min(limit, remaining),
      );
      total += Buffer.byteLength(text);
      if (total > 8 * limit) throw Error('Session aggregate limit');
      const records = text
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
        return;
      }
    }
  } catch {
    result.observedModel = unavailable('unsafe_or_oversized_session_metadata');
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
      companions: ['codex-code-mode-host'],
      argv: codexArgv,
      parse: parseCodexTranscript,
      collect: collectCodexModel,
    },
    options,
  );
}
