import { join } from 'node:path';
import {
  checkedWrites,
  plan,
  relTo,
  splitBundleEntries,
  verifyBundle,
  writableDirs,
} from '../compiler/bundle/apply';
import { loadConfig, type ResolvedConfig } from '../compiler/config';
import { AgenticError } from '../contracts/codes';
import { canonicalPath } from '../contracts/ir';
import { coversModule } from '../mcp/scope';
import type { ChangeSink, PublishedChange } from './change-sink';
import { GitHubChangeSink } from './github-sink';

export type PublishConfig = Pick<
  ResolvedConfig,
  'root' | 'outRoot' | 'changesDir' | 'modules'
> & { readonly out: Pick<ResolvedConfig['out'], 'lock'> };

/** Where publish_change sends a bundle: the sink, and the project config it was built from (loaded once). */
export interface PublishTarget {
  readonly sink: ChangeSink;
  readonly config: ResolvedConfig;
}

export interface PublishInput {
  /** A bundle as `propose_change` returned it: `hash` and every file, `bundle.json` included. */
  readonly bundle: {
    readonly hash: string;
    readonly files: readonly {
      readonly path: string;
      readonly content: string;
    }[];
  };
  readonly root: string;
  readonly config: PublishConfig;
  /** The modules the token may publish, from `change:publish[:<module>]`. */
  readonly access: 'all' | ReadonlySet<string>;
  readonly sink: ChangeSink;
}

// The Delta's module, as `compileBundle` records it in the hashed neutral model (verified content).
function recordedModule(model: string | undefined): string | undefined {
  try {
    const { module } = JSON.parse(model ?? '') as { module?: unknown };
    return typeof module === 'string' ? module : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Publishes what `agentic apply` would write (skeleton files, the change directory and its
 * `examples.json`) as a branch and pull request. The bundle is untrusted: its hash is recomputed
 * (integrity, not authenticity) and every path must pass the allow-list `apply` uses, narrowed to
 * the modules in `access`, before the sink is called.
 */
export async function publishBundle(
  input: PublishInput,
): Promise<PublishedChange> {
  const { manifestText, files } = splitBundleEntries(input.bundle.files);
  const manifest = verifyBundle(manifestText, files);
  if (manifest.hash !== input.bundle.hash)
    throw new AgenticError(
      'apply.hash-mismatch',
      'the bundle is not intact: the hash sent is not the hash of its files',
    );
  const { config, access } = input;
  // The config paths are canonical (8.3 names expanded); the root must be too for relative paths to agree.
  const root = canonicalPath(input.root);
  if (
    access !== 'all' &&
    !coversModule(access, recordedModule(files.get('neutral/model.json')))
  )
    throw new AgenticError(
      'auth.scope-missing',
      'the change:publish scope for the module of the bundle is needed',
    );
  const changesAbs = join(config.outRoot, config.changesDir);
  const changesRel = relTo(root, changesAbs);
  const { planned, change } = plan(manifest, files, changesRel);
  // A module-scoped grant narrows the module paths; the change directory is always allowed.
  const granted = config.modules.filter((m) => coversModule(access, m.name));
  checkedWrites(
    planned,
    writableDirs(root, { ...config, modules: granted }, changesAbs, change),
  );
  return input.sink.publish({
    number: change.slice(0, 4),
    slug: change.slice(5),
    title: `Change ${change}`,
    changesDir: changesRel,
    baseRef: manifest.baseRef,
    lockPath: relTo(root, join(config.outRoot, config.out.lock)),
    body: `Published from a compiled bundle through the Domain MCP.\n\nBundle hash: ${manifest.hash}\nBase ref: ${manifest.baseRef}\n\nThe hash proves the bundle is unchanged, not who made it: review the files before merging.`,
    files: planned.map((p) => ({ path: p.rel, content: p.content })),
  });
}

// The project's path below the git toplevel (`a/b/`, or `` at the toplevel or outside a repository):
// GitHub paths are relative to the repository, the bundle's to the project.
async function repoPrefix(project: string): Promise<string> {
  const git = Bun.spawn(['git', 'rev-parse', '--show-prefix'], {
    cwd: project,
    stdout: 'pipe',
    stderr: 'ignore',
  });
  const out = await new Response(git.stdout).text();
  return (await git.exited) === 0 ? out.trim() : '';
}

// Maps the project-relative paths of a change to repository-relative ones.
const inRepo = (sink: ChangeSink, prefix: string): ChangeSink =>
  prefix === ''
    ? sink
    : {
        publish: (change) =>
          sink.publish({
            ...change,
            changesDir: prefix + change.changesDir,
            lockPath: prefix + change.lockPath,
            files: change.files.map((f) => ({ ...f, path: prefix + f.path })),
          }),
      };

/**
 * `sinkFromEnv` limited to what a bundle may write in this project (the module paths and the
 * changes directory), with the config it read. Reads the config only when the environment asks
 * for a sink.
 */
export async function publishTargetFromProject(
  root: string,
  configPath: string,
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl?: typeof fetch,
): Promise<PublishTarget | undefined> {
  if (!env.AGENTIC_GITHUB_TOKEN && !env.AGENTIC_GITHUB_REPO) return undefined;
  const config = await loadConfig(configPath);
  const project = canonicalPath(root);
  const prefix = await repoPrefix(project);
  const allowed = writableDirs(
    project,
    config,
    join(config.outRoot, config.changesDir),
    '',
  ).map((d) => `${prefix}${d.endsWith('/') ? d : `${d}/`}`);
  const sink = sinkFromEnv(env, allowed, fetchImpl);
  return sink && { sink: inRepo(sink, prefix), config };
}

/**
 * The GitHub sink from the server environment (`AGENTIC_GITHUB_TOKEN` and `AGENTIC_GITHUB_REPO`
 * as `owner/repo`), or `undefined` when neither is set. The token never comes from a client and
 * is never put in an error.
 */
export function sinkFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  allowedPrefixes: readonly string[],
  fetchImpl?: typeof fetch,
): ChangeSink | undefined {
  const token = env.AGENTIC_GITHUB_TOKEN ?? '';
  const repo = env.AGENTIC_GITHUB_REPO ?? '';
  if (token === '' && repo === '') return undefined;
  const [owner = '', name = '', ...extra] = repo.split('/');
  if (extra.length > 0)
    throw new AgenticError(
      'publish.config-invalid',
      'AGENTIC_GITHUB_REPO must be owner/repo',
    );
  return new GitHubChangeSink({
    token,
    owner,
    repo: name,
    allowedPrefixes,
    fetch: fetchImpl,
  });
}
