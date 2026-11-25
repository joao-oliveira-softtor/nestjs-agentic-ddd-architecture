import { existsSync } from 'node:fs';
import { z } from 'zod';
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import {
  briefFileName,
  firstBriefClash,
  parsePacket,
  renderBrief,
} from '../briefs';
import { sha256, stableStringify } from '../canonical';
import type { ModuleConfig, ResolvedConfig } from '../config';
import { ERROR_CODES, type ErrorCode } from '../../contracts/codes';
import { DEFAULT_CONVENTIONS } from '../conventions';
import { AgenticError, canonicalPath, toPosix } from '../ir';
import { parseLock, type DomainLock } from '../lock';
import { briefRules, type Rule } from '../rules';
import { renderDelta, type RenderResult } from '../delta/render';
import { validateDelta, type Delta } from '../delta/schema';
import { splice, type Fragment } from '../delta/splice';
import { parseProposal, type AcceptanceCriterion } from '../changes/proposal';
import { analysisSchema, type CandidateAnalysis } from './analysis';
import {
  DEFAULT_TIMEOUT_MS,
  defaultCliEntry,
  quote,
  redact,
  repoTop,
  resolveBase,
  runCandidateCli,
  withWorktree,
} from './candidate';
import { buildNeutral } from './neutral';
import {
  buildManifest,
  byPath,
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
  type NeutralLayer,
  type TargetItem,
  type TargetLayer,
} from './manifest';

export interface BundleInput {
  /** The Delta as received: validated here, against the base commit's lock. */
  readonly delta: unknown;
  /** The project root inside the base git repository (a checkout with its `node_modules`); it need not be the repository top. */
  readonly baseRoot: string;
  /** The project config, absolute or relative to `baseRoot`; it must be committed. Default `<baseRoot>/agentic.config.ts`. */
  readonly configPath?: string;
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

/** A bundle file; every text that feeds a hash is LF. */
const lf = (path: string, content: string): BundleFile => ({
  path,
  content: toLf(content),
});

/** `base/rel`, refusing a result outside `base`. */
export function inside(base: string, rel: string): string {
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

/**
 * The config's path from the repository top (posix): the same file in every worktree of the repo.
 * Refused when it is outside the repository.
 */
export function configInRepo(
  top: string,
  baseRoot: string,
  configPath: string = CONFIG,
): string {
  const rel = toPosix(
    relative(canonicalPath(top), canonicalPath(resolve(baseRoot, configPath))),
  );
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel))
    throw new AgenticError(
      'bundle.config-missing',
      'the project config is not inside the base repository',
    );
  return rel;
}

/** What the base commit gives the candidate: its config, the module to extend and its lock. */
interface Base {
  readonly config: ResolvedConfig;
  readonly rules: readonly Rule[];
  readonly module: ModuleConfig;
  readonly moduleRoot: string;
  /** LF text, as committed: the bundle hashes it. */
  readonly lockText: string;
  readonly lock: DomainLock;
}

/**
 * `path` with symlinks resolved (through its nearest existing ancestor, for a path not yet
 * created), refused with `bundle.path-escape` unless it is inside `top` (or equal, with `same`).
 */
async function realInside(
  top: string,
  path: string,
  same = false,
): Promise<string> {
  let head = resolve(path);
  let tail = '';
  for (;;) {
    const real = await realpath(head).catch(() => null);
    if (real !== null) {
      const full = join(real, tail);
      return same && full === top ? full : inside(top, full);
    }
    tail = join(basename(head), tail);
    if (dirname(head) === head) return inside(top, resolve(path));
    head = dirname(head);
  }
}

/** A child's JSON output, checked once; broken output is a failed step, not a raw parse error. */
function parseChild<T>(schema: z.ZodType<T>, text: string, what: string): T {
  try {
    return schema.parse(JSON.parse(text));
  } catch {
    throw new AgenticError(
      'bundle.compile-failed',
      `${what} of the candidate tree produced malformed output`,
    );
  }
}

/**
 * The `bundle-base` child's output. The config and rules are produced by our own CLI code, so they
 * are typed, not re-validated; the code of a refusal is checked against the known codes.
 */
