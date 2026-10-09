import type { AdapterRequest, AdapterResult, EvalAdapter } from '../contracts';
import { available, emptyUsage, unavailable } from '../contracts';
import { runProcess } from '../process';
import {
  getWorkspace,
  sandboxCommand,
  sha256,
  protectedWorkspacePaths,
} from '../isolation';
import { TASK_ITEMS } from '../audit';

export interface ScriptedAction {
  finalText?: string;
  stderr?: string;
  exitCode?: number;
  delayMs?: number;
  argv?: readonly string[];
  /** Trusted offline fixture callback; never provided to real adapters. */
  before?: (request: AdapterRequest) => Promise<void>;
}
export function createScriptedAdapter(
  script: readonly ScriptedAction[],
): EvalAdapter {
  let index = 0;
  return {
    async probe() {
      return {
        id: 'scripted',
        version: `scripted-v1 / Bun ${Bun.version}`,
        executableSha256: sha256(
          new Uint8Array(await Bun.file(process.execPath).arrayBuffer()),
        ),
      };
    },
    async run(request, options): Promise<AdapterResult> {
      const action = script[index++];
      const common = {
        sessionId: available(`scripted-${index}`, 'scripted_fixture'),
        observedModel: available('scripted', 'scripted_fixture'),
        modelRevision: unavailable<string>('synthetic'),
        usage: emptyUsage(),
      };
      if (!action)
        return {
          ...common,
          transport: 'infra_error',
          finalText: null,
          exitCode: null,
          signal: null,
          durationMs: 0,
          evidence: [],
          diagnostic: 'script_exhausted',
        };
      await action.before?.(request);
      const workspace = getWorkspace(request.cwd);
      const code = `await Bun.sleep(${JSON.stringify(action.delayMs ?? 0)}); process.stdout.write(${JSON.stringify(action.finalText ?? '')}); process.stderr.write(${JSON.stringify(action.stderr ?? '')}); process.exit(${JSON.stringify(action.exitCode ?? 0)})`;
      const argv = await sandboxCommand(
        workspace,
        action.argv ?? [process.execPath, '-e', code],
        {
          network: false,
          framework: request.mode === 'implementation',
          extraReadOnly: await protectedWorkspacePaths(
            workspace,
            TASK_ITEMS.filter((i) => i.id === request.id).flatMap((i) => [
              i.test,
              ...(i.file ? [i.file] : []),
            ]),
          ),
        },
      );
      const result = await runProcess(
        {
          argv,
          cwd: request.cwd,
          env: { PATH: '/usr/bin:/bin' },
          timeoutMs: request.timeoutMs,
          evidenceDir: request.evidenceDir,
        },
        options,
      );
      return {
        ...common,
        exitCode: result.exitCode,
        signal: result.signal,
        durationMs: result.durationMs,
        evidence: result.evidence,
        transport:
          result.transport === 'finished' && result.exitCode !== 0
            ? 'infra_error'
            : result.transport,
        finalText:
          result.transport === 'finished' && result.exitCode === 0
            ? result.stdout
            : null,
        diagnostic:
          result.diagnostic ??
          (result.exitCode !== 0 ? 'process_nonzero' : null),
      };
    },
  };
}
