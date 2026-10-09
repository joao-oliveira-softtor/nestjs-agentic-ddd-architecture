import type { AdapterRequest, AdapterResult, EvalAdapter } from '../contracts';
import { available, emptyUsage, unavailable } from '../contracts';
import { runProcess } from '../process';
import { getWorkspace, sandboxCommand, sha256 } from '../isolation';

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
        version: '1',
        executableSha256: sha256('agentic-ddd-scripted-v1'),
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
        { network: false },
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
        ...result,
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
