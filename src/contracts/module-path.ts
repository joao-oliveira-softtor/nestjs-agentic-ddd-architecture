/** A path as the platform compares it: lower-cased on win32 (case-insensitive file system), as is elsewhere. */
export function pathKey(
  path: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === 'win32' ? path.toLowerCase() : path;
}

/** The one rule for "a posix path is inside a module": equal to its `path`, or under `${path}/` (no I/O). Case-insensitive on win32. */
export function isInModule(
  file: string,
  modulePath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  file = pathKey(file, platform);
  modulePath = pathKey(modulePath, platform);
  return file === modulePath || file.startsWith(`${modulePath}/`);
}

/** The module whose `path` is the longest one containing `file`, whatever the order of `modules`. */
export function moduleOfPath<M extends { readonly path: string }>(
  modules: readonly M[],
  file: string,
): M | undefined {
  let best: M | undefined;
  for (const m of modules) {
    if (isInModule(file, m.path) && (!best || m.path.length > best.path.length))
      best = m;
  }
  return best;
}