const baseOutputSchema = z.union([
  z.strictObject({
    error: z.strictObject({
      code: z
        .string()
        .refine((code): code is ErrorCode => Object.hasOwn(ERROR_CODES, code)),
      message: z.string(),
    }),
  }),
  z.strictObject({
    config: z.custom<ResolvedConfig>(
      (v) => typeof v === 'object' && v !== null,
    ),
    rules: z.array(z.custom<Rule>((v) => typeof v === 'object' && v !== null)),
    module: z.custom<ModuleConfig>((v) => typeof v === 'object' && v !== null),
    lockText: z.string(),
  }),
]);

/** Reads the base config in a child process: importing it here would pile up module copies in the server (#177). */
async function loadBase(
  dir: string,
  configRel: string,
  delta: unknown,
  run: { cliEntry: string; remaining: () => number; hide: readonly string[] },
): Promise<Base> {
  if (!existsSync(join(dir, configRel)))
    throw new AgenticError(
      'bundle.config-missing',
      `the project config ${quote(configRel)} is not committed in the base ref`,
    );
  const wanted = (delta as { module?: unknown } | null)?.module;
  const out = join(dir, '.bundle-base.json');
  await runCandidateCli(
    dir,
    run.cliEntry,
    [
      'bundle-base',
      '--config',
      configRel,
      '--module',
      String(wanted),
      '--out',
      out,
    ],
    run.remaining(),
    'base config',
    run.hide,
  );
  const text = await readFile(out, 'utf8').catch(() => {
    throw new AgenticError(
      'bundle.compile-failed',
      'reading the base config produced no result',
    );
  });
  const base = parseChild(baseOutputSchema, text, 'the base config');
  if ('error' in base)
    throw new AgenticError(
      base.error.code,
      redact(base.error.message, [
        [dir, '<candidate>'],
        ...run.hide.map((p): [string, string] => [p, '<base>']),
      ]),
    );
  // The child read candidate-controlled config: what the server writes must stay in the worktree.
  const top = await realpath(dir);
  const root = await realInside(top, base.config.root, true);
  const moduleRoot = await realInside(top, resolve(root, base.module.path));
  await realInside(top, join(base.config.outRoot, base.config.changesDir));
  return {
    ...base,
    moduleRoot,
    lock: parseLock(base.lockText, base.config.out.lock),
  };
}

/** The render result plus the validated Delta it came from, which the neutral layer reads. */
type Rendered = Extract<RenderResult, { ok: true }> & {
  readonly delta: Delta;
};

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
  return { ...rendered, delta: checked.delta };
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

type NumberedProposal = BundleInput['proposal'] & {
  readonly id: string;
  /** Read once, strictly, before anything is compiled. */
  readonly acceptance: readonly AcceptanceCriterion[];
};

/** The acceptance criteria of the proposal, through the strict parser: a parse error is the caller's invalid proposal. */
export function parseAcceptance(
  id: string,
  slug: string,
  markdown: string,
): readonly AcceptanceCriterion[] {
  const dir = `${id}-${slug}`;
  const parsed = parseProposal(markdown, dir, `${dir}/proposal.md`, false);
  if (!parsed.proposal)
    throw new AgenticError(
      'bundle.proposal-invalid',
      `the proposal is invalid: ${quote(parsed.errors.map((e) => e.message).join('; '), 500)}`,
    );
  return parsed.proposal.acceptance;
}

/** Numbers the proposal against the base, validates it and writes it to `changes/<id>-<slug>/` of the candidate. */
async function writeProposal(
  base: Base,
  proposal: BundleInput['proposal'],
): Promise<NumberedProposal> {
  const changesDir = join(base.config.outRoot, base.config.changesDir);
  const id = nextChangeId([
    ...base.lock.changes.map((c) => c.id),
    ...(await readdir(changesDir).catch(() => [])),
  ]);
  const acceptance = parseAcceptance(id, proposal.slug, proposal.markdown);
  const target = inside(changesDir, `${id}-${proposal.slug}/proposal.md`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, proposal.markdown);
  return { ...proposal, id, acceptance };
}

