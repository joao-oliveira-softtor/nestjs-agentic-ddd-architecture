import type { Proposal } from './changes/proposal';
import { workItems, type WorkItem } from './graph';
import type { IR } from './ir';
import { itemSpecification, specHash } from './item-spec';
import type { TestCaseResult, TestRun } from './verify/test-run';

export type BaseState = 'declared' | 'implemented' | 'covered' | 'done';
export interface WorkItemStatus extends WorkItem {
  readonly baseState: BaseState;
  readonly state: BaseState | 'blocked';
  readonly blockedBy: string[];
  readonly missingObligations: string[];
  readonly unsuccessfulTests: TestCaseResult[];
  readonly specHash: string;
}
export interface ProjectStatus {
  readonly mode: 'static' | 'dynamic';
  readonly change: string | null;
  readonly items: WorkItemStatus[];
  readonly diagnostics: string[];
}
export interface NextReport {
  readonly change: string | null;
  readonly waves: string[][];
  readonly diagnostics: string[];
}

export function ownerOf(ir: IR, id: string): string | null {
  return (
    workItems(ir).find((i) => i.id === id || i.obligations.includes(id))?.id ??
    null
  );
}

export function evaluateStatus(input: {
  readonly ir: IR;
  readonly implemented: ReadonlyMap<string, boolean>;
  readonly proposals: readonly Proposal[];
  readonly evidence: TestRun;
  readonly mode: ProjectStatus['mode'];
  readonly diagnostics?: readonly string[];
}): ProjectStatus {
  const items = workItems(input.ir).map((item): WorkItemStatus => {
    const specification = itemSpecification(input.ir, item, input.proposals);
    const relevant = input.evidence.cases
      .filter((t) =>
        t.covers.some((id) => specification.obligations.includes(id)),
      )
      .sort((a, b) =>
        `${a.file}:${a.line}:${a.name}`.localeCompare(
          `${b.file}:${b.line}:${b.name}`,
        ),
      );
    const missingObligations = specification.obligations.filter(
      (id) => !relevant.some((t) => t.covers.includes(id)),
    );
    const unsuccessfulTests = relevant.filter((t) => t.status !== 'passed');
    const baseState: BaseState = !input.implemented.get(item.id)
      ? 'declared'
      : missingObligations.length > 0
        ? 'implemented'
        : input.mode === 'static' ||
            unsuccessfulTests.length > 0 ||
            input.evidence.collectionError
          ? 'covered'
          : 'done';
    return {
      ...item,
      obligations: specification.obligations,
      baseState,
      state: baseState,
      blockedBy: [],
      missingObligations,
      unsuccessfulTests,
      specHash: specHash(specification),
    };
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  const evaluated = new Map<string, WorkItemStatus>();
  const visit = (id: string): WorkItemStatus => {
    const known = evaluated.get(id);
    if (known) return known;
    const item = byId.get(id)!;
    const blockedBy = item.dependsOn
      .filter((dep) => visit(dep).state !== 'done')
      .sort();
    const result: WorkItemStatus = {
      ...item,
      blockedBy,
      state: blockedBy.length ? 'blocked' : item.baseState,
    };
    evaluated.set(id, result);
    return result;
  };
  return {
    mode: input.mode,
    change: null,
    items: items.map((i) => visit(i.id)),
    diagnostics: [
      ...(input.diagnostics ?? []),
      ...(input.evidence.collectionError
        ? [input.evidence.collectionError]
        : []),
    ].sort(),
  };
}

export function selectChange(
  report: ProjectStatus,
  ir: IR,
  proposal: Proposal,
): ProjectStatus {
  const byId = new Map(report.items.map((i) => [i.id, i]));
  const selected = new Set<string>();
  const add = (id: string) => {
    if (selected.has(id)) return;
    selected.add(id);
    for (const dep of byId.get(id)!.dependsOn)
      if (byId.get(dep)!.state !== 'done') add(dep);
  };
  for (const id of [...proposal.delta.added, ...proposal.delta.modified]) {
    const owner = ownerOf(ir, id);
    if (owner) add(owner);
  }
  return {
    ...report,
    change: proposal.id,
    items: report.items.filter((i) => selected.has(i.id)),
  };
}

export function waves(report: ProjectStatus): NextReport {
  const pending = new Map(
    report.items.filter((i) => i.state !== 'done').map((i) => [i.id, i]),
  );
  const result: string[][] = [];
  while (pending.size) {
    const wave = [...pending.values()]
      .filter((i) => i.dependsOn.every((id) => !pending.has(id)))
      .map((i) => i.id)
      .sort();
    if (!wave.length) throw new Error('grafo de work items contém ciclo');
    result.push(wave);
    wave.forEach((id) => pending.delete(id));
  }
  return {
    change: report.change,
    waves: result,
    diagnostics: report.diagnostics,
  };
}
