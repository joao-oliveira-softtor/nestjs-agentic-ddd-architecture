// shortcut: shortPath spawns a cold PowerShell (seconds on a CI Windows runner), more than bun's 5 s default with the test's own work; raise it if the runner gets slower.
export const SHORT_PATH_TEST_TIMEOUT_MS = 30_000;

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
