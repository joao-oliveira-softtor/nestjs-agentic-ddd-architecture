import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { renderBrief } from '../briefs';
import { sha256, stableStringify } from '../canonical';
import { loadConfig, type ModuleConfig, type ResolvedConfig } from '../config';
import { DEFAULT_CONVENTIONS } from '../conventions';
import { AgenticError, toPosix } from '../ir';
import { parseLock, type DomainLock } from '../lock';
import { renderDelta, type RenderResult } from '../delta/render';
import { validateDelta } from '../delta/schema';
import { splice, type Fragment } from '../delta/splice';
import { analysisSchema, type CandidateAnalysis } from './analysis';
import {
  DEFAULT_TIMEOUT_MS,
  defaultCliEntry,
  quote,
  resolveBase,
  runCandidateCli,
  withWorktree,
} from './candidate';
import {
  buildManifest,
  renderBundleMd,
  toLf,
  type BundleFile,
  type BundleManifest,
  type TargetItem,
} from './manifest';

export {
  BUNDLE_VERSION,
  type BundleFile,
  type BundleManifest,
  type TargetItem,
  type TargetLayer,
} from './manifest';

export interface BundleInput {
  /** The Delta as received: validated here, against the base commit's lock. */
  readonly delta: unknown;
  /** The base git repository (a checkout with its `node_modules`). */
  readonly baseRoot: string;
  /** Any ref that resolves to a commit; the bundle records the full commit id. */
  readonly baseRef: string;
  /**
   * `proposal.md` of the change, written to `changes/<id>-<slug>/` of the candidate and bundled: the
   * bundle always carries one, because `apply` takes its change directory from it. The number is not
   * the caller's: it is one past the highest of the base lock and the base `changes/`.
   */
  readonly proposal: {
    readonly slug: string;
    readonly markdown: string;
  };
  /** Limit for the whole call: candidate compile and analysis share it (children are killed). Default 120 s. */
  readonly timeoutMs?: number;
  /** TEST-ONLY: replaces the CLI entry the children run, to simulate slow or failing candidates. */
  readonly cliEntry?: string;
}

export interface Bundle {
  readonly manifest: BundleManifest;
  readonly hash: string;
  /** Every file, including `BUNDLE.md` and `bundle.json`; sorted by path. */
  readonly files: readonly BundleFile[];
}

const CONFIG = 'agentic.config.ts';

const byPath = (a: { path: string }, b: { path: string }): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

const fileName = (id: string): string =>
  `${id.replaceAll(/[^a-zA-Z0-9_]+/g, '-')}.md`;

/** A bundle file; every text that feeds a hash is LF. */
const lf = (path: string, content: string): BundleFile => ({
  path,
  content: toLf(content),
});

/** `base/rel`, refusing a result outside `base`. */
function inside(base: string, rel: string): string {
  const abs = resolve(base, rel);
  const back = relative(base, abs);
  if (back === '' || back.startsWith('..') || isAbsolute(back))
    throw new AgenticError(
      'bundle.path-escape',
      `path ${quote(rel)} resolves outside its directory`,
    );
  return abs;
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => toPosix(relative(dir, join(e.parentPath, e.name))))
    .sort();
}

/** What the base commit gives the candidate: its config, the module to extend and its lock. */
interface Base {
  readonly config: ResolvedConfig;
  readonly module: ModuleConfig;
  readonly moduleRoot: string;
  /** LF text, as committed: the bundle hashes it. */
  readonly lockText: string;
  readonly lock: DomainLock;
}

async function loadBase(dir: string, delta: unknown): Promise<Base> {
  const config = await loadConfig(join(dir, CONFIG));
  const wanted = (delta as { module?: unknown } | null)?.module;
  const module = config.modules.find((m) => m.name === wanted);
  if (!module)
    throw new AgenticError(
      'bundle.module-unknown',
      `module ${quote(String(wanted))} is not configured in the base project`,
    );
  // EOL rule: every text that feeds a hash is LF (`toLf`). A checkout may be CRLF
  // (core.autocrlf), but the committed bytes, which `apply` recomputes from, are LF.
  const lockText = await readFile(join(config.outRoot, config.out.lock), 'utf8')
    .then(toLf)
    .catch(() => null);
  if (lockText === null)
    throw new AgenticError(
      'bundle.base-lock-missing',
      `the base commit has no ${config.out.lock}; run \`agentic compile\` there first`,
    );
  return {
    config,
    module,
    moduleRoot: resolve(config.root, module.path),
    lockText,
    lock: parseLock(lockText, config.out.lock),
  };
}

