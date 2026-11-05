/** The 8.3 short name of an existing folder on Windows (`RUNNER~1`-style); the path itself elsewhere. */
export function shortPath(dir: string): string {
  if (process.platform !== 'win32') return dir;
  return Bun.spawnSync([
    'powershell',
    '-NoProfile',
    '-Command',
    `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${dir}').ShortPath`,
  ])
    .stdout.toString()
    .trim();
}
