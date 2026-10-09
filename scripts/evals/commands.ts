import { join } from 'node:path';
import type {
  AttemptWorkspace,
  CommandEvidence,
  RunOptions,
} from './contracts';
import { sandboxCommand } from './isolation';
import { runProcess } from './process';

export async function workspaceCommand(
  workspace: AttemptWorkspace,
  name: string,
  argv: readonly string[],
  options: RunOptions,
  evidenceDir: string,
  extraReadOnly: readonly string[] = [],
): Promise<CommandEvidence> {
  const sandbox = await sandboxCommand(workspace, argv, {
    network: false,
    extraReadOnly,
  });
  const result = await runProcess(
    {
      argv: sandbox,
      cwd: workspace.root,
      env: {
        PATH: '/tools:/usr/bin:/bin',
        HOME: '/home/eval',
        AGENTIC_DDD_VERIFY: '1',
      },
      timeoutMs: Math.min(120000, options.control?.remainingMs() ?? 120000),
      evidenceDir,
    },
    { signal: options.control?.signal ?? options.signal },
  );
  return { name, argv, result };
}
export function cliArgv(
  workspace: AttemptWorkspace,
  args: readonly string[],
): string[] {
  return [
    process.execPath,
    join(workspace.frameworkRoot, 'src/cli/main.ts'),
    ...args,
    '--config',
    workspace.configPath,
  ];
}
export function requireFinished(command: CommandEvidence): void {
  if (command.result.transport !== 'finished' || command.result.exitCode !== 0)
    throw Error(
      `${command.name}: ${command.result.transport} exit=${command.result.exitCode}: ${command.result.diagnostic ?? command.result.stderr}`,
    );
}
