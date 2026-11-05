import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { sha256, stableStringify } from './canonical';
import {
  isResolvedConventions,
  type ResolvedConventions,
} from './conventions';
import { moduleFiles } from './load';
import { parseLock, type DomainLock } from './lock';
import { ruleFiles, type Rule } from './rules';
import { AgenticError, canonicalPath, toPosix, type ErrorCode } from './ir';

export const SNAPSHOT_PATH = '.agentic/mcp/snapshot.json';

export interface McpSnapshot {
  snapshotVersion: 1;
  root: string;
  config: string;
  lock: string;
  rulesDir: string;
  inputsHash: string;
  rules: Rule[];
  conventions: ResolvedConventions;
}

type Locations = Pick<McpSnapshot, 'root' | 'config' | 'lock' | 'rulesDir'>;

const STALE =
  'the code, rules, config or lock changed since the last successful `agentic compile` (or it never ran); run `bun run agentic compile` and try again';

async function fileLines(outRoot: string, files: string[]): Promise<string[]> {
  return Promise.all(
    files.map(async (f) => {
      // The snapshot comes from disk: a device path or FIFO would hang the read.
      if (!(await stat(f)).isFile())
        throw new AgenticError('snapshot.not-file', `${f}: not a file`);
      const text = await readFile(f, 'utf8');
      return `${toPosix(relative(outRoot, f))}\0${sha256(text)}`;
    }),
  );
}

/** Hash of the sources (config, modules, rules); compile computes it before importing them. */
export async function sourceLines(
  outRoot: string,
  s: Omit<Locations, 'lock'>,
  modules: readonly { path: string }[],
): Promise<string[]> {
  // resolve, not join: on another Windows drive, s.root is absolute (D:/...).
  const root = resolve(outRoot, s.root);
  // shortcut: imports from outside the module folders are not in the hash; include them if they become a real problem.
  const rulesAbs = join(root, s.rulesDir);
  return fileLines(outRoot, [
    resolve(outRoot, s.config),
    ...(await moduleFiles(root, modules)),
    ...(await ruleFiles(rulesAbs)).map((f) => join(rulesAbs, f)),
  ]);
}

async function inputsHash(
  outRoot: string,
  s: Locations,
  sources: readonly string[],
  rules: readonly Rule[],
): Promise<string> {
  const lines = [
    ...sources,
    ...(await fileLines(outRoot, [join(outRoot, s.lock)])),
    `rules\0${sha256(stableStringify(rules))}`,
  ];
  return sha256(lines.sort().join('\n'));
}

export async function writeSnapshot(
  outRoot: string,
  fields: Locations & {
    rules: Rule[];
    modules: readonly { path: string }[];
    conventions: ResolvedConventions;
  },
  sources?: readonly string[],
): Promise<void> {
  const { modules, conventions, ...saved } = fields;
  const lines = sources ?? (await sourceLines(outRoot, saved, modules));
  const snapshot: McpSnapshot = {
    snapshotVersion: 1,
    ...saved,
    conventions,
    inputsHash: await inputsHash(outRoot, saved, lines, saved.rules),
  };
  const file = join(outRoot, SNAPSHOT_PATH);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(join(dirname(file), '.gitignore'), '*\n');
  await writeFile(file, stableStringify(snapshot));
}

export async function removeSnapshot(outRoot: string): Promise<void> {
  await rm(join(outRoot, SNAPSHOT_PATH), { force: true });
}

export async function checkSnapshot(given: string): Promise<
  | {
      ok: true;
      lock: DomainLock;
      rules: Rule[];
      conventions: ResolvedConventions;
      root: string;
    }
  | { ok: false; code: ErrorCode; reason: string }
> {
  // With root 8.3 the realpath of the rules would leave the root and the hash would diverge.
  const outRoot = canonicalPath(given);
  const file = join(outRoot, SNAPSHOT_PATH);
  const text = await readFile(file, 'utf8').catch(() => null);
  // The wrong folder is the usual cause of a missing snapshot: the message shows where it looked.
  if (text === null)
    return {
      ok: false,
      code: 'snapshot.missing',
      reason: `no snapshot at ${file}; run \`bun run agentic compile\` at the project root or pass --root with that root`,
    };
  try {
    const s = JSON.parse(text) as McpSnapshot;
    // A snapshot from before conventions were saved is stale: defaults could differ from the generated skills.
    if (s.snapshotVersion !== 1 || !isResolvedConventions(s.conventions))
      return { ok: false, code: 'snapshot.stale', reason: STALE };
    const lock = parseLock(
      await readFile(join(outRoot, s.lock), 'utf8'),
      s.lock,
    );
    const sources = await sourceLines(outRoot, s, lock.ir.modules);
    if ((await inputsHash(outRoot, s, sources, s.rules)) !== s.inputsHash)
      return { ok: false, code: 'snapshot.stale', reason: STALE };
    return {
      ok: true,
      lock,
      rules: s.rules,
      conventions: s.conventions,
      root: resolve(outRoot, s.root),
    };
  } catch {
    return { ok: false, code: 'snapshot.stale', reason: STALE };
  }
}
