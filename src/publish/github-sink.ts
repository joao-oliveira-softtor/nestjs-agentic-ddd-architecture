import { AgenticError } from '../contracts/codes';
import type {
  ChangeSink,
  PublishableChange,
  PublishedChange,
} from './change-sink';

export interface GitHubSinkOptions {
  /** Server-side secret. Never read from the client, never logged, never put in an error. */
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
  /** POSIX prefixes a published file may live under, e.g. `changes/` or a module path. */
  readonly allowedPrefixes: readonly string[];
  readonly fetch?: typeof fetch;
}

const API = 'https://api.github.com';
const NUMBER = /^\d{4}$/;
// Same slug shape as the `changes/NNNN-<slug>/` proposal folders (src/compiler/changes/proposal.ts).
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NAME = /^[A-Za-z0-9_.-]+$/;
const PROTECTED = new Set(['main', 'master']);
const MAX_TITLE = 256;
const MAX_BODY = 60_000;
const MAX_FILES = 500;

// A zero-width joiner after "@" stops GitHub from turning the text into a mention.
export function neutralizeMentions(text: string): string {
  return text.replaceAll('@', '@‍');
}

const cap = (text: string, max: number) =>
  neutralizeMentions(text.slice(0, max));

function pathError(path: string, prefixes: readonly string[]): string | null {
  if (path === '' || path.includes('\0') || path.includes('\\'))
    return 'empty, NUL or backslash';
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return 'absolute';
  if (path.split('/').some((s) => s === '' || s === '.' || s === '..'))
    return 'empty, "." or ".." segment';
  if (!prefixes.some((p) => path.startsWith(p)))
    return 'outside allowed prefixes';
  return null;
}

export class GitHubChangeSink implements ChangeSink {
  readonly #opts: GitHubSinkOptions;
  readonly #fetch: typeof fetch;

  constructor(opts: GitHubSinkOptions) {
    const bad =
      !opts.token ||
      !NAME.test(opts.owner) ||
      !NAME.test(opts.repo) ||
      opts.allowedPrefixes.length === 0 ||
      opts.allowedPrefixes.some(
        (p) => !p.endsWith('/') || pathError(`${p}x`, [p]) !== null,
      );
    if (bad)
      throw new AgenticError(
        'publish.config-invalid',
        'invalid GitHub sink configuration',
      );
    this.#opts = opts;
    this.#fetch = opts.fetch ?? fetch;
  }

  async publish(change: PublishableChange): Promise<PublishedChange> {
    if (!NUMBER.test(change.number) || !SLUG.test(change.slug))
      throw new AgenticError(
        'publish.change-invalid',
        'change number must be four digits and the slug kebab-case',
      );
    if (change.files.length === 0 || change.files.length > MAX_FILES)
      throw new AgenticError(
        'publish.path-invalid',
        `a change carries between 1 and ${MAX_FILES} files`,
      );
    for (const f of change.files) {
      const why = pathError(f.path, this.#opts.allowedPrefixes);
      if (why)
        throw new AgenticError(
          'publish.path-invalid',
          `file path ${JSON.stringify(f.path)} rejected: ${why}`,
        );
    }

    const branch = `changes/${change.number}-${change.slug}`;
    const repo = `/repos/${this.#opts.owner}/${this.#opts.repo}`;
    const { default_branch: base } = await this.#call<{
      default_branch: string;
    }>('GET', repo, undefined, 'repository');
    if (PROTECTED.has(branch) || branch === base)
      throw new AgenticError(
        'publish.branch-protected',
        'refusing to target the default branch',
      );
    const head = await this.#call<{ object: { sha: string } }>(
      'GET',
      `${repo}/git/ref/heads/${base}`,
      undefined,
      'base ref',
    );
    if (await this.#exists(`${repo}/git/ref/heads/${branch}`))
      throw new AgenticError(
        'publish.branch-exists',
        `branch ${branch} already exists`,
      );
    const baseCommit = await this.#call<{ tree: { sha: string } }>(
      'GET',
      `${repo}/git/commits/${head.object.sha}`,
      undefined,
      'base commit',
    );
    const tree: { path: string; mode: string; type: string; sha: string }[] =
      [];
    for (const f of change.files) {
      const blob = await this.#call<{ sha: string }>(
        'POST',
        `${repo}/git/blobs`,
        { content: f.content, encoding: 'utf-8' },
        'blob',
      );
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const newTree = await this.#call<{ sha: string }>(
      'POST',
      `${repo}/git/trees`,
      { base_tree: baseCommit.tree.sha, tree },
      'tree',
    );
    const title = cap(change.title, MAX_TITLE);
    const commit = await this.#call<{ sha: string }>(
      'POST',
      `${repo}/git/commits`,
      { message: title, tree: newTree.sha, parents: [head.object.sha] },
      'commit',
    );
    const ref = await this.#send('POST', `${repo}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: commit.sha,
    });
    // 422 on create: someone created the branch between the check and now.
    if (ref.status === 422)
      throw new AgenticError(
        'publish.branch-exists',
        `branch ${branch} already exists`,
      );
    this.#check(ref, 'branch');
    const pr = await this.#call<{ html_url: string }>(
      'POST',
      `${repo}/pulls`,
      { title, body: cap(change.body, MAX_BODY), head: branch, base },
      'pull request',
    );
    return { branch, url: pr.html_url };
  }

  async #exists(path: string): Promise<boolean> {
    const res = await this.#send('GET', path, undefined);
    if (res.status === 404) return false;
    this.#check(res, 'branch lookup');
    return true;
  }

  async #call<T>(
    method: string,
    path: string,
    body: unknown,
    step: string,
  ): Promise<T> {
    const res = await this.#send(method, path, body);
    this.#check(res, step);
    return (await res.json()) as T;
  }

  async #send(method: string, path: string, body: unknown): Promise<Response> {
    try {
      return await this.#fetch(`${API}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.#opts.token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
          'user-agent': 'agentic-ddd',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      // The cause is dropped on purpose: it could echo request details.
      throw new AgenticError(
        'publish.host-unreachable',
        'the Git host could not be reached',
      );
    }
  }

  #check(res: Response, step: string): void {
    if (res.ok) return;
    const code =
      res.status === 401 || res.status === 403
        ? 'publish.host-denied'
        : 'publish.host-failed';
    throw new AgenticError(code, `GitHub ${step} failed: HTTP ${res.status}`);
  }
}
