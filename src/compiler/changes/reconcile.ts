import { EMPTY_IR, elementsOf, semanticDiff, type DiffItem } from '../diff';
import { workItems } from '../graph';
import type { Coded, CompileError, IR } from '../ir';
import { additionsField } from '../item-spec';
import type { DomainLock, LockChange } from '../lock';
import {
  markApplied,
  proposalHash,
  proposalHashMatches,
  summarize,
  type Proposal,
} from './proposal';

export interface ReconcileInput {
  readonly ir: IR;
  readonly lock: DomainLock | null;
  readonly proposals: readonly Proposal[];
  readonly changesDir: string;
}

export interface ReconcilePlan {
  readonly diff: DiffItem[];
  readonly nextLock: DomainLock | null;
  readonly apply: Proposal | null;
  readonly archivedPath: string | null;
  readonly pending: Coded[];
  readonly errors: CompileError[];
}

const safeMarkApplied = (raw: string): string => {
  try {
    return markApplied(raw);
  } catch {
    return raw;
  }
};

interface Resume {
  readonly proposal: Proposal;
  readonly archivedPath: string;
}
type Recorded = NonNullable<ReconcileInput['lock']>['changes'];

const interruptedOf = (
  change: Recorded[number],
  proposals: readonly Proposal[],
): Proposal | undefined =>
  proposals.some((p) => p.archived && p.id === change.id)
    ? undefined
    : proposals.find(
        (p) =>
          !p.archived &&
          p.status === 'proposed' &&
          p.id === change.id &&
          proposalHashMatches(safeMarkApplied(p.raw), change.hash),
      );

/** Lock written, archive interrupted: such a proposal is finished by the next run, not reported. */
export function splitInterrupted(
  recorded: Recorded,
  proposals: readonly Proposal[],
): { resume: Resume | null; checked: Recorded } {
  let resume: Resume | null = null;
  const checked = recorded.filter((change) => {
    const proposal = interruptedOf(change, proposals);
    if (proposal) resume = { proposal, archivedPath: change.path };
    return !proposal;
  });
  return { resume, checked };
}

const openProposals = (proposals: readonly Proposal[], resume: Resume | null) =>
  proposals.filter(
    (p) => !p.archived && p.status === 'proposed' && p !== resume?.proposal,
  );

const entry = (kind: string, id: string): string => `${kind} ${id}`;

export function archivedPathOf(proposal: Proposal, changesDir: string): string {
  return `${changesDir}/archive/${proposal.id}-${proposal.slug}/proposal.md`;
}

const declaredEntries = (proposal: Proposal): Set<string> =>
  new Set([
    ...proposal.delta.added.map((id) => entry('added', id)),
    ...proposal.delta.modified.map((id) => entry('modified', id)),
    ...proposal.delta.removed.map((id) => entry('removed', id)),
  ]);

export function deltaProblems(
  proposal: Proposal,
  diff: readonly DiffItem[],
): string[] {
  const declared = declaredEntries(proposal);
  const actual = new Set(diff.map((item) => entry(item.kind, item.id)));
  const problems: string[] = [];
  for (const item of diff) {
    if (
      item.classification !== 'docs' &&
      !declared.has(entry(item.kind, item.id))
    ) {
      problems.push(`code change outside the delta: ${item.kind} ${item.id}`);
    }
  }
  for (const declaredEntry of [...declared].sort()) {
    if (!actual.has(declaredEntry))
      problems.push(
        `ID in the delta with no matching code change: ${declaredEntry}`,
      );
  }
  return problems;
}

