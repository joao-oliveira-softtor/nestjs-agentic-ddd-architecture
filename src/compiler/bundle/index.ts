import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { renderBrief } from '../briefs';
import { sha256, stableStringify } from '../canonical';
import { loadConfig } from '../config';
import { DEFAULT_CONVENTIONS, type ResolvedConventions } from '../conventions';
import { semanticDiff } from '../diff';
import { itemSpecification } from '../item-spec';
import { AgenticError, toPosix } from '../ir';
import { parseLock } from '../lock';
import { renderPacket } from '../packet';
import { collectStatus, stateContext } from '../project-state';
import { changeOwners, waves } from '../state';
import { renderDelta } from '../delta/render';
import type { Delta } from '../delta/schema';
import { splice } from '../delta/splice';
import {
  DEFAULT_TIMEOUT_MS,
  defaultCliEntry,
  quote,
  resolveBase,
  runCompile,
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
  readonly delta: Delta;
  /** The base git repository (a checkout with its `node_modules`). */
  readonly baseRoot: string;
  /** Any ref that resolves to a commit; the bundle records the full commit id. */
  readonly baseRef: string;
  /** Config path relative to the repository root. */
  readonly configPath?: string;
  /** `proposal.md` of the change, written to `changes/<id>-<slug>/` of the candidate and bundled. */
  readonly proposal?: {
    readonly id: string;
    readonly slug: string;
    readonly markdown: string;
  };
  /** Where the temporary worktree lives. Default: `<baseRoot>/.tmp`. */
  readonly workRoot?: string;
  /** Limit for the candidate compile (the child process is killed). Default 120 s. */
  readonly timeoutMs?: number;
  /** The CLI entry that runs `compile`; default is this package's own. */
  readonly cliEntry?: string;
  /** Overrides the conventions of the base config. */
  readonly conventions?: ResolvedConventions;
}

export interface Bundle {
  readonly manifest: BundleManifest;
  readonly hash: string;
  /** Every file, including `BUNDLE.md` and `bundle.json`; sorted by path. */
  readonly files: readonly BundleFile[];
}

const byPath = (a: { path: string }, b: { path: string }): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

const fileName = (id: string): string =>
  `${id.replaceAll(/[^a-zA-Z0-9_]+/g, '-')}.md`;

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

