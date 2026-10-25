import type { Proposal } from '../changes/proposal';
import type { IR } from '../ir';
import { changeOwners, type ProjectStatus } from '../state';
import type { Finding } from './gates';

export function workItemFindings(
  ir: IR,
  report: ProjectStatus,
  proposal: Proposal,
): Finding[] {
  const touched = new Set(
    [...proposal.delta.added, ...proposal.delta.modified].flatMap((id) =>
      changeOwners(ir, id),
    ),
  );
  return report.items
    .filter((i) => touched.has(i.id) && i.state !== 'done')
    .map((i) => ({
      message: `${i.id} está ${i.state === 'blocked' ? `blocked(${i.baseState})` : i.state}`,
      source: i.source,
      fix: `bun run agentic packet ${i.id}`,
    }));
}
