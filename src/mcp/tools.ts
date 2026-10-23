import type { DomainLock } from '../compiler/lock';
import { rulesFor, type Rule } from '../compiler/rules';
import type { IREntity, IRMethod } from '../contracts/ir';

type Finder = (lock: DomainLock, id: string) => object | undefined;

const usedBy = (lock: DomainLock, methodId: string): string[] =>
  lock.ir.useCases
    .filter((u) => u.uses.includes(methodId))
    .map((u) => u.id)
    .sort();

const findMethod = (
  lock: DomainLock,
  id: string,
): { entity: IREntity; method: IRMethod } | undefined => {
  for (const entity of lock.ir.entities) {
    const method = entity.methods.find((m) => m.id === id);
    if (method) return { entity, method };
  }
  return undefined;
};

const FINDERS: Readonly<Record<string, Finder>> = {
  entity: (lock, id) => {
    const entity = lock.ir.entities.find((e) => e.id === id);
    if (!entity) return undefined;
    return {
      ...entity,
      methods: entity.methods.map((m) => ({
        ...m,
        usedBy: usedBy(lock, m.id),
      })),
    };
  },
  method: (lock, id) => {
    const found = findMethod(lock, id);
    if (!found) return undefined;
    return {
      ...found.method,
      entity: found.entity.id,
      invariants: found.entity.invariants.filter((i) => i.on === id),
      usedBy: usedBy(lock, id),
    };
  },
  invariant: (lock, id) => {
    const entity = lock.ir.entities.find((e) =>
      e.invariants.some((i) => i.id === id),
    );
    const invariant = entity?.invariants.find((i) => i.id === id);
    if (entity && invariant) return { ...invariant, entity: entity.id };
    for (const useCase of lock.ir.useCases) {
      const useCaseInvariant = useCase.invariants?.find((i) => i.id === id);
      if (useCaseInvariant) return { ...useCaseInvariant, useCase: useCase.id };
    }
    return undefined;
  },
  event: (lock, id) => {
    const event = lock.ir.events.find((e) => e.id === id);
    if (!event) return undefined;
    const emittedBy = [
      ...lock.ir.entities.flatMap((e) => e.methods),
      ...lock.ir.useCases,
    ]
      .filter((x) => x.emits.includes(id))
      .map((x) => x.id)
      .sort();
    return { ...event, emittedBy };
  },
  usecase: (lock, id) => {
    const useCase = lock.ir.useCases.find((u) => u.id === id);
    if (!useCase) return undefined;
    return {
      ...useCase,
      operators: lock.ir.operators
        .filter((o) => o.useCases.includes(id))
        .map((o) => o.id)
        .sort(),
      requiresApprovalBy: lock.ir.operators
        .filter((o) => o.requiresApproval.includes(id))
        .map((o) => o.id)
        .sort(),
    };
  },
  operator: (lock, id) => lock.ir.operators.find((o) => o.id === id),
};

export function overview(lock: DomainLock) {
  return {
    modules: lock.ir.modules.map((m) => {
      const inModule = <T extends { module: string }>(items: T[]) =>
        items.filter((x) => x.module === m.name);
      return {
        name: m.name,
        path: m.path,
        entities: inModule(lock.ir.entities).map((e) => ({
          id: e.id,
          description: e.description,
        })),
        events: inModule(lock.ir.events).map((e) => ({
          id: e.id,
          description: e.description,
        })),
        useCases: inModule(lock.ir.useCases).map((u) => ({
          id: u.id,
          description: u.description,
          whenToUse: u.whenToUse,
        })),
        operators: inModule(lock.ir.operators).map((o) => ({
          id: o.id,
          description: o.description,
        })),
      };
    }),
  };
}

export function element(
  lock: DomainLock,
  id: string,
): { ok: true; value: object } | { ok: false; error: string } {
  const colon = id.indexOf(':');
  const prefix = colon === -1 ? '' : id.slice(0, colon);
  const finder = Object.hasOwn(FINDERS, prefix) ? FINDERS[prefix] : undefined;
  const value = finder?.(lock, id);
  if (value === undefined)
    return {
      ok: false,
      error: `id desconhecido: ${id}; use domain_overview para ver os ids (prefixos: ${Object.keys(FINDERS).join(', ')})`,
    };
  return { ok: true, value };
}

export function changes(lock: DomainLock, id?: string) {
  return {
    changes:
      id === undefined
        ? lock.changes
        : lock.changes.filter((c) => c.items.some((i) => i.id === id)),
  };
}

export function rulesForPath(rules: readonly Rule[], path: string) {
  const normalized = path.replaceAll('\\', '/').replace(/^(\.\/)+/, '');
  return {
    path: normalized,
    rules: rulesFor(rules, [normalized]),
  };
}
