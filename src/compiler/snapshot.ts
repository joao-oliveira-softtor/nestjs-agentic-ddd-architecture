import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { sha256, stableStringify } from './canonical';
import { moduleFiles } from './load';
import { parseLock, type DomainLock } from './lock';
import { ruleFiles, type Rule } from './rules';
import { toPosix } from './ir';

export const SNAPSHOT_PATH = '.agentic/mcp/snapshot.json';

export interface McpSnapshot {
  snapshotVersion: 1;
  root: string;
  config: string;
  lock: string;
  rulesDir: string;
  inputsHash: string;
  rules: Rule[];
}

type Locations = Pick<McpSnapshot, 'root' | 'config' | 'lock' | 'rulesDir'>;

const STALE =
  'o código, as regras, o config ou o lock mudaram desde o último `agentic compile` bem-sucedido (ou ele nunca rodou); rode `bun run agentic compile` e repita';

export async function inputsHash(
  outRoot: string,
  s: Locations,
  modules: readonly { path: string }[],
): Promise<string> {
  const root = join(outRoot, s.root);
  // shortcut: imports de fora das pastas dos módulos não entram no hash; incluir se virar problema real.
  const rulesAbs = join(root, s.rulesDir);
  const files = [
    join(outRoot, s.config),
    join(outRoot, s.lock),
    ...(await moduleFiles(root, modules)),
    ...(await ruleFiles(rulesAbs)).map((f) => join(rulesAbs, f)),
  ];
  const lines = await Promise.all(
    files.map(async (f) => {
      const text = await readFile(f, 'utf8');
      return `${toPosix(relative(outRoot, f))}\0${sha256(text)}`;
    }),
  );
  return sha256(lines.sort().join('\n'));
}

export async function writeSnapshot(
  outRoot: string,
  fields: Locations & { rules: Rule[] },
): Promise<void> {
  const lock = parseLock(
    await readFile(join(outRoot, fields.lock), 'utf8'),
    fields.lock,
  );
  const snapshot: McpSnapshot = {
    snapshotVersion: 1,
    ...fields,
    inputsHash: await inputsHash(outRoot, fields, lock.ir.modules),
  };
  const file = join(outRoot, SNAPSHOT_PATH);
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(join(file, '..', '.gitignore'), '*\n');
  await writeFile(file, stableStringify(snapshot));
}

export async function removeSnapshot(outRoot: string): Promise<void> {
  await rm(join(outRoot, SNAPSHOT_PATH), { force: true });
}

export async function checkSnapshot(
  outRoot: string,
): Promise<
  { ok: true; lock: DomainLock; rules: Rule[] } | { ok: false; reason: string }
> {
  try {
    const s = JSON.parse(
      await readFile(join(outRoot, SNAPSHOT_PATH), 'utf8'),
    ) as McpSnapshot;
    if (s.snapshotVersion !== 1) return { ok: false, reason: STALE };
    const lock = parseLock(
      await readFile(join(outRoot, s.lock), 'utf8'),
      s.lock,
    );
    if ((await inputsHash(outRoot, s, lock.ir.modules)) !== s.inputsHash)
      return { ok: false, reason: STALE };
    return { ok: true, lock, rules: s.rules };
  } catch {
    return { ok: false, reason: STALE };
  }
}