type Rendered = Extract<RenderResult, { ok: true }>;

/** One source of truth: the base commit (lock, conventions, `changes/`), never the working copy. */
async function renderOnBase(delta: unknown, base: Base): Promise<Rendered> {
  const checked = validateDelta(delta, { base: base.lock.ir });
  if (!checked.ok)
    throw new AgenticError(
      checked.errors[0]!.code,
      checked.errors
        .slice(0, 10)
        .map((e) => `${e.path}: ${e.message}`)
        .join('; '),
    );
  const rendered = renderDelta(checked.delta, {
    conventions: base.config.conventions ?? DEFAULT_CONVENTIONS,
    base: base.lock.ir,
    existingFiles: await filesUnder(base.moduleRoot),
  });
  if (!rendered.ok)
    throw new AgenticError(
      'bundle.delta-invalid',
      `the Delta does not render against the base: ${quote(JSON.stringify(rendered.errors), 4000)}`,
    );
  return rendered;
}

async function extendFile(
  moduleRoot: string,
  fragment: Fragment,
): Promise<void> {
  const target = inside(moduleRoot, fragment.path);
  const source = await readFile(target, 'utf8').catch(() => {
    throw new AgenticError(
      'delta.splice-anchor-missing',
      `the file to extend, ${quote(fragment.path)}, does not exist in the base`,
    );
  });
  const spliced = splice(source, fragment);
  if (!spliced.ok)
    throw new AgenticError(spliced.error.code, spliced.error.message);
  await writeFile(target, spliced.source);
}

/** New files first, then the fragments spliced into the existing ones. */
async function writeRendered(
  moduleRoot: string,
  rendered: Rendered,
): Promise<void> {
  for (const f of rendered.files) {
    const target = inside(moduleRoot, f.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, f.content);
  }
  for (const fragment of rendered.fragments)
    await extendFile(moduleRoot, fragment);
}

/** One past the highest `NNNN` among the names (change ids and `changes/` entries), as `NNNN`. */
export function nextChangeId(names: readonly string[]): string {
  const used = names.flatMap((n) => {
    const id = /^(\d{4})(-|$)/.exec(n)?.[1];
    return id ? [Number(id)] : [];
  });
  return String(1 + Math.max(0, ...used)).padStart(4, '0');
}

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

type NumberedProposal = BundleInput['proposal'] & { readonly id: string };

/** Numbers the proposal against the base and writes it to `changes/<id>-<slug>/` of the candidate. */
async function writeProposal(
  base: Base,
  proposal: BundleInput['proposal'],
): Promise<NumberedProposal> {
  const changesDir = join(base.config.outRoot, base.config.changesDir);
  const id = nextChangeId([
    ...base.lock.changes.map((c) => c.id),
    ...(await readdir(changesDir).catch(() => [])),
  ]);
  const target = inside(changesDir, `${id}-${proposal.slug}/proposal.md`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, proposal.markdown);
  return { ...proposal, id };
}

/** Compiles the candidate and analyzes it; candidate code runs only in these children (killable, no network, scrubbed env). */
async function analyzeTree(
  dir: string,
  cliEntry: string,
  remaining: () => number,
  baseLockText: string,
): Promise<CandidateAnalysis> {
  await runCandidateCli(
    dir,
    cliEntry,
    ['compile', '--config', CONFIG],
    remaining(),
    'compile',
  );
  const baseLock = join(dir, '.bundle-base-lock.json');
  await writeFile(baseLock, baseLockText);
  return analysisSchema.parse(
    JSON.parse(
      await runCandidateCli(
        dir,
        cliEntry,
        ['bundle-analysis', '--config', CONFIG, '--base-lock', baseLock],
        remaining(),
        'analysis',
      ),
    ),
  );
}

