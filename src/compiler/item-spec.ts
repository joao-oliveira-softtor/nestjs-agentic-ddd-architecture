import { sha256, stableStringify, byId } from './canonical';
import type { AcceptanceCriterion, Proposal } from './changes/proposal';
import type { WorkItem } from './graph';
import type { IR, IREntity, IRMethod, IRUseCase } from './ir';

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

export function itemSpecification(
  ir: IR,
  item: WorkItem,
  proposals: readonly Proposal[],
): ItemSpecification {
  const construction = (e: IREntity) => ({
    ...e,
    methods: e.methods.filter((m) => m.static),
    invariants: e.invariants.filter(
      (i) => i.on === null || e.methods.some((m) => m.static && m.id === i.on),
    ),
  });
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
  const addMethod = (id: string) => {
    const m = method(id);
    addEvents(m);
    m.entity.methods.forEach(addEvents);
    contracts.push(m);
  };
  const addUseCase = (u: IRUseCase) => {
    addEvents(u);
    u.uses.forEach(addMethod);
  };
  if (entity) {
    declaration = construction(entity);
    entity.methods.filter((m) => m.static).forEach(addEvents);
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
      ...item.obligations,
      ...criteria.map((c) => c.obligation),
    ].sort(),
    criteria,
  }) as ItemSpecification;
}

export function specHash(specification: ItemSpecification): string {
  return sha256(stableStringify(specification));
}
