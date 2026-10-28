import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { sha256, stableStringify } from './canonical';
import { moduleFiles } from './load';
import { parseLock, type DomainLock } from './lock';
import { ruleFiles, type Rule } from './rules';
import { realRoot, toPosix } from './ir';

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

async function fileLines(outRoot: string, files: string[]): Promise<string[]> {
  return Promise.all(
    files.map(async (f) => {
      // O snapshot vem do disco: caminho para dispositivo ou FIFO travaria a leitura.
      if (!(await stat(f)).isFile()) throw new Error(`${f}: não é arquivo`);
      const text = await readFile(f, 'utf8');
      return `${toPosix(relative(outRoot, f))}\0${sha256(text)}`;
    }),
  );
}

/** Hash das fontes (config, módulos, regras); o compile o calcula antes de importá-las. */
export async function sourceLines(
  outRoot: string,
  s: Omit<Locations, 'lock'>,
  modules: readonly { path: string }[],
): Promise<string[]> {
  // resolve, não join: em outro disco do Windows, s.root é absoluto (D:/...).
  const root = resolve(outRoot, s.root);
  // shortcut: imports de fora das pastas dos módulos não entram no hash; incluir se virar problema real.
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
  fields: Locations & { rules: Rule[]; modules: readonly { path: string }[] },
  sources?: readonly string[],
): Promise<void> {
  const { modules, ...saved } = fields;
  const lines = sources ?? (await sourceLines(outRoot, saved, modules));
  const snapshot: McpSnapshot = {
    snapshotVersion: 1,
    ...saved,
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

export async function checkSnapshot(
  given: string,
): Promise<
  | { ok: true; lock: DomainLock; rules: Rule[]; root: string }
  | { ok: false; reason: string }
> {
  // Com a raiz 8.3 o realpath das regras sairia da raiz e o hash divergiria.
  const outRoot = realRoot(given);
  const file = join(outRoot, SNAPSHOT_PATH);
  const text = await readFile(file, 'utf8').catch(() => null);
  // Pasta errada é o caso comum de snapshot ausente: a mensagem mostra onde procurou.
  if (text === null)
    return {
      ok: false,
      reason: `nenhum snapshot em ${file}; rode \`bun run agentic compile\` na raiz do projeto ou passe --root com essa raiz`,
    };
  try {
    const s = JSON.parse(text) as McpSnapshot;
    if (s.snapshotVersion !== 1) return { ok: false, reason: STALE };
    const lock = parseLock(
      await readFile(join(outRoot, s.lock), 'utf8'),
      s.lock,
    );
    const sources = await sourceLines(outRoot, s, lock.ir.modules);
    if ((await inputsHash(outRoot, s, sources, s.rules)) !== s.inputsHash)
      return { ok: false, reason: STALE };
    return { ok: true, lock, rules: s.rules, root: resolve(outRoot, s.root) };
  } catch {
    return { ok: false, reason: STALE };
  }
}
