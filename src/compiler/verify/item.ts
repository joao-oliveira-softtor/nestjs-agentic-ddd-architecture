import { collectStatus, stateContext } from '../project-state';
import type { Finding, GateResult } from './gates';
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
  if (!item) throw new Error(`work item ${options.item} não encontrado`);
  const findings = (messages: string[], fix: string): Finding[] =>
    messages.sort().map((message) => ({ message, fix, source: item.source }));
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
      'Dependências',
      findings(
        item.blockedBy.map((id) => `${id} não está done`),
        'conclua as dependências com packet e verify --item',
      ),
    ),
    gate(
      'I2',
      'Implementação',
      findings(
        item.baseState === 'declared'
          ? ['corpo ainda contém notImplemented() ou execute está ausente']
          : [],
        `implemente o corpo de ${item.id}`,
      ),
    ),
    gate(
      'I3',
      'Especificação',
      findings(
        item.specHash !== options.specHash
          ? ['specHash diverge da especificação atual']
          : [],
        `restaure a declaração ou peça novo packet ${item.id}`,
      ),
    ),
    gate('I4', 'Obrigações', [
      ...findings(
        item.missingObligations.map((id) => `${id} sem teste`),
        'crie testes com covers para as obrigações',
      ),
      ...item.unsuccessfulTests.map((t) => ({
        message: `teste ${t.status}: ${t.name}`,
        source: `${t.file}:${t.line}`,
        fix: 'corrija o código ou teste até passar',
      })),
    ]),
    gate(
      'I5',
      'Typecheck',
      findings(
        exitCode !== 0 ? [`typecheck saiu com ${exitCode}`] : [],
        `rode ${command.join(' ')} e corrija`,
      ),
    ),
  ];
  return {
    item: item.id,
    status: gates.every((g) => g.status === 'passed') ? 'done' : 'failed',
    gates,
  };
}