export function reconcile(input: ReconcileInput): ReconcilePlan {
  const { lock, proposals } = input;
  const errors: CompileError[] = [];
  const pending: Coded[] = [];
  const recorded = lock?.changes ?? [];

  const { resume, checked } = splitInterrupted(recorded, proposals);
  for (const change of checked) {
    const archived = proposals.find((p) => p.archived && p.id === change.id);
    if (!archived) {
      errors.push({
        code: 'proposal.applied-not-archived',
        message: `the applied proposal ${change.id} is not in ${input.changesDir}/archive`,
        source: change.path,
      });
    } else if (!proposalHashMatches(archived.raw, change.hash)) {
      errors.push({
        code: 'proposal.applied-edited',
        message: `the applied proposal ${change.id} was edited after being applied; archived proposals are immutable (restore it from git and open a new proposal)`,
        source: archived.path,
      });
    }
  }
  for (const proposal of proposals) {
    if (proposal.archived && proposal.status !== 'applied') {
      errors.push({
        code: 'proposal.archive-status-wrong',
        message: `proposal in archive has status ${proposal.status}; it should be applied`,
        source: proposal.path,
      });
    }
    if (!proposal.archived && proposal.status === 'applied') {
      errors.push({
        code: 'proposal.applied-outside-archive',
        message: 'proposal with status applied is outside archive',
        source: proposal.path,
      });
    }
    if (
      proposal.archived &&
      !recorded.some((change) => change.id === proposal.id)
    ) {
      errors.push({
        code: 'proposal.archived-not-in-lock',
        message: `the archived proposal ${proposal.id} is not recorded in the lock`,
        source: proposal.path,
      });
    }
  }
  const open = openProposals(proposals, resume);
  if (open.length > 1) {
    errors.push({
      code: 'proposal.multiple-open',
      message: `there are ${open.length} open proposals (${open.map((p) => p.id).join(', ')}); v0 accepts one at a time`,
      source: null,
    });
  }

  // covers só é conferido na proposta aberta: o archive é imutável e o parse
  // não recebe a IR. Proposal-first cobre IDs que ainda não existem no código.
  const known = new Set([
    ...elementsOf(input.ir).keys(),
    ...workItems(input.ir).flatMap((i) => i.obligations),
  ]);
  for (const proposal of open) {
    const reachable = new Set([...known, ...proposal.delta.added]);
    for (const criterion of proposal.acceptance) {
      for (const id of criterion.covers) {
        if (!reachable.has(id))
          errors.push({
            code: 'proposal.covers-unknown',
            message: `criterion ${criterion.id}: covers cites ${id}, which is neither in the IR nor in delta.added`,
            source: proposal.path,
          });
      }
    }
  }

  const appliedTexts = new Map<string, string>();
  for (const proposal of open) {
    try {
      appliedTexts.set(proposal.id, markApplied(proposal.raw));
    } catch {
      errors.push({
        code: 'proposal.mark-applied-failed',
        message: `could not mark the proposal ${proposal.id} as applied; write the line "status: proposed" literally in the frontmatter`,
        source: proposal.path,
      });
    }
  }

  const diff = semanticDiff(lock?.ir ?? EMPTY_IR, input.ir);
  const unchanged = (): ReconcilePlan => ({
    diff,
    nextLock: lock,
    apply: null,
    archivedPath: null,
    pending,
    errors,
  });
  if (errors.length > 0) return unchanged();
  if (resume)
    return {
      diff,
      nextLock: lock,
      apply: resume.proposal,
      archivedPath: resume.archivedPath,
      pending,
      errors,
    };

  const required = diff.filter((item) => item.classification !== 'docs');
  const proposal = open[0] ?? null;

  // Uma proposta aberta que declara exatamente o que mudou (inclusive itens
  // `docs`) segue o caminho de aplicação, mesmo sem mudança de domínio.
  const declaresDocsOnlyChange =
    proposal !== null &&
    diff.length > 0 &&
    deltaProblems(proposal, diff).length === 0;

  if (required.length === 0 && !declaresDocsOnlyChange) {
    if (proposal)
      pending.push({
        code: 'proposal.open-without-change',
        message: `the proposal ${proposal.id} is open, but the code does not have the delta's domain changes yet`,
      });
    const nextLock =
      lock === null && diff.length === 0
        ? null
        : { lockVersion: 1 as const, ir: input.ir, changes: recorded };
    return { diff, nextLock, apply: null, archivedPath: null, pending, errors };
  }

  if (!proposal) {
    pending.push({
      code: 'compile.change-without-proposal',
      message: `there are ${required.length} domain change(s) without a proposal; write ${input.changesDir}/NNNN-<slug>/proposal.md or run \`bun run agentic compile --draft-change <slug>\``,
    });
    return unchanged();
  }

  pending.push(
    ...deltaProblems(proposal, diff).map((problem) => ({
      code: 'proposal.delta-mismatch' as const,
      message: `proposal ${proposal.id}: ${problem}`,
    })),
  );
  if (proposal.motivo === '')
    pending.push({
      code: 'proposal.motivo-empty',
      message: `proposal ${proposal.id}: the ## Motivo section is empty`,
    });
  if (pending.length > 0) return unchanged();

  const declared = declaredEntries(proposal);
  const items = diff.filter(
    (item) =>
      item.classification !== 'docs' || declared.has(entry(item.kind, item.id)),
  );
  const archivedPath = archivedPathOf(proposal, input.changesDir);
  const appliedRaw = appliedTexts.get(proposal.id)!;
  const change: LockChange = {
    id: proposal.id,
    title: proposal.title,
    path: archivedPath,
    summary: summarize(proposal.motivo),
    hash: proposalHash(appliedRaw),
    items,
    ...additionsField(lock, input.ir, proposal.delta.modified),
  };
  return {
    diff,
    nextLock: { lockVersion: 1, ir: input.ir, changes: [...recorded, change] },
    apply: proposal,
    archivedPath,
    pending,
    errors,
  };
}
