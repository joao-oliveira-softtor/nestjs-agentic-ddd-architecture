import type { ModuleAccess } from '../auth/scopes';
import type { DomainLock } from '../compiler/lock';
import { moduleOfPath } from '../contracts/module-path';
import type { Rule } from '../compiler/rules';

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

// More alternatives than any real glob needs: past this the glob is dropped rather than expanded.
const MAX_ALTERNATIVES = 64;

/** `a/{b,c}/d` as `a/b/d` and `a/c/d`; undefined past MAX_ALTERNATIVES. An unbalanced `{` stays literal. */
function expandBraces(glob: string): string[] | undefined {
  const open = glob.indexOf('{');
  if (open === -1) return [glob];
  let depth = 0;
  let close = -1;
  const commas: number[] = [];
  for (let i = open; i < glob.length && close === -1; i++) {
    if (glob[i] === '{') depth++;
    else if (glob[i] === '}') {
      if (--depth === 0) close = i;
    } else if (glob[i] === ',' && depth === 1) commas.push(i);
  }
  if (close === -1) return [glob];
  const head = glob.slice(0, open);
  const tail = glob.slice(close + 1);
  const out: string[] = [];
  let from = open + 1;
  for (const end of [...commas, close]) {
    const rest = expandBraces(head + glob.slice(from, end) + tail);
    if (!rest || out.push(...rest) > MAX_ALTERNATIVES) return undefined;
    from = end + 1;
  }
  return out;
}

/**
 * The rules a token with `access` may be shown, with `paths` cut to the globs that name no module it
 * cannot read: each glob is brace-expanded and an alternative is dropped when it contains the name or
 * the path of a hidden module (a plain substring, so it may drop a glob that only looks similar).
 * A glob that names no module (`**\/*.ts`, `test/**`) stays. A rule left with no glob is dropped.
 */
export function narrowRuleGlobs(
  rules: readonly Rule[],
  fullLock: DomainLock,
  access: ModuleAccess,
): Rule[] {
  if (access === 'all') return [...rules];
  const hidden = fullLock.ir.modules
    .filter((m) => !access.has(m.name))
    .flatMap((m) => [m.name, m.path]);
  return rules.flatMap((rule) => {
    if (rule.paths === null) return [rule];
    const paths = rule.paths
      .flatMap((glob) => expandBraces(glob) ?? [])
      .filter((glob) => !hidden.some((name) => glob.includes(name)));
    return paths.length > 0 ? [{ ...rule, paths }] : [];
  });
}
