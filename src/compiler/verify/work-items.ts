import type { Proposal } from '../changes/proposal';
import type { IR } from '../ir';
import { ownerOf, type ProjectStatus } from '../state';
import type { Finding } from './gates';

export function workItemFindings(
  ir: IR,
  report: ProjectStatus,
  proposal: Proposal,
): Finding[] {
  const touched = new Set(
    [...proposal.delta.added, ...proposal.delta.modified]
      .map((id) => ownerOf(ir, id))
      .filter((id) => id !== null),
  );
  return report.items
    .filter((i) => touched.has(i.id) && i.state !== 'done')
    .map((i) => ({
      message: `${i.id} está ${i.state === 'blocked' ? `blocked(${i.baseState})` : i.state}`,
      source: i.source,
      fix: `bun run agentic packet ${i.id}`,
    }));
}