/** The rendered files and fragments, as full contents of the candidate. */
async function skeletonFiles(
  base: Base,
  rendered: Rendered,
): Promise<{ skeleton: string[]; files: BundleFile[] }> {
  const paths = [
    ...new Set([
      ...rendered.files.map((f) => f.path),
      ...rendered.fragments.map((f) => f.path),
    ]),
  ].sort();
  const skeleton = paths.map((rel) => `${toPosix(base.module.path)}/${rel}`);
  const files = await Promise.all(
    paths.map(async (rel, i) =>
      lf(
        `target/skeleton/${skeleton[i]}`,
        await readFile(join(base.moduleRoot, rel), 'utf8'),
      ),
    ),
  );
  return { skeleton, files };
}

async function devSkillFiles(base: Base): Promise<BundleFile[]> {
  const dir = join(
    base.config.outRoot,
    base.config.out.devSkills,
    `${base.module.name}-dev`,
  );
  return Promise.all(
    (await filesUnder(dir)).map(async (rel) =>
      lf(`target/dev-skill/${rel}`, await readFile(join(dir, rel), 'utf8')),
    ),
  );
}

/** Each item with its packet and executor brief, wave numbers from 1. */
function itemEntries(analysis: CandidateAnalysis): {
  items: TargetItem[];
  files: BundleFile[];
} {
  const waveOf = new Map(
    analysis.waves.flatMap((wave, w) => wave.map((id) => [id, w + 1])),
  );
  const files: BundleFile[] = [];
  const items = analysis.items.map((item): TargetItem => {
    const name = fileName(item.id);
    files.push(
      lf(`target/packets/${name}`, item.packet),
      lf(`target/briefs/${name}`, renderBrief({ packet: item.packet })),
    );
    return {
      id: item.id,
      layer: item.layer,
      wave: waveOf.get(item.id)!,
      state: item.state,
      specHash: item.specHash,
      packet: `target/packets/${name}`,
      brief: `target/briefs/${name}`,
    };
  });
  return { items, files };
}

/** The manifest, its hash and every file, from what the candidate produced. */
async function assemble(parts: {
  baseRef: string;
  base: Base;
  rendered: Rendered;
  proposal: NumberedProposal;
  analysis: CandidateAnalysis;
}): Promise<Bundle> {
  const { base, rendered, proposal, analysis } = parts;
  const skeleton = await skeletonFiles(base, rendered);
  const entries = itemEntries(analysis);
  const files = [
    ...skeleton.files,
    lf(
      `target/changes/${proposal.id}-${proposal.slug}/proposal.md`,
      proposal.markdown,
    ),
    ...(await devSkillFiles(base)),
    ...entries.files,
  ];
  const manifest = buildManifest(
    {
      baseRef: parts.baseRef,
      baseLockHash: sha256(base.lockText),
      layers: {
        target: {
          name: 'nestjs-ts',
          waves: analysis.waves,
          items: entries.items,
          skeleton: skeleton.skeleton,
        },
      },
      examples: rendered.examples,
    },
    files,
  );
  files.push(
    lf('bundle.json', stableStringify(manifest)),
    lf('BUNDLE.md', renderBundleMd(manifest)),
  );
  return { manifest, hash: manifest.hash, files: files.sort(byPath) };
}

/**
 * Renders the Delta onto a detached worktree of the base commit, compiles that candidate tree and
 * returns a hashed, stateless bundle: nothing is kept after the call, on any path. Each item
 * carries its executor brief; the reviewer brief is generated later, from the diff and gates.
 */
export async function compileBundle(input: BundleInput): Promise<Bundle> {
  const { proposal } = input;
  if (!KEBAB_CASE.test(proposal.slug))
    throw new AgenticError(
      'bundle.proposal-invalid',
      `proposal slug ${quote(proposal.slug)} is not kebab-case`,
    );
  const baseRef = await resolveBase(input.baseRoot, input.baseRef);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - Date.now());
  const cliEntry = input.cliEntry ?? defaultCliEntry();
  return withWorktree(
    input.baseRoot,
    join(input.baseRoot, '.tmp'),
    baseRef,
    2 * timeoutMs,
    async (dir) => {
      const base = await loadBase(dir, input.delta);
      const rendered = await renderOnBase(input.delta, base);
      await writeRendered(base.moduleRoot, rendered);
      const numbered = await writeProposal(base, proposal);
      const analysis = await analyzeTree(
        dir,
        cliEntry,
        remaining,
        base.lockText,
      );
      return assemble({
        baseRef,
        base,
        rendered,
        proposal: numbered,
        analysis,
      });
    },
  );
}
