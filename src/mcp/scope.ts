import type { ModuleAccess } from '../auth/scopes';
import type { DomainLock } from '../compiler/lock';
import { moduleOfPath } from '../contracts/module-path';
import { rulesFor, type Rule } from '../compiler/rules';

/**
 * The part of `lock` a token with `access` may read: out-of-scope elements are removed and so are
 * the relation ids that point at them. Module names are opaque, compared by exact equality.
 */
export function scopeLock(lock: DomainLock, access: ModuleAccess): DomainLock {
  if (access === 'all') return lock;
  const { ir } = lock;
  const mine = <T extends { module: string }>(xs: T[]) =>
    xs.filter((x) => access.has(x.module));
  const entities = mine(ir.entities);
  const valueObjects = ir.valueObjects && mine(ir.valueObjects);
  const events = mine(ir.events);
  const ports = ir.ports && mine(ir.ports);
  const adapters = ir.adapters && mine(ir.adapters);
  const useCases = mine(ir.useCases);
  const operators = mine(ir.operators);

  const visible = new Set<string>(
    [
      ...entities,
      ...(valueObjects ?? []),
      ...events,
      ...(ports ?? []),
      ...(adapters ?? []),
      ...useCases,
      ...operators,
    ].map((x) => x.id),
  );
  for (const x of [...entities, ...(valueObjects ?? []), ...useCases])
    for (const i of x.invariants ?? []) visible.add(i.id);
  for (const e of entities) for (const m of e.methods) visible.add(m.id);

  const keep = (ids: string[]) => ids.filter((id) => visible.has(id));
  // A required single-id field cannot be removed, so it is blanked.
  const keepOne = (id: string) => (visible.has(id) ? id : '');
  // An optional list stays absent when nothing survives (ADR-0006 D2: never `[]`).
  const optional = <K extends string>(key: K, ids: string[] | undefined) => {
    const kept = ids ? keep(ids) : [];
    return kept.length > 0 ? ({ [key]: kept } as Record<K, string[]>) : {};
  };

  return {
    ...lock,
    ir: {
      ...ir,
      modules: ir.modules.filter((m) => access.has(m.name)),
      entities: entities.map(({ contains, references, ...e }) => ({
        ...e,
        methods: e.methods.map((m) => ({ ...m, emits: keep(m.emits) })),
        ...optional('contains', contains),
        ...optional('references', references),
      })),
      ...(valueObjects && { valueObjects }),
      events,
      ...(ports && {
        ports: ports.map((p) => ({ ...p, root: keepOne(p.root) })),
      }),
      ...(adapters && {
        adapters: adapters.map((a) => ({
          ...a,
          implements: keepOne(a.implements),
        })),
      }),
      useCases: useCases.map(({ ports: usedPorts, ...u }) => ({
        ...u,
        uses: keep(u.uses),
        emits: keep(u.emits),
        ...optional('ports', usedPorts),
      })),
      operators: operators.map((o) => ({
        ...o,
        useCases: keep(o.useCases),
        requiresApproval: keep(o.requiresApproval),
      })),
    },
    // title and summary are free text that may name other modules: one hidden item hides the change.
    changes: lock.changes.filter(
      (c) => c.items.length > 0 && c.items.every((i) => access.has(i.module)),
    ),
  };
}

/** The module whose `path` is the longest posix prefix of `relPath` (equal, or followed by `/`). */
export function pathModule(
  lock: DomainLock,
  relPath: string,
): string | undefined {
  return moduleOfPath(lock.ir.modules, relPath)?.name;
}

/** Rules already matched for `path`, with `paths` cut to the globs that match it: the others may name hidden modules. */
export function narrowRulePaths(rules: readonly Rule[], path: string): Rule[] {
  return rules.map((rule) =>
    rule.paths === null
      ? rule
      : {
          ...rule,
          // The glob matcher is rulesFor's: one single-glob rule per glob.
          paths: rule.paths.filter(
            (glob) => rulesFor([{ ...rule, paths: [glob] }], [path]).length > 0,
          ),
        },
  );
}
