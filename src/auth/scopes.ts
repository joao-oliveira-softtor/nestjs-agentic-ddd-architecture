// Scope grammar (ADR-0007 D4): `<capability>[:<module>]`; the bare capability covers every module.
export type ModuleAccess = 'all' | ReadonlySet<string>;

/** What `scopes` grant for `capability`: `undefined` when nothing, `'all'`, or the named modules. */
export function moduleAccess(
  scopes: readonly string[],
  capability: string,
): ModuleAccess | undefined {
  if (scopes.includes(capability)) return 'all';
  const prefix = `${capability}:`;
  const modules = scopes
    .filter((scope) => scope.startsWith(prefix))
    .map((scope) => scope.slice(prefix.length))
    .filter((module) => module !== '' && !module.includes(':'));
  return modules.length > 0 ? new Set(modules) : undefined;
}

export const grants = (
  scopes: readonly string[],
  capability: string,
): boolean => moduleAccess(scopes, capability) !== undefined;
