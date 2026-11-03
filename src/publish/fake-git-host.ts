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
  readonly blobs: Map<string, string>;
  /** Every Authorization header seen. */
  readonly auth: string[];
  /** Answers with this status to any request whose "METHOD path" ends with `match`. */
  failWith: { match: string; status: number; body?: string } | undefined;
}

export function createFakeGitHost(opts: {
  owner: string;
  repo: string;
  defaultBranch?: string;
  token: string;
  existingBranches?: readonly string[];
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
    blobs: new Map(),
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
      if (host.failWith && key.endsWith(host.failWith.match)) {
        const f = host.failWith;
        return json(f.status, { message: f.body ?? 'failure' });
      }
      if (auth !== `Bearer ${opts.token}`)
        return json(401, { message: 'Bad credentials' });
      if (!url.pathname.startsWith(prefix)) return json(404, {});
      const path = url.pathname.slice(prefix.length);
      const body = init?.body ? JSON.parse(init.body) : {};
      if (method === 'GET' && path === '')
        return json(200, { default_branch: base });
      const ref = /^\/git\/ref\/(heads\/.+)$/.exec(path);
      if (method === 'GET' && ref) {
        const s = host.refs.get(ref[1]!);
        return s ? json(200, { object: { sha: s } }) : json(404, {});
      }
      const commit = /^\/git\/commits\/(.+)$/.exec(path);
      if (method === 'GET' && commit)
        return json(200, { tree: { sha: `tree-of-${commit[1]}` } });
      if (method === 'POST' && path === '/git/blobs') {
        const s = sha();
        host.blobs.set(s, body.content);
        return json(201, { sha: s });
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
