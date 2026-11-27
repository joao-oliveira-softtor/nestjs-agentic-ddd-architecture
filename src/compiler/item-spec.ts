import { sha256, stableStringify, byId } from './canonical';
import type { AcceptanceCriterion, Proposal } from './changes/proposal';
import type { WorkItem } from './graph';
import type { IR, IREntity, IRMethod, IRUseCase } from './ir';
import type { DomainLock } from './lock';

export interface ItemCriterion extends AcceptanceCriterion {
  readonly change: string;
  readonly obligation: string;
}
export interface ItemSpecification {
  readonly id: string;
  readonly layer: string;
  readonly module: string;
  readonly dependsOn: string[];
  readonly declaration: unknown;
  readonly contracts: unknown[];
  readonly obligations: string[];
  readonly criteria: ItemCriterion[];
}

/** Strip IR locations; schema fields named source are domain data. */
function withoutSource(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSource);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'source')
        .map(([key, v]) => [
          key,
          ['inputSchema', 'outputSchema', 'payloadSchema'].includes(key)
            ? v
            : withoutSource(v),
        ]),
    );
  return value;
}

export function applicableCriteria(
  item: WorkItem,
  proposals: readonly Proposal[],
): ItemCriterion[] {
  return proposals
    .filter((p) => !p.archived)
    .flatMap((p) =>
      p.acceptance
        .filter(
          (c) =>
            !c.manual && c.covers.some((id) => item.obligations.includes(id)),
        )
        .map((c) => ({
          ...c,
          change: p.id,
          obligation: `criterion:${p.id}/${c.id}`,
        })),
    )
    .sort((a, b) => a.obligation.localeCompare(b.obligation));
}

/** `uses`/`emits` each of `useCaseIds` has in `ir` and did not have in `baseIr`; use-cases with none are left out. */
export function addedRefs(
  baseIr: IR | null | undefined,
  ir: IR,
  useCaseIds: readonly string[],
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const id of useCaseIds) {
    const now = ir.useCases.find((u) => u.id === id);
    if (!now) continue;
    const before = baseIr?.useCases.find((u) => u.id === id);
    const old = new Set([...(before?.uses ?? []), ...(before?.emits ?? [])]);
    const added = [...now.uses, ...now.emits].filter((x) => !old.has(x));
    if (added.length) result[id] = added;
  }
  return result;
}

/** `{ additions }` for a lock entry, or `{}` when the change added nothing. */
export function additionsField(
  lock: DomainLock | null | undefined,
  ir: IR,
  useCaseIds: readonly string[],
): { additions?: Record<string, string[]> } {
  const additions = addedRefs(lock?.ir, ir, useCaseIds);
  return Object.keys(additions).length ? { additions } : {};
}

/**
 * `addition:<change>/<use-case>/<ref>` obligations (#179): what an open proposal added since the lock,
 * plus what each applied change recorded in the lock. The only producer of these ids.
 */
export function additionObligations(
  ir: IR,
  lock: DomainLock | null | undefined,
  proposals: readonly Proposal[],
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const add = (change: string, additions: Record<string, string[]>) => {
    for (const [uc, refs] of Object.entries(additions))
      result.set(uc, [
        ...(result.get(uc) ?? []),
        ...refs.map((r) => `addition:${change}/${uc}/${r}`),
      ]);
  };
  for (const c of lock?.changes ?? []) add(c.id, c.additions ?? {});
  for (const p of proposals.filter((p) => !p.archived))
    add(p.id, addedRefs(lock?.ir, ir, p.delta.modified));
  return result;
}

const additionsOf = (m: ReadonlyMap<string, string[]>, id: string) =>
  m.get(id) ?? [];