/** Compiles the candidate and analyzes it; candidate code runs only in these children (killable, no network, scrubbed env). */
async function analyzeTree(run: {
  dir: string;
  cliEntry: string;
  remaining: () => number;
  configRel: string;
  /** Server paths that must not reach the client. */
  hide: readonly string[];
  base: Base;
}): Promise<CandidateAnalysis> {
  const { dir, cliEntry, remaining, configRel, hide, base } = run;
  await runCandidateCli(
    dir,
    cliEntry,
    ['compile', '--config', configRel],
    remaining(),
    'compile',
    hide,
  );
  const baseLock = join(dir, '.bundle-base-lock.json');
  await writeFile(baseLock, base.lockText);
  // The child writes its result to a file: its stdout is shared with every module it imports.
  const out = join(dir, '.bundle-analysis.json');
  await runCandidateCli(
    dir,
    cliEntry,
    [
      'bundle-analysis',
      '--config',
      configRel,
      '--base-lock',
      baseLock,
      '--module',
      base.module.name,
      '--out',
      out,
    ],
    remaining(),
    'analysis',
    hide,
  );
  const text = await readFile(out, 'utf8').catch(() => {
    throw new AgenticError(
      'bundle.compile-failed',
      'analysis of the candidate tree produced no result',
    );
  });
  return parseChild(analysisSchema, text, 'the analysis');
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

/** The executor brief of a packet, with the team rules that apply to its file; a brief that cannot be rendered is a coded error. */
function brief(base: Base, packet: string): string {
  try {
    return renderBrief({
      packet,
      rules: briefRules(base.rules, [parsePacket(packet).sourcePath]),
      rulesMaxTokens: base.config.rules.briefMaxTokens,
    });
  } catch (error) {
    if (error instanceof AgenticError) throw error;
    throw new AgenticError('bundle.brief-invalid', (error as Error).message);
  }
}

/** Each item with its packet and executor brief, wave numbers from 1. */
function itemEntries(
  base: Base,
  analysis: CandidateAnalysis,
): {
  items: TargetItem[];
  files: BundleFile[];
} {
  const clash = firstBriefClash(analysis.items.map((i) => i.id));
  if (clash)
    throw new AgenticError(
      'bundle.brief-invalid',
      `items ${quote(clash.id)} and ${quote(clash.other)} would share the file ${clash.name}`,
    );
  const waveOf = new Map(
    analysis.waves.flatMap((wave, w) => wave.map((id) => [id, w + 1])),
  );
  const files: BundleFile[] = [];
  const items = analysis.items.map((item): TargetItem => {
    const name = briefFileName(item.id);
    files.push(
      lf(`target/packets/${name}`, item.packet),
      lf(`target/briefs/${name}`, brief(base, item.packet)),
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
  const entries = itemEntries(base, analysis);
  const neutral = buildNeutral({
    delta: rendered.delta,
    acceptance: proposal.acceptance,
    base: base.lock.ir,
    items: entries.items.map(({ id, layer, wave }) => ({ id, layer, wave })),
  });
  const files = [
    ...skeleton.files,
    lf(
      `target/changes/${proposal.id}-${proposal.slug}/proposal.md`,
      proposal.markdown,
    ),
    ...(await devSkillFiles(base)),
    ...entries.files,
    ...neutral.files.map((f) => lf(f.path, f.content)),
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
        neutral: neutral.layer,
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
  const top = await repoTop(input.baseRoot);
  const configRel = configInRepo(top, input.baseRoot, input.configPath);
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
      const hide = [input.baseRoot, top];
      const base = await loadBase(dir, configRel, input.delta, {
        cliEntry,
        remaining,
        hide,
      });
      const rendered = await renderOnBase(input.delta, base);
      await writeRendered(base.moduleRoot, rendered);
      const numbered = await writeProposal(base, proposal);
      const analysis = await analyzeTree({
        dir,
        cliEntry,
        remaining,
        configRel,
        hide,
        base,
      });
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