async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new AgenticError(
            'bundle.compile-timeout',
            `analysis of the candidate tree exceeded ${ms} ms`,
          ),
        ),
      ms,
    );
  });
  try {
    return await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Renders the Delta onto a detached worktree of the base commit, compiles that candidate tree and
 * returns a hashed, stateless bundle: nothing is kept after the call, on any path. Each item
 * carries its executor brief; the reviewer brief is generated later, from the diff and gates.
 */
export async function compileBundle(input: BundleInput): Promise<Bundle> {
  const proposal = input.proposal;
  if (
    proposal &&
    !(
      /^\d{4}$/.test(proposal.id) &&
      /^[a-z0-9]+(-[a-z0-9]+)*$/.test(proposal.slug)
    )
  )
    throw new AgenticError(
      'bundle.proposal-invalid',
      `proposal id ${quote(proposal.id)} or slug ${quote(proposal.slug)} is not NNNN and kebab-case`,
    );
  const sha = await resolveBase(input.baseRoot, input.baseRef);
  const configRel = toPosix(input.configPath ?? 'agentic.config.ts');
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return withWorktree(
    input.baseRoot,
    input.workRoot ?? join(input.baseRoot, '.tmp'),
    sha,
    async (dir) => {
      const configPath = join(dir, configRel);
      const config = await loadConfig(configPath);
      const module = config.modules.find((m) => m.name === input.delta.module);
      if (!module)
        throw new AgenticError(
          'bundle.module-unknown',
          `module ${quote(input.delta.module)} is not configured in the base project`,
        );
      const moduleRoot = resolve(config.root, module.path);
      // EOL rule: every text that feeds a hash is LF (`toLf`). A checkout may be CRLF
      // (core.autocrlf), but the committed bytes, which `apply` recomputes from, are LF.
      const lockText = await readFile(
        join(config.outRoot, config.out.lock),
        'utf8',
      )
        .then(toLf)
        .catch(() => null);
      if (lockText === null)
        throw new AgenticError(
          'bundle.base-lock-missing',
          `the base commit has no ${config.out.lock}; run \`agentic compile\` there first`,
        );
      const lock = parseLock(lockText, config.out.lock);

      const rendered = renderDelta(input.delta, {
        conventions:
          input.conventions ?? config.conventions ?? DEFAULT_CONVENTIONS,
        base: lock.ir,
        existingFiles: await filesUnder(moduleRoot),
      });
      if (!rendered.ok)
        throw new AgenticError(
          'bundle.delta-invalid',
          `the Delta does not render against the base: ${quote(JSON.stringify(rendered.errors), 4000)}`,
        );

      for (const f of rendered.files) {
        const target = inside(moduleRoot, f.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, f.content);
      }
      for (const fragment of rendered.fragments) {
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
      if (proposal) {
        const target = inside(
          join(config.outRoot, config.changesDir),
          `${proposal.id}-${proposal.slug}/proposal.md`,
        );
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, proposal.markdown);
      }

      await runCompile(
        dir,
        configPath,
        input.cliEntry ?? defaultCliEntry(),
        timeoutMs,
      );

      const files: BundleFile[] = [];
      const add = (path: string, content: string) =>
        files.push({ path, content: toLf(content) });
      const read = (abs: string) => readFile(abs, 'utf8');

      const skeletonPaths = [
        ...new Set([
          ...rendered.files.map((f) => f.path),
          ...rendered.fragments.map((f) => f.path),
        ]),
      ].sort();
      const skeleton: string[] = [];
      for (const rel of skeletonPaths) {
        const repoPath = `${toPosix(module.path)}/${rel}`;
        skeleton.push(repoPath);
        add(`target/skeleton/${repoPath}`, await read(join(moduleRoot, rel)));
      }
      if (proposal)
        add(
          `target/changes/${proposal.id}-${proposal.slug}/proposal.md`,
          proposal.markdown,
        );
      const skillDir = join(
        config.outRoot,
        config.out.devSkills,
        `${module.name}-dev`,
      );
      for (const rel of await filesUnder(skillDir))
        add(`target/dev-skill/${rel}`, await read(join(skillDir, rel)));

      const analysis = await withDeadline(
        (async () => {
          const context = await stateContext(configPath);
          const report = await collectStatus(context, true);
          return { context, report };
        })(),
        timeoutMs,
      );
      const { ir } = analysis.context.project;
      const owners = new Set(
        semanticDiff(lock.ir, ir).flatMap((d) => changeOwners(ir, d.id)),
      );
      const selected = analysis.report.items.filter((i) => owners.has(i.id));
      const order = waves({ ...analysis.report, items: selected }).waves;
      const items: TargetItem[] = order.flatMap((wave, w) =>
        wave.map((id): TargetItem => {
          const item = selected.find((i) => i.id === id)!;
          const text = renderPacket(
            item,
            itemSpecification(ir, item, analysis.context.proposals),
            configRel,
            'static',
          );
          const name = fileName(id);
          add(`target/packets/${name}`, text);
          add(`target/briefs/${name}`, renderBrief({ packet: text }));
          return {
            id,
            layer: item.layer,
            wave: w + 1,
            state: item.baseState,
            specHash: item.specHash,
            packet: `target/packets/${name}`,
            brief: `target/briefs/${name}`,
          };
        }),
      );

      const manifest = buildManifest(
        {
          baseRef: sha,
          baseLockHash: sha256(lockText),
          layers: {
            target: { name: 'nestjs-ts', waves: order, items, skeleton },
          },
          examples: rendered.examples,
        },
        files,
      );
      add('bundle.json', stableStringify(manifest));
      add('BUNDLE.md', renderBundleMd(manifest));
      return { manifest, hash: manifest.hash, files: files.sort(byPath) };
    },
  );
}
