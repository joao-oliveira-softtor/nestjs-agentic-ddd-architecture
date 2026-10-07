import { sha256 } from '../canonical';
import { EMPTY_IR, semanticDiff, type DiffItem } from '../diff';
import type { CompileError, IR } from '../ir';
import type { DomainLock, LockChange } from '../lock';
import { markApplied, summarize, type Proposal } from './proposal';

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
  readonly pending: string[];
  readonly errors: CompileError[];
}

const entry = (kind: string, id: string): string => `${kind} ${id}`;

export function archivedPathOf(proposal: Proposal, changesDir: string): string {
  return `${changesDir}/archive/${proposal.id}-${proposal.slug}/proposal.md`;
}

export function deltaProblems(
  proposal: Proposal,
  diff: readonly DiffItem[],
): string[] {
  const declared = new Set([
    ...proposal.delta.added.map((id) => entry('added', id)),
    ...proposal.delta.modified.map((id) => entry('modified', id)),
    ...proposal.delta.removed.map((id) => entry('removed', id)),
  ]);
  const actual = new Set(diff.map((item) => entry(item.kind, item.id)));
  const problems: string[] = [];
  for (const item of diff) {
    if (
      item.classification !== 'docs' &&
      !declared.has(entry(item.kind, item.id))
    ) {
      problems.push(`mudança no código fora do delta: ${item.kind} ${item.id}`);
    }
  }
  for (const declaredEntry of [...declared].sort()) {
    if (!actual.has(declaredEntry))
      problems.push(
        `ID no delta sem mudança correspondente no código: ${declaredEntry}`,
      );
  }
  return problems;
}

export function reconcile(input: ReconcileInput): ReconcilePlan {
  const { lock, proposals } = input;
  const errors: CompileError[] = [];
  const pending: string[] = [];
  const recorded = lock?.changes ?? [];

  for (const change of recorded) {
    const archived = proposals.find((p) => p.archived && p.id === change.id);
    if (!archived) {
      errors.push({
        message: `a proposta aplicada ${change.id} não está em ${input.changesDir}/archive`,
        source: change.path,
      });
    } else if (sha256(archived.raw) !== change.hash) {
      errors.push({
        message: `a proposta aplicada ${change.id} foi editada depois de aplicada; propostas arquivadas são imutáveis (restaure-a pelo git e abra uma nova proposta)`,
        source: archived.path,
      });
    }
  }
  for (const proposal of proposals) {
    if (proposal.archived && proposal.status !== 'applied') {
      errors.push({
        message: `proposta em archive com status ${proposal.status}; deveria ser applied`,
        source: proposal.path,
      });
    }
    if (!proposal.archived && proposal.status === 'applied') {
      errors.push({
        message: 'proposta com status applied fora de archive',
        source: proposal.path,
      });
    }
    if (
      proposal.archived &&
      !recorded.some((change) => change.id === proposal.id)
    ) {
      errors.push({
        message: `a proposta arquivada ${proposal.id} não está registrada no lock`,
        source: proposal.path,
      });
    }
  }
  const open = proposals.filter((p) => !p.archived && p.status === 'proposed');
  if (open.length > 1) {
    errors.push({
      message: `há ${open.length} propostas abertas (${open.map((p) => p.id).join(', ')}); o v0 aceita uma por vez`,
      source: null,
    });
  }

  const appliedTexts = new Map<string, string>();
  for (const proposal of open) {
    try {
      appliedTexts.set(proposal.id, markApplied(proposal.raw));
    } catch {
      errors.push({
        message: `não foi possível marcar a proposta ${proposal.id} como aplicada; escreva a linha "status: proposed" literalmente no frontmatter`,
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

  const required = diff.filter((item) => item.classification !== 'docs');
  const proposal = open[0] ?? null;

  if (required.length === 0) {
    if (proposal)
      pending.push(
        `a proposta ${proposal.id} está aberta, mas o código ainda não tem as mudanças de domínio do delta`,
      );
    const nextLock =
      lock === null && diff.length === 0
        ? null
        : { lockVersion: 1 as const, ir: input.ir, changes: recorded };
    return { diff, nextLock, apply: null, archivedPath: null, pending, errors };
  }

  if (!proposal) {
    pending.push(
      `há ${required.length} mudança(s) de domínio sem proposta; escreva ${input.changesDir}/NNNN-<slug>/proposal.md ou rode \`bun run agentic compile --draft-change <slug>\``,
    );
    return unchanged();
  }

  const problems = deltaProblems(proposal, diff);
  if (proposal.motivo === '') problems.push('a seção ## Motivo está vazia');
  if (problems.length > 0) {
    pending.push(
      ...problems.map((problem) => `proposta ${proposal.id}: ${problem}`),
    );
    return unchanged();
  }

  const archivedPath = archivedPathOf(proposal, input.changesDir);
  const appliedRaw = appliedTexts.get(proposal.id)!;
  const change: LockChange = {
    id: proposal.id,
    title: proposal.title,
    path: archivedPath,
    summary: summarize(proposal.motivo),
    hash: sha256(appliedRaw),
    items: diff,
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
