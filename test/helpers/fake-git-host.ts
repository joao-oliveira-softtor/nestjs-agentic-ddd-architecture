// Offline stand-in for the GitHub REST endpoints the sink uses; inject `fetch` into the adapter.
export interface FakeGitHost {
  readonly fetch: typeof fetch;
  /** "METHOD path" of every request, in order. */
  readonly requests: string[];
  readonly refs: Map<string, string>;
  readonly pulls: { title: string; body: string; head: string; base: string }[];
  readonly commits: Map<
    string,
    { message: string; tree: string; parents: string[] }
  >;
  readonly trees: Map<string, unknown>;
  /** Known commits (a ref's SHA, or a bundle base) and the files in each one, by path; the default branch head is `sha-base`. */
  readonly history: Map<string, Record<string, string>>;
  /** Extra entries every compare answer lists after the ones computed from `history` (renames, mode-only changes, filler). */
  readonly changed: ComparedFile[];
  /** Every Authorization header seen. */
  readonly auth: string[];
  /** Answers with this status to any request whose "METHOD path" ends with `match`. */
  failWith: Failure | readonly Failure[] | undefined;
}

interface Failure {
  match: string;
  status: number;
  body?: string;
  headers?: Record<string, string>;
}

/** One entry of the compare API's `files` (only the fields the sink reads). */
export interface ComparedFile {
  filename: string;
  status: string;
  previous_filename?: string;
}

// The compare API lists every path that differs between two trees.
function diff(
  from: Record<string, string>,
  to: Record<string, string>,
): ComparedFile[] {
  return [...new Set([...Object.keys(from), ...Object.keys(to)])]
    .filter((p) => from[p] !== to[p])
    .map((filename) => ({
      filename,
      status: !(filename in from)
        ? 'added'
        : !(filename in to)
          ? 'removed'
          : 'modified',
    }));
}

export function createFakeGitHost(opts: {
  owner: string;
  repo: string;
  defaultBranch?: string;
  token: string;
  existingBranches?: readonly string[];
  /** Directory listings the contents endpoint answers with, by repo-relative path; any other path is a 404. */
  dirs?: Readonly<Record<string, readonly string[]>>;
}): FakeGitHost {
  const base = opts.defaultBranch ?? 'main';
  const prefix = `/repos/${opts.owner}/${opts.repo}`;
  let n = 0;
  const sha = () => `sha${String(++n).padStart(4, '0')}`;
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status });
  const host: FakeGitHost = {
    requests: [],
    refs: new Map(),
    pulls: [],
    commits: new Map(),
    trees: new Map(),
    history: new Map([['sha-base', {}]]),
    changed: [],
    auth: [],
    failWith: undefined,
    fetch: (async (
      input: string,
      init?: Omit<RequestInit, 'body'> & { body?: string },
    ) => {
      const url = new URL(input);
      const method = init?.method ?? 'GET';
      const key = `${method} ${url.pathname}`;
      host.requests.push(key);
      const auth = new Headers(init?.headers).get('authorization') ?? '';
      host.auth.push(auth);
      const fails = host.failWith === undefined ? [] : [host.failWith].flat();
      const f = fails.find((x) => key.endsWith(x.match));
      if (f)
        return new Response(JSON.stringify({ message: f.body ?? 'failure' }), {
          status: f.status,
          headers: f.headers,
        });
      if (auth !== `Bearer ${opts.token}`)
        return json(401, { message: 'Bad credentials' });
      if (!url.pathname.startsWith(prefix)) return json(404, {});
      const path = url.pathname.slice(prefix.length);
      const body = init?.body ? JSON.parse(init.body) : {};
      if (method === 'GET' && path === '')
        return json(200, { default_branch: base });
      const dir = /^\/contents\/(.+)$/.exec(path);
      if (method === 'GET' && dir) {
        const names = opts.dirs?.[decodeURIComponent(dir[1]!)];
        return names
          ? json(
              200,
              names.map((name) => ({ name, type: 'dir' })),
            )
          : json(404, {});
      }
      const ref = /^\/git\/ref\/(heads\/.+)$/.exec(path);
      if (method === 'GET' && ref) {
        const s = host.refs.get(ref[1]!);
        return s ? json(200, { object: { sha: s } }) : json(404, {});
      }
      const commit = /^\/git\/commits\/(.+)$/.exec(path);
      if (method === 'GET' && commit)
        return host.history.has(commit[1]!)
          ? json(200, { tree: { sha: `tree-of-${commit[1]}` } })
          : json(404, {});
      const compare = /^\/compare\/(.+)\.\.\.(.+)$/.exec(path);
      if (method === 'GET' && compare) {
        const from = host.history.get(decodeURIComponent(compare[1]!));
        const to = host.history.get(compare[2]!);
        if (!from || !to) return json(404, { message: 'Not Found' });
        // Like GitHub, the files come with the first page only and are capped at 300.
        const first = (url.searchParams.get('page') ?? '1') === '1';
        const files = first ? [...diff(from, to), ...host.changed] : [];
        return json(200, {
          status: files.length === 0 ? 'identical' : 'ahead',
          files: files.slice(0, 300),
        });
      }
      if (method === 'POST' && path === '/git/trees') {
        const s = sha();
        host.trees.set(s, body);
        return json(201, { sha: s });
      }
      if (method === 'POST' && path === '/git/commits') {
        const s = sha();
        host.commits.set(s, body);
        return json(201, { sha: s });
      }
      if (method === 'POST' && path === '/git/refs') {
        const name = String(body.ref).replace(/^refs\//, '');
        if (host.refs.has(name))
          return json(422, { message: 'Reference already exists' });
        host.refs.set(name, body.sha);
        return json(201, { ref: body.ref });
      }
      const del = /^\/git\/refs\/(heads\/.+)$/.exec(path);
      if (method === 'DELETE' && del)
        return host.refs.delete(del[1]!)
          ? new Response(null, { status: 204 })
          : json(404, {});
      if (method === 'POST' && path === '/pulls') {
        host.pulls.push(body);
        return json(201, {
          html_url: `https://github.com/${opts.owner}/${opts.repo}/pull/${host.pulls.length}`,
        });
      }
      return json(404, {});
    }) as typeof fetch,
  };
  host.refs.set(`heads/${base}`, 'sha-base');
  for (const b of opts.existingBranches ?? [])
    host.refs.set(`heads/${b}`, 'sha-old');
  return host;
}
