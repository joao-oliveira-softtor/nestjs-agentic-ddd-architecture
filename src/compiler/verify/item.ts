import { AgenticError, type ErrorCode } from '../ir';
import { collectStatus, stateContext } from '../project-state';
import type { Finding, GateResult } from './gates';
import { hasTacticalElements, tacticalGate } from './tactical';
import { VERIFY_ENV } from './test-run';

export interface ItemVerifyOptions {
  readonly configPath: string;
  readonly item: string;
  readonly specHash: string;
}
export interface ItemVerifyReport {
  readonly item: string;
  readonly status: 'done' | 'failed';
  readonly gates: GateResult[];
}

export async function verifyItem(
  options: ItemVerifyOptions,
): Promise<ItemVerifyReport> {
  const context = await stateContext(options.configPath);
  const report = await collectStatus(context);
  const item = report.items.find((i) => i.id === options.item);
  if (!item)
    throw new AgenticError(
      'state.item-not-found',
      `work item ${options.item} not found`,
    );
  const findings = (
    code: ErrorCode,
    messages: string[],
    fix: string,
  ): Finding[] =>
    messages
      .sort()
      .map((message) => ({ code, message, fix, source: item.source }));
  const gate = (
    id: GateResult['id'],
    name: string,
    findings: Finding[],
  ): GateResult => ({
    id,
    name,
    status: findings.length ? 'failed' : 'passed',
    findings,
    warnings: [],
  });
  const command = context.project.config.verify.commands.find(
    (c) => c.name === 'typecheck',
  )?.command ?? ['bun', 'run', 'typecheck'];
  const proc = Bun.spawn([...command], {
    cwd: context.project.config.root,
    env: { ...process.env, [VERIFY_ENV]: '1' },
    stdout: 'ignore',
    stderr: 'ignore',
  });
  const exitCode = await proc.exited;
  const gates = [
    gate(
      'I1',
      'Dependencies',
      findings(
        'verify.item-dependency-not-done',
        item.blockedBy.map((id) => `${id} is not done`),
        'finish the dependencies with packet and verify --item',
      ),
    ),
    gate(
      'I2',
      'Implementation',
      findings(
        'verify.item-not-implemented',
        item.baseState === 'declared'
          ? ['body still contains notImplemented() or execute is missing']
          : [],
        `implement the body of ${item.id}`,
      ),
    ),
    gate(
      'I3',
      'Specification',
      findings(
        'verify.item-spec-hash-mismatch',
        item.specHash !== options.specHash
          ? ['specHash differs from the current specification']
          : [],
        `restore the declaration or request a new packet ${item.id}`,
      ),
    ),
    gate('I4', 'Obligations', [
      ...findings(
        'verify.item-obligation-untested',
        item.missingObligations.map((id) => `${id} has no test`),
        'create tests with covers for the obligations',
      ),
      ...item.unsuccessfulTests.map((t) => ({
        code: 'verify.item-test-unsuccessful' as const,
        message: `test ${t.status}: ${t.name}`,
        source: `${t.file}:${t.line}`,
        fix: 'fix the code or the test until it passes',
      })),
    ]),
    gate(
      'I5',
      'Typecheck',
      findings(
        'verify.item-typecheck-failed',
        exitCode !== 0 ? [`typecheck exited with ${exitCode}`] : [],
        `run ${command.join(' ')} and fix it`,
      ),
    ),
  ];
  const { ir, registry, config } = context.project;
  const target = (() => {
    switch (item.id.slice(0, item.id.indexOf(':'))) {
      case 'entity':
        return { kind: 'entity', records: registry.entities } as const;
      case 'valueobject':
        return { kind: 'valueobject', records: registry.valueObjects } as const;
      default:
        return null;
    }
  })();
  if (target && hasTacticalElements(ir)) {
    const { kind, records } = target;
    const name = item.id.slice(item.id.indexOf(':') + 1);
    const record = records.find((r) => r.target.name === name);
    gates.push(
      gate(
        'T',
        'Tactical',
        record
          ? tacticalGate({
              ir,
              record,
              root: config.root,
              owner: item.id,
              kind,
            })
          : [
              {
                code: 'verify.tactical-class-missing' as const,
                message: `T: class ${name} not found in the registry`,
                fix: 'check the decorator on the source line',
                source: item.source,
              },
            ],
      ),
    );
  }
  return {
    item: item.id,
    status: gates.every((g) => g.status === 'passed') ? 'done' : 'failed',
    gates,
  };
}