export function itemSpecification(
  ir: IR,
  item: WorkItem,
  proposals: readonly Proposal[],
  /** `additionObligations` of the whole project, computed once by the caller. */
  additions: ReadonlyMap<string, string[]> = new Map(),
): ItemSpecification {
  const construction = (e: IREntity) => ({
    ...e,
    methods: e.methods.filter((m) => m.static),
    invariants: e.invariants.filter(
      (i) => i.on === null || e.methods.some((m) => m.static && m.id === i.on),
    ),
  });
  // Contidos e referenciados entram com a forma que o item usa: entidade em construção, VO inteiro.
  const declarationOf = (id: string): unknown => {
    const entity = ir.entities.find((e) => e.id === id);
    return entity
      ? construction(entity)
      : ir.valueObjects?.find((v) => v.id === id);
  };
  const relations = (owner: IREntity): unknown[] =>
    [...(owner.contains ?? []), ...(owner.references ?? [])].map(declarationOf);
  const method = (id: string) => {
    const entity = ir.entities.find((e) => e.methods.some((m) => m.id === id))!;
    const m = entity.methods.find((m) => m.id === id)!;
    return {
      ...m,
      entity: construction(entity),
      invariants: entity.invariants.filter((i) => i.on === id),
    };
  };
  const eventIds = new Set<string>();
  const addEvents = (decl: { emits: string[] }) =>
    decl.emits.forEach((id) => eventIds.add(id));
  let declaration: unknown;
  const contracts: unknown[] = [];
  const entity = ir.entities.find((e) => e.id === item.id);
  const useCase = ir.useCases.find((u) => u.id === item.id);
  const operator = ir.operators.find((o) => o.id === item.id);
  const adapter = ir.adapters?.find((a) => a.id === item.id);
  const valueObject = ir.valueObjects?.find((v) => v.id === item.id);
  const addMethod = (id: string) => {
    const m = method(id);
    addEvents(m);
    m.entity.methods.forEach(addEvents);
    contracts.push(m, ...relations(m.entity));
  };
  const addUseCase = (u: IRUseCase) => {
    addEvents(u);
    u.uses.forEach(addMethod);
    contracts.push(
      ...(u.ports ?? []).flatMap(
        (id) => ir.ports?.find((p) => p.id === id) ?? [],
      ),
    );
  };
  if (entity) {
    declaration = construction(entity);
    contracts.push(...relations(entity));
    entity.methods.filter((m) => m.static).forEach(addEvents);
  } else if (valueObject) {
    declaration = valueObject;
  } else if (adapter) {
    declaration = adapter;
    const port = ir.ports?.find((p) => p.id === adapter.implements);
    const root = ir.entities.find((e) => e.id === port?.root);
    if (port) contracts.push(port);
    if (root) contracts.push(construction(root));
  } else if (useCase) {
    declaration = useCase;
    addUseCase(useCase);
  } else if (operator) {
    declaration = operator;
    for (const id of operator.useCases) {
      const u = ir.useCases.find((u) => u.id === id)!;
      contracts.push(u);
      addUseCase(u);
    }
  } else {
    const m = method(item.id);
    declaration = m;
    addEvents(m);
    m.entity.methods.forEach(addEvents);
    contracts.push(...relations(m.entity));
  }
  contracts.push(...ir.events.filter((e) => eventIds.has(e.id)));
  const criteria = applicableCriteria(item, proposals);
  const unique = [
    ...new Map(contracts.map((c) => [(c as IRMethod).id, c])).values(),
  ];
  return withoutSource({
    id: item.id,
    layer: item.layer,
    module: item.module,
    dependsOn: item.dependsOn,
    declaration,
    contracts: unique.sort(byId as (a: unknown, b: unknown) => number),
    obligations: [
      ...new Set([
        ...item.obligations,
        ...criteria.map((c) => c.obligation),
        ...additionsOf(additions, item.id),
      ]),
    ].sort(),
    criteria,
  }) as ItemSpecification;
}

export function specHash(specification: ItemSpecification): string {
  return sha256(stableStringify(specification));
}
