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
  /** Per-request timeout in milliseconds (default 30 000). */
  readonly timeoutMs?: number;
}

const API = 'https://api.github.com';
const NUMBER = /^\d{4}$/;
// Same slug shape as the `changes/NNNN-<slug>/` proposal folders (src/compiler/changes/proposal.ts).
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NAME = /^[A-Za-z0-9_.-]+$/;
const TIMEOUT_MS = 30_000;
const MAX_TITLE = 256;
const MAX_BODY = 60_000;
const MAX_FILES = 500;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
// Git metadata, submodule/attribute config and CI workflows: a PR must never touch them.
const GIT_SEGMENTS = new Set([
  '.git',
  '.github',
  '.gitmodules',
  '.gitattributes',
]);
const CONTROL = /[\p{Cc}\p{Cf}\u2028\u2029]+/gu;

// A zero-width joiner after "@" stops GitHub from turning the text into a mention.
export function neutralizeMentions(text: string): string {
  return text.replaceAll('@', '@\u200d');
}

// Caps by code points (never splits a surrogate pair); an "@" costs two because of its joiner.
// The body is rendered by GitHub as markdown and only mentions are neutralized: links, images and HTML are not.
const cap = (text: string, max: number) => {
  let out = '';
  let used = 0;
  for (const ch of text) {
    const cost = ch === '@' ? 2 : 1;
    if (used + cost > max) break;
    used += cost;
    out += ch;
  }
  return neutralizeMentions(out);
};

// The title is also the commit subject: one line, no control characters.
const capTitle = (text: string) =>
  cap(text.replace(CONTROL, ' ').trim(), MAX_TITLE);

const folded = (path: string) => path.normalize('NFC').toLowerCase();

function pathError(path: string, prefixes: readonly string[]): string | null {
  if (path === '' || path.includes('\0') || path.includes('\\'))
    return 'empty, NUL or backslash';
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return 'absolute';
  if (path.split('/').some((s) => s === '' || s === '.' || s === '..'))
    return 'empty, "." or ".." segment';
  if (
    folded(path)
      .split('/')
      // Windows drops trailing dots and spaces, so ".git." is ".git" there.
      .some((s) => GIT_SEGMENTS.has(s.replace(/[. ]+$/, '')))
  )
    return 'git metadata or CI path';
  if (!prefixes.some((p) => path.startsWith(p)))
    return 'outside allowed prefixes';
  return null;
}

// Numbers only: the header values are never echoed as text.
function waitHint(res: Response): string {
  const after = res.headers.get('retry-after') ?? '';
  if (/^\d{1,9}$/.test(after)) return ` (retry after ${after}s)`;
  const reset = res.headers.get('x-ratelimit-reset') ?? '';
  if (/^\d{1,12}$/.test(reset))
    return ` (resets in ${Math.max(0, Number(reset) - Math.floor(Date.now() / 1000))}s)`;
  return '';
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
    const title = capTitle(change.title);
    if (title === '')
      throw new AgenticError(
        'publish.change-invalid',
        'the change title is empty',
      );
    const seen = new Set<string>();
    let total = 0;
    for (const f of change.files) {
      const why = pathError(f.path, this.#opts.allowedPrefixes);
      if (why)
        throw new AgenticError(
          'publish.path-invalid',
          `file path ${JSON.stringify(f.path)} rejected: ${why}`,
        );
      // Case-insensitive: Windows and macOS checkouts would collapse these into one file.
      if (seen.has(folded(f.path)))
        throw new AgenticError(
          'publish.path-invalid',
          `file path ${JSON.stringify(f.path)} rejected: duplicate`,
        );
      seen.add(folded(f.path));
      const bytes = Buffer.byteLength(f.content, 'utf8');
      total += bytes;
      if (bytes > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES)
        throw new AgenticError(
          'publish.change-invalid',
          `file ${JSON.stringify(f.path)} exceeds the size cap (${MAX_FILE_BYTES} bytes per file, ${MAX_TOTAL_BYTES} in total)`,
        );
    }

    const branch = `changes/${change.number}-${change.slug}`;
    const repo = `/repos/${this.#opts.owner}/${this.#opts.repo}`;
    const { default_branch: base } = await this.#call<{
      default_branch: string;
    }>('GET', repo, undefined, 'repository');
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
    // Contents go inline: one request instead of one blob per file. Mode 100644 makes every file regular.
    const tree = change.files.map((f) => ({
      path: f.path,
      mode: '100644',
      type: 'blob',
      content: f.content,
    }));
    const newTree = await this.#call<{ sha: string }>(
      'POST',
      `${repo}/git/trees`,
      { base_tree: baseCommit.tree.sha, tree },
      'tree',
    );
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
    // 422 "Reference already exists": someone created the branch between the check and now.
    if (
      ref.status === 422 &&
      (await this.#message(ref)).includes('Reference already exists')
    )
      throw new AgenticError(
        'publish.branch-exists',
        `branch ${branch} already exists`,
      );
    this.#check(ref, 'branch');
    try {
      const pr = await this.#call<{ html_url: string }>(
        'POST',
        `${repo}/pulls`,
        { title, body: cap(change.body, MAX_BODY), head: branch, base },
        'pull request',
      );
      return { branch, url: pr.html_url };
    } catch (e) {
      throw await this.#cleanup(e, repo, branch);
    }
  }

  /** Removes the ref this publish just created; always returns the error to throw. */
  async #cleanup(
    cause: unknown,
    repo: string,
    branch: string,
  ): Promise<unknown> {
    if (!(cause instanceof AgenticError)) return cause;
    try {
      const res = await this.#send(
        'DELETE',
        `${repo}/git/refs/heads/${branch}`,
        undefined,
      );
      if (!res.ok) throw new Error('delete refused');
    } catch {
      return new AgenticError(
        cause.code,
        `${cause.message}; branch ${branch} was left behind and must be deleted by hand`,
      );
    }
    return new AgenticError(
      cause.code,
      `${cause.message}; branch ${branch} was removed`,
    );
  }

  // Only the "message" field is read, and only to compare; it is never echoed.
  async #message(res: Response): Promise<string> {
    try {
      const m = ((await res.json()) as { message?: unknown }).message;
      return typeof m === 'string' ? m : '';
    } catch {
      return '';
    }
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
    try {
      return (await res.json()) as T;
    } catch {
      throw new AgenticError(
        'publish.host-failed',
        `GitHub ${step} failed: the answer was not JSON`,
      );
    }
  }

  async #send(method: string, path: string, body: unknown): Promise<Response> {
    try {
      return await this.#fetch(`${API}${path}`, {
        method,
        redirect: 'error',
        headers: {
          authorization: `Bearer ${this.#opts.token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
          'user-agent': 'agentic-ddd',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.#opts.timeoutMs ?? TIMEOUT_MS),
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
    if (
      res.status === 429 ||
      (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')
    )
      throw new AgenticError(
        'publish.host-rate-limited',
        `GitHub ${step} was rate-limited: HTTP ${res.status}${waitHint(res)}`,
      );
    const code =
      res.status === 401 || res.status === 403
        ? 'publish.host-denied'
        : 'publish.host-failed';
    throw new AgenticError(code, `GitHub ${step} failed: HTTP ${res.status}`);
  }
}
