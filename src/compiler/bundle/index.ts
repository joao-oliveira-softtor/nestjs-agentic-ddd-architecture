import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { renderBrief } from '../briefs';
import { sha256, stableStringify } from '../canonical';
import { loadConfig } from '../config';
import { DEFAULT_CONVENTIONS } from '../conventions';
import { AgenticError, toPosix } from '../ir';
import { parseLock } from '../lock';
import { renderDelta } from '../delta/render';
import { validateDelta } from '../delta/schema';
import { splice } from '../delta/splice';
import { analysisSchema } from './analysis';
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
   * `proposal.md` of the change, written to `changes/<id>-<slug>/` of the candidate and bundled. The
   * number is not the caller's: it is one past the highest of the base lock and the base `changes/`.
   */
  readonly proposal?: {
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

/**
 * Renders the Delta onto a detached worktree of the base commit, compiles that candidate tree and
 * returns a hashed, stateless bundle: nothing is kept after the call, on any path. Each item
 * carries its executor brief; the reviewer brief is generated later, from the diff and gates.
 */
export async function compileBundle(input: BundleInput): Promise<Bundle> {
  const proposal = input.proposal;
  if (proposal && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(proposal.slug))
    throw new AgenticError(
      'bundle.proposal-invalid',
      `proposal slug ${quote(proposal.slug)} is not kebab-case`,
    );
  const sha = await resolveBase(input.baseRoot, input.baseRef);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - Date.now());
  const cliEntry = input.cliEntry ?? defaultCliEntry();
  return withWorktree(
    input.baseRoot,
    join(input.baseRoot, '.tmp'),
    sha,
    2 * timeoutMs,
    async (dir) => {
      const config = await loadConfig(join(dir, CONFIG));
      const wanted = (input.delta as { module?: unknown } | null)?.module;
      const module = config.modules.find((m) => m.name === wanted);
      if (!module)
        throw new AgenticError(
          'bundle.module-unknown',
          `module ${quote(String(wanted))} is not configured in the base project`,
        );
      const moduleRoot = resolve(config.root, module.path);
      // EOL rule: every text that feeds a hash is LF (`toLf`). A checkout may be CRLF
      // (core.autocrlf), but the committed bytes, which `apply` recomputes from, are LF.
      const lockPath = join(config.outRoot, config.out.lock);
      const lockText = await readFile(lockPath, 'utf8')
        .then(toLf)
        .catch(() => null);
      if (lockText === null)
        throw new AgenticError(
          'bundle.base-lock-missing',
          `the base commit has no ${config.out.lock}; run \`agentic compile\` there first`,
        );
      const lock = parseLock(lockText, config.out.lock);

      // One source of truth: the base commit (lock, conventions, `changes/`), never the working copy.
      const checked = validateDelta(input.delta, { base: lock.ir });
      if (!checked.ok)
        throw new AgenticError(
          checked.errors[0]!.code,
          checked.errors
            .slice(0, 10)
            .map((e) => `${e.path}: ${e.message}`)
            .join('; '),
        );
      const rendered = renderDelta(checked.delta, {
        conventions: config.conventions ?? DEFAULT_CONVENTIONS,
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
      const changesDir = join(config.outRoot, config.changesDir);
      const numbered = proposal && {
        ...proposal,
        id: String(
          1 +
            Math.max(
              0,
              ...[
                ...lock.changes.map((c) => c.id),
                ...(await readdir(changesDir).catch(() => [])),
              ].flatMap((n) => {
                const id = /^(\d{4})(-|$)/.exec(n)?.[1];
                return id ? [Number(id)] : [];
              }),
            ),
        ).padStart(4, '0'),
      };
      if (numbered) {
        const target = inside(
          changesDir,
          `${numbered.id}-${numbered.slug}/proposal.md`,
        );
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, numbered.markdown);
      }

      // Candidate code runs only in these children (killable, no network, scrubbed env).
      await runCandidateCli(
        dir,
        cliEntry,
        ['compile', '--config', CONFIG],
        remaining(),
        'compile',
      );
      const baseLock = join(dir, '.bundle-base-lock.json');
      await writeFile(baseLock, lockText);
      const analysis = analysisSchema.parse(
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
      if (numbered)
        add(
          `target/changes/${numbered.id}-${numbered.slug}/proposal.md`,
          numbered.markdown,
        );
      const skillDir = join(
        config.outRoot,
        config.out.devSkills,
        `${module.name}-dev`,
      );
      for (const rel of await filesUnder(skillDir))
        add(`target/dev-skill/${rel}`, await read(join(skillDir, rel)));

      const waveOf = new Map(
        analysis.waves.flatMap((wave, w) => wave.map((id) => [id, w + 1])),
      );
      const items: TargetItem[] = analysis.items.map((item) => {
        const name = fileName(item.id);
        add(`target/packets/${name}`, item.packet);
        add(`target/briefs/${name}`, renderBrief({ packet: item.packet }));
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

      const manifest = buildManifest(
        {
          baseRef: sha,
          baseLockHash: sha256(lockText),
          layers: {
            target: {
              name: 'nestjs-ts',
              waves: analysis.waves,
              items,
              skeleton,
            },
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
