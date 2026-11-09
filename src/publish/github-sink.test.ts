import { describe, expect, test } from 'bun:test';
import { AgenticError } from '../contracts/codes';
import { createFakeGitHost } from '../../test/helpers/fake-git-host';
import { GitHubChangeSink } from './github-sink';

const TOKEN = 'ghp_SECRET_TOKEN_123';
const change = {
  number: '0007',
  slug: 'refund-window',
  title: 'Add refund window',
  body: 'Body',
  changesDir: 'changes',
  baseRef: 'sha-base',
  lockPath: 'domain.lock.json',
  files: [{ path: 'changes/0007-refund-window/proposal.md', content: '# hi' }],
};

function setup(
  host: {
    defaultBranch?: string;
    existingBranches?: string[];
    dirs?: Record<string, string[]>;
  } = {},
) {
  const fake = createFakeGitHost({
    owner: 'acme',
    repo: 'shop',
    token: TOKEN,
    ...host,
  });
  const sink = new GitHubChangeSink({
    token: TOKEN,
    owner: 'acme',
    repo: 'shop',
    allowedPrefixes: ['changes/', 'examples/orders/'],
    fetch: fake.fetch,
  });
  return { fake, sink };
}

const cpLength = (t: string) => Array.from(t).length;

async function failure(
  p: Promise<unknown>,
): Promise<{ code: string; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AgenticError) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error('expected a rejection');
}

describe('GitHubChangeSink', () => {
  test('opens a pull request from a new changes branch against the default branch', async () => {
    const { fake, sink } = setup({ defaultBranch: 'trunk' });
    const out = await sink.publish(change);
    expect(out).toEqual({
      branch: 'changes/0007-refund-window',
      url: 'https://github.com/acme/shop/pull/1',
    });
    expect(fake.pulls).toEqual([
      {
        title: 'Add refund window',
        body: 'Body',
        head: 'changes/0007-refund-window',
        base: 'trunk',
      },
    ]);
    expect(fake.refs.has('heads/changes/0007-refund-window')).toBe(true);
    expect(fake.refs.get('heads/trunk')).toBe('sha-base');
  });

  test('issues a deterministic request sequence', async () => {
    const { fake, sink } = setup();
    await sink.publish(change);
    const r = '/repos/acme/shop';
    expect(fake.requests).toEqual([
      `GET ${r}`,
      `GET ${r}/contents/changes`,
      `GET ${r}/contents/changes/archive`,
      `GET ${r}/git/ref/heads/main`,
      `GET ${r}/git/ref/heads/changes/0007-refund-window`,
      `GET ${r}/git/commits/sha-base`,
      `POST ${r}/git/trees`,
      `POST ${r}/git/commits`,
      `POST ${r}/git/refs`,
      `POST ${r}/pulls`,
    ]);
  });

  test('sends file contents inline in the tree and never calls the blobs endpoint', async () => {
    const { fake, sink } = setup();
    await sink.publish(change);
    expect(fake.requests.some((q) => q.includes('/git/blobs'))).toBe(false);
    expect([...fake.trees.values()]).toEqual([
      {
        base_tree: 'tree-of-sha-base',
        tree: [
          {
            path: 'changes/0007-refund-window/proposal.md',
            mode: '100644',
            type: 'blob',
            content: '# hi',
          },
        ],
      },
    ]);
  });

  test.each(['  ', '\n', '\u200b'])(
    'refuses an empty title %j before any request',
    async (title) => {
      const { fake, sink } = setup();
      expect((await failure(sink.publish({ ...change, title }))).code).toBe(
        'publish.change-invalid',
      );
      expect(fake.requests).toEqual([]);
    },
  );

  describe('base ref', () => {
    const file = 'examples/orders/domain/order.ts';
    const lock = 'domain.lock.json';
    const based = {
      ...change,
      baseRef: 'sha-old',
      files: [{ path: file, content: 'v1' }],
    };
    const withHistory = (
      head: Record<string, string>,
      old: Record<string, string> = { [file]: 'v1' },
    ) => {
      const s = setup();
      s.fake.history.set('sha-old', old);
      s.fake.history.set('sha-base', head);
      return s;
    };
    const nothingCreated = (fake: { requests: string[] }) =>
      expect(fake.requests.some((r) => r.startsWith('POST'))).toBe(false);
    // The fake host cannot shape a 200 answer or show the query, so the sink gets a fetch that watches or rewrites the compare.
    const sinkOver = (
      fake: { fetch: typeof fetch },
      onCompare: (url: string) => Response | undefined,
    ) =>
      new GitHubChangeSink({
        token: TOKEN,
        owner: 'acme',
        repo: 'shop',
        allowedPrefixes: ['changes/', 'examples/orders/'],
        fetch: ((url: string, init?: RequestInit) =>
          (url.includes('/compare/') ? onCompare(url) : undefined) ??
          fake.fetch(url, init)) as typeof fetch,
      });

    test('publishes when the targets are untouched on the default branch since the base ref', async () => {
      const { fake, sink } = withHistory({ [file]: 'v1', 'other.md': 'moved' });
      await sink.publish(based);
      expect(fake.pulls).toHaveLength(1);
    });

    test('asks the compare API once, with the base ref and the head SHA, and lists no trees', async () => {
      const { fake, sink } = withHistory({ [file]: 'v1' });
      await sink.publish(based);
      const r = '/repos/acme/shop';
      expect(fake.requests.filter((q) => q.includes('/compare/'))).toEqual([
        `GET ${r}/compare/sha-old...sha-base`,
      ]);
      expect(fake.requests.some((q) => q.includes('/git/trees/'))).toBe(false);
    });

    test('asks for one commit only, so the files come back on one small first page', async () => {
      const { fake } = withHistory({ [file]: 'v1' });
      const urls: string[] = [];
      const sink = sinkOver(fake, (u) => {
        urls.push(u);
        return undefined;
      });
      await sink.publish(based);
      expect(urls).toEqual([
        'https://api.github.com/repos/acme/shop/compare/sha-old...sha-base?per_page=1',
      ]);
    });

    test.each([
      ['changed', { [file]: 'v2' }],
      ['deleted', {}],
    ])(
      'refuses a target %s on the default branch since the base ref',
      async (_, head) => {
        const { fake, sink } = withHistory(head);
        const e = await failure(sink.publish(based));
        expect(e.code).toBe('publish.base-mismatch');
        expect(e.message).toContain(file);
        nothingCreated(fake);
      },
    );

    test('refuses a target added on the default branch since the base ref', async () => {
      const { fake, sink } = withHistory({ [file]: 'new' }, {});
      expect((await failure(sink.publish(based))).code).toBe(
        'publish.base-mismatch',
      );
      nothingCreated(fake);
    });

    test('names the first offending file in bundle order', async () => {
      const { sink } = withHistory(
        { 'examples/orders/a.ts': '2', 'examples/orders/b.ts': '2' },
        { 'examples/orders/a.ts': '1', 'examples/orders/b.ts': '1' },
      );
      const files = ['b', 'a'].map((n) => ({
        path: `examples/orders/${n}.ts`,
        content: 'x',
      }));
      const e = await failure(sink.publish({ ...based, files }));
      expect(e.message).toContain('examples/orders/b.ts');
    });

    test('names the real default branch, not "main"', async () => {
      const s = setup({ defaultBranch: 'trunk' });
      s.fake.history.set('sha-old', { [file]: 'v1' });
      s.fake.history.set('sha-base', { [file]: 'v2' });
      const e = await failure(s.sink.publish(based));
      expect(e.message).toContain('on trunk');
      expect(e.message).not.toContain('on main');
    });

    test('refuses when the lock moved on the default branch, though no target did', async () => {
      const { fake, sink } = withHistory(
        { [file]: 'v1', [lock]: 'new' },
        { [file]: 'v1', [lock]: 'old' },
      );
      const e = await failure(sink.publish(based));
      expect(e.code).toBe('publish.base-mismatch');
      expect(e.message).toContain(lock);
      nothingCreated(fake);
    });

    test('refuses a target whose only change is its mode (no content diff)', async () => {
      const { fake, sink } = withHistory({ [file]: 'v1' });
      fake.changed.push({ filename: file, status: 'changed' });
      expect((await failure(sink.publish(based))).code).toBe(
        'publish.base-mismatch',
      );
      nothingCreated(fake);
    });

    test.each([
      [
        'the new name',
        { filename: file, status: 'renamed', previous_filename: 'old.ts' },
      ],
      [
        'the old name',
        { filename: 'moved.ts', status: 'renamed', previous_filename: file },
      ],
    ])('refuses a rename that touches a target by %s', async (_, entry) => {
      const { fake, sink } = withHistory({ [file]: 'v1' });
      fake.changed.push(entry);
      expect((await failure(sink.publish(based))).code).toBe(
        'publish.base-mismatch',
      );
      nothingCreated(fake);
    });

    test('matches case-insensitively: Order.ts added on main blocks a bundle writing order.ts', async () => {
      const { fake, sink } = withHistory(
        { 'examples/orders/domain/Order.ts': 'x' },
        {},
      );
      const e = await failure(sink.publish(based));
      expect(e.code).toBe('publish.base-mismatch');
      nothingCreated(fake);
    });

    test('refuses a base ref the host does not know, whatever else is true', async () => {
      const { fake, sink } = setup();
      const e = await failure(
        sink.publish({ ...change, baseRef: 'never-pushed' }),
      );
      expect(e.code).toBe('publish.base-unknown');
      expect(e.message).toContain('never-pushed');
      nothingCreated(fake);
    });

    test('maps a 422 "No commit found" from the compare to base-unknown too', async () => {
      const { fake, sink } = withHistory({ [file]: 'v1' });
      fake.failWith = {
        match: '/compare/sha-old...sha-base',
        status: 422,
        body: 'No commit found for SHA: sha-old',
      };
      expect((await failure(sink.publish(based))).code).toBe(
        'publish.base-unknown',
      );
      nothingCreated(fake);
    });

    test('keeps a 422 that is not "No commit found" as host-failed', async () => {
      const { fake, sink } = withHistory({ [file]: 'v1' });
      fake.failWith = {
        match: '/compare/sha-old...sha-base',
        status: 422,
        body: 'Validation Failed',
      };
      expect((await failure(sink.publish(based))).code).toBe(
        'publish.host-failed',
      );
    });

    describe('a base with commits the default branch lacks', () => {
      // The fake host has no merge bases: the forward answer is rewritten, the reverse one is computed.
      const diverged = (fake: { fetch: typeof fetch }) =>
        sinkOver(fake, (u) =>
          u.includes('/compare/sha-old...sha-base')
            ? Response.json({ status: 'diverged', files: [] })
            : undefined,
        );

      test('refuses when the base side moved the lock', async () => {
        const { fake } = withHistory(
          { [file]: 'v1', [lock]: 'main' },
          { [file]: 'v1', [lock]: 'branch' },
        );
        const e = await failure(diverged(fake).publish(based));
        expect(e.code).toBe('publish.base-mismatch');
        expect(e.message).toContain('another lock');
        expect(
          fake.requests.filter((q) =>
            q.includes('/compare/sha-base...sha-old'),
          ),
        ).toHaveLength(1);
        nothingCreated(fake);
      });

      test('publishes when neither side touched a target or the lock', async () => {
        const { fake } = withHistory(
          { [file]: 'v1', 'other.md': 'a' },
          { [file]: 'v1', 'other.md': 'b' },
        );
        await diverged(fake).publish(based);
        expect(fake.pulls).toHaveLength(1);
      });
    });

    test.each([
      [500, 'publish.host-failed'],
      [403, 'publish.host-denied'],
    ])(
      'keeps a %s from the compare as the host error it is',
      async (status, code) => {
        const { fake, sink } = withHistory({ [file]: 'v1' });
        fake.failWith = { match: '/compare/sha-old...sha-base', status };
        expect((await failure(sink.publish(based))).code).toBe(code);
      },
    );

    describe('a comparison GitHub cannot list in full', () => {
      const filler = (n: number) =>
        Array.from({ length: n }, (_, i) => ({
          filename: `elsewhere/${i}.txt`,
          status: 'modified',
        }));

      test('refuses with host-failed at the 300-file cap, saying so, when no target is among them', async () => {
        const { fake, sink } = withHistory({ [file]: 'v1' });
        fake.changed.push(...filler(300));
        const e = await failure(sink.publish(based));
        expect(e.code).toBe('publish.host-failed');
        expect(e.message).toContain('too large for GitHub to list');
        nothingCreated(fake);
      });

      test('still names a target that is among the 300 listed', async () => {
        const { fake, sink } = withHistory({ [file]: 'v1' });
        fake.changed.push(...filler(299), {
          filename: file,
          status: 'modified',
        });
        expect((await failure(sink.publish(based))).code).toBe(
          'publish.base-mismatch',
        );
      });

      test('publishes at 299 unrelated files: the list is whole', async () => {
        const { fake, sink } = withHistory({ [file]: 'v1' });
        fake.changed.push(...filler(299));
        await sink.publish(based);
        expect(fake.pulls).toHaveLength(1);
      });
    });

    test.each([
      ['an object without files', '{"status":"ahead"}'],
      ['files that are not a list', '{"files":"x"}'],
      ['a file entry without a name', '{"files":[{"status":"added"}]}'],
      ['a file entry that is null', '{"files":[null]}'],
      ['an error body on a 200', '{"message":"Server Error"}'],
      ['not JSON', '<html>bad gateway</html>'],
    ])('fails closed when the comparison answer is %s', async (_, answer) => {
      const { fake } = withHistory({ [file]: 'v1' });
      const sink = sinkOver(fake, () => new Response(answer));
      const e = await failure(sink.publish(based));
      expect(e.code).toBe('publish.host-failed');
      expect(e.message).toContain('unexpected answer from the host');
      expect(e.message).not.toContain('too large');
      nothingCreated(fake);
    });

    test('keeps the token out of the refusal', async () => {
      const { sink } = withHistory({ [file]: 'v2' });
      expect(JSON.stringify(await failure(sink.publish(based)))).not.toContain(
        TOKEN,
      );
    });
  });

  test('refuses an existing branch and writes nothing', async () => {
    const { fake, sink } = setup({
      existingBranches: ['changes/0007-refund-window'],
    });
    expect((await failure(sink.publish(change))).code).toBe(
      'publish.branch-exists',
    );
    expect(fake.requests.some((r) => r.startsWith('POST'))).toBe(false);
  });

  test('maps a ref-creation race (422) to branch-exists', async () => {
    const { fake, sink } = setup();
    fake.failWith = {
      match: '/git/refs',
      status: 422,
      body: 'Reference already exists',
    };
    expect((await failure(sink.publish(change))).code).toBe(
      'publish.branch-exists',
    );
  });

  test.each([
    'changes/../x',
    'changes/a/../b',
    '/abs',
    'C:/x',
    'changes\\a',
    'changes/a\0b',
    'changes//b',
    'changes/./a',
    '',
    'src/other.ts',
    '../changes/x',
  ])('refuses the file path %j', async (path) => {
    const { fake, sink } = setup();
    const r = await failure(
      sink.publish({ ...change, files: [{ path, content: 'x' }] }),
    );
    expect(r.code).toBe('publish.path-invalid');
    expect(fake.requests).toEqual([]);
  });

  test('refuses a change with no files', async () => {
    const { sink } = setup();
    expect((await failure(sink.publish({ ...change, files: [] }))).code).toBe(
      'publish.path-invalid',
    );
  });

  test('accepts a path under an allowed module prefix', async () => {
    const { sink } = setup();
    const out = await sink.publish({
      ...change,
      files: [{ path: 'examples/orders/domain/x.ts', content: 'x' }],
    });
    expect(out.branch).toBe('changes/0007-refund-window');
  });

  test.each([
    ['7', 'ok'],
    ['0007', 'Bad'],
    ['0007', 'a/b'],
    ['0007', ''],
    ['0007', 'a--b'],
    ['0007', '-a'],
  ])('refuses number %j with slug %j', async (number, slug) => {
    const { fake, sink } = setup();
    expect(
      (await failure(sink.publish({ ...change, number, slug }))).code,
    ).toBe('publish.change-invalid');
    expect(fake.requests).toEqual([]);
  });

  test('never puts the token or the response body in an error', async () => {
    for (const status of [401, 403, 500]) {
      const { fake, sink } = setup();
      fake.failWith = { match: '/git/trees', status, body: `echo ${TOKEN}` };
      const r = await failure(sink.publish(change));
      expect(r.code).toBe(
        status === 500 ? 'publish.host-failed' : 'publish.host-denied',
      );
      expect(r.message).not.toContain(TOKEN);
      expect(r.message).not.toContain('echo');
    }
  });

  test('a rejected token is host-denied', async () => {
    const fake = createFakeGitHost({
      owner: 'acme',
      repo: 'shop',
      token: 'other',
    });
    const sink = new GitHubChangeSink({
      token: TOKEN,
      owner: 'acme',
      repo: 'shop',
      allowedPrefixes: ['changes/'],
      fetch: fake.fetch,
    });
    expect((await failure(sink.publish(change))).code).toBe(
      'publish.host-denied',
    );
  });

  test('a network failure is host-unreachable without the cause or token', async () => {
    const sink = new GitHubChangeSink({
      token: TOKEN,
      owner: 'acme',
      repo: 'shop',
      allowedPrefixes: ['changes/'],
      fetch: (async () => {
        throw new Error(`boom ${TOKEN}`);
      }) as unknown as typeof fetch,
    });
    const r = await failure(sink.publish(change));
    expect(r.code).toBe('publish.host-unreachable');
    expect(r.message).not.toContain(TOKEN);
  });

  test('a request that never answers times out as host-unreachable', async () => {
    const hang = (async (_u: string, init?: RequestInit) =>
      new Promise((_, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(new Error(`aborted ${TOKEN}`)),
        ),
      )) as unknown as typeof fetch;
    const sink = new GitHubChangeSink({
      token: TOKEN,
      owner: 'acme',
      repo: 'shop',
      allowedPrefixes: ['changes/'],
      fetch: hang,
      timeoutMs: 20,
    });
    const r = await failure(sink.publish(change));
    expect(r.code).toBe('publish.host-unreachable');
    expect(r.message).not.toContain(TOKEN);
  });

  test('a timeout during pull request creation still deletes the branch', async () => {
    const fake = createFakeGitHost({
      owner: 'acme',
      repo: 'shop',
      token: TOKEN,
    });
    const sink = new GitHubChangeSink({
      token: TOKEN,
      owner: 'acme',
      repo: 'shop',
      allowedPrefixes: ['changes/'],
      timeoutMs: 50,
      fetch: ((u: string, init?: RequestInit) =>
        u.endsWith('/pulls')
          ? new Promise((_, reject) =>
              init?.signal?.addEventListener('abort', () =>
                reject(new Error('aborted')),
              ),
            )
          : fake.fetch(u, init)) as typeof fetch,
    });
    const r = await failure(sink.publish(change));
    expect(r.code).toBe('publish.host-unreachable');
    expect(r.message).toContain('was removed');
    expect(fake.refs.has('heads/changes/0007-refund-window')).toBe(false);
  });

  test('neutralizes @ mentions in title, body and commit message and caps lengths', async () => {
    const { fake, sink } = setup();
    await sink.publish({
      ...change,
      title: 'cc @octocat ' + 'x'.repeat(400),
      body: 'ping @org/team',
    });
    const pr = fake.pulls[0]!;
    const bare = /@(?!\u200d)/;
    expect(pr.title).not.toMatch(bare);
    expect(pr.title.length).toBeLessThanOrEqual(257);
    expect(pr.body).not.toMatch(bare);
    expect([...fake.commits.values()][0]!.message).not.toMatch(bare);
  });

  test.each([
    { token: '' },
    { owner: 'a/b' },
    { repo: '' },
    { allowedPrefixes: [] },
    { allowedPrefixes: ['../'] },
    { allowedPrefixes: ['changes'] },
    {
      token: `${TOKEN}
`,
    },
    {
      token: `${TOKEN}
`,
    },
    { token: `${TOKEN} x` },
    { token: 'tökén' },
  ])('rejects a bad configuration %j', (bad) => {
    expect(
      () =>
        new GitHubChangeSink({
          token: TOKEN,
          owner: 'a',
          repo: 'b',
          allowedPrefixes: ['changes/'],
          ...bad,
        }),
    ).toThrow(AgenticError);
  });

  test.each([
    ['changes', ['0007-other-slug']],
    ['changes/archive', ['0007-refund-window']],
    ['changes', ['0007']],
  ])(
    'refuses a number already used in %s with publish.change-exists before creating anything',
    async (dir, names) => {
      const { fake, sink } = setup({ dirs: { [dir]: names } });
      expect((await failure(sink.publish(change))).code).toBe(
        'publish.change-exists',
      );
      expect(fake.requests.some((q) => q.startsWith('POST'))).toBe(false);
    },
  );

  test('an answer that is not a directory listing fails closed', async () => {
    const { fake, sink } = setup();
    fake.failWith = { match: '/contents/changes', status: 200 };
    expect((await failure(sink.publish(change))).code).toBe(
      'publish.host-failed',
    );
    expect(fake.requests.some((q) => q.startsWith('POST'))).toBe(false);
  });

  test('a number that only shares a prefix with an existing one is free', async () => {
    const { sink } = setup({
      dirs: {
        changes: ['00070-x', '0008-refund-window'],
        'changes/archive': [],
      },
    });
    expect((await sink.publish(change)).branch).toBe(
      'changes/0007-refund-window',
    );
  });

  test.each([
    'changes/.git/config',
    'changes/.GIT/config',
    'changes/a/.Git/x',
    'changes/.gitmodules',
    'changes/sub/.GitAttributes',
    'changes/.github/workflows/ci.yml',
    'changes/.git./config',
    'changes/.git /config',
    'changes/.github./x.yml',
    'changes/.GIT../config',
  ])('refuses the git-sensitive path %j', async (path) => {
    const { fake, sink } = setup();
    const files = [{ path, content: 'x' }];
    expect((await failure(sink.publish({ ...change, files }))).code).toBe(
      'publish.path-invalid',
    );
    expect(fake.requests).toEqual([]);
  });

  test('refuses .github even when the allowed prefix is a hidden module root', async () => {
    const fake = createFakeGitHost({
      owner: 'acme',
      repo: 'shop',
      token: TOKEN,
    });
    const sink = new GitHubChangeSink({
      token: TOKEN,
      owner: 'acme',
      repo: 'shop',
      allowedPrefixes: ['.hidden/'],
      fetch: fake.fetch,
    });
    const files = [{ path: '.hidden/.github/x.yml', content: 'x' }];
    expect((await failure(sink.publish({ ...change, files }))).code).toBe(
      'publish.path-invalid',
    );
  });

  test('refuses paths that collide when compared case-insensitively', async () => {
    const { fake, sink } = setup();
    const files = [
      { path: 'changes/0007-x/A.md', content: 'a' },
      { path: 'changes/0007-x/a.md', content: 'b' },
    ];
    expect((await failure(sink.publish({ ...change, files }))).code).toBe(
      'publish.path-invalid',
    );
    expect(fake.requests).toEqual([]);
  });

  test.each([
    [''],
    ['./'],
    ['.git/'],
    ['.GIT/'],
    ['.github/'],
    ['.github/workflows/'],
    ['.gitmodules/'],
  ])('rejects the allowed prefix %j', (prefix) => {
    expect(
      () =>
        new GitHubChangeSink({
          token: TOKEN,
          owner: 'a',
          repo: 'b',
          allowedPrefixes: [prefix],
        }),
    ).toThrow(AgenticError);
  });

  test('refuses a file over the per-file cap without echoing its content', async () => {
    const { fake, sink } = setup();
    const files = [
      {
        path: 'changes/0007-x/big.md',
        content: 'SECRETBODY'.repeat(120_000),
      },
    ];
    const r = await failure(sink.publish({ ...change, files }));
    expect(r.code).toBe('publish.change-invalid');
    expect(r.message).toContain('changes/0007-x/big.md');
    expect(r.message).not.toContain('SECRETBODY');
    expect(fake.requests).toEqual([]);
  });

  test('counts UTF-8 bytes, not characters, for the per-file cap', async () => {
    const { sink } = setup();
    const files = [
      { path: 'changes/0007-x/e.md', content: '€'.repeat(400_000) },
    ];
    expect((await failure(sink.publish({ ...change, files }))).code).toBe(
      'publish.change-invalid',
    );
  });

  test('accepts files exactly at the per-file and total caps', async () => {
    const { sink } = setup();
    const files = Array.from({ length: 10 }, (_, i) => ({
      path: `changes/0007-x/f${i}.md`,
      content: 'a'.repeat(1024 * 1024),
    }));
    expect((await sink.publish({ ...change, files })).branch).toBe(
      'changes/0007-refund-window',
    );
  });

  test('accepts exactly 500 files and refuses 501', async () => {
    const files = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        path: `changes/0007-x/f${i}.md`,
        content: 'a',
      }));
    const { sink } = setup();
    expect((await sink.publish({ ...change, files: files(500) })).branch).toBe(
      'changes/0007-refund-window',
    );
    const more = setup();
    expect(
      (await failure(more.sink.publish({ ...change, files: files(501) }))).code,
    ).toBe('publish.path-invalid');
    expect(more.fake.requests).toEqual([]);
  });

  test('refuses a change over the total cap', async () => {
    const { fake, sink } = setup();
    const files = Array.from({ length: 11 }, (_, i) => ({
      path: `changes/0007-x/f${i}.md`,
      content: 'a'.repeat(1024 * 1024),
    }));
    expect((await failure(sink.publish({ ...change, files }))).code).toBe(
      'publish.change-invalid',
    );
    expect(fake.requests).toEqual([]);
  });

  test('deletes the branch it created when the pull request fails', async () => {
    const { fake, sink } = setup();
    fake.failWith = { match: '/pulls', status: 500 };
    const r = await failure(sink.publish(change));
    expect(r.code).toBe('publish.host-failed');
    expect(r.message).toContain('changes/0007-refund-window');
    expect(fake.refs.has('heads/changes/0007-refund-window')).toBe(false);
    expect(fake.requests.at(-1)).toBe(
      'DELETE /repos/acme/shop/git/refs/heads/changes/0007-refund-window',
    );
  });

  test('says the branch was left behind when the cleanup also fails', async () => {
    const { fake, sink } = setup();
    fake.failWith = [
      { match: '/pulls', status: 500 },
      { match: '/git/refs/heads/changes/0007-refund-window', status: 500 },
    ];
    const r = await failure(sink.publish(change));
    expect(r.message).toContain('left behind');
    expect(r.message).toContain('changes/0007-refund-window');
    expect(r.message).not.toContain(TOKEN);
  });

  test('caps text by code points without splitting a surrogate pair', async () => {
    const { fake, sink } = setup();
    await sink.publish({
      ...change,
      title: '😀'.repeat(300),
      body: '😀'.repeat(70_000),
    });
    const pr = fake.pulls[0]!;
    const lone = /[\ud800-\udbff](?![\udc00-\udfff])/;
    expect(cpLength(pr.title)).toBe(256);
    expect(cpLength(pr.body)).toBe(60_000);
    expect(pr.title).not.toMatch(lone);
    expect(pr.body).not.toMatch(lone);
  });

  test('the cap includes the joiners inserted after @', async () => {
    const { fake, sink } = setup();
    await sink.publish({
      ...change,
      title: '@'.repeat(300),
      body: '@'.repeat(70_000),
    });
    const pr = fake.pulls[0]!;
    expect(cpLength(pr.title)).toBeLessThanOrEqual(256);
    expect(cpLength(pr.body)).toBeLessThanOrEqual(60_000);
    expect(pr.title).not.toMatch(/@(?!\u200d)/);
    expect(pr.body).not.toMatch(/@(?!\u200d)/);
  });

  test('strips control characters and newlines from the title and the commit subject', async () => {
    const { fake, sink } = setup();
    await sink.publish({ ...change, title: 'Fix\r\n@evil\tx\u0007y' });
    const pr = fake.pulls[0]!;
    expect(pr.title).toBe('Fix @\u200devil x y');
    expect([...fake.commits.values()][0]!.message).toBe(pr.title);
  });

  test('never follows a redirect', async () => {
    const { fake } = setup();
    const inits: (RequestInit | undefined)[] = [];
    const sink = new GitHubChangeSink({
      token: TOKEN,
      owner: 'acme',
      repo: 'shop',
      allowedPrefixes: ['changes/'],
      fetch: ((u: string, init?: RequestInit) => {
        inits.push(init);
        return (
          fake.fetch as (u: string, i?: RequestInit) => Promise<Response>
        )(u, init);
      }) as unknown as typeof fetch,
    });
    await sink.publish(change);
    expect(inits.length).toBeGreaterThan(0);
    expect(inits.every((i) => i?.redirect === 'error')).toBe(true);
  });

  test('maps 429 to host-rate-limited with the Retry-After seconds', async () => {
    const { fake, sink } = setup();
    fake.failWith = {
      match: '/git/trees',
      status: 429,
      headers: { 'retry-after': '30' },
    };
    const r = await failure(sink.publish(change));
    expect(r.code).toBe('publish.host-rate-limited');
    expect(r.message).toContain('30');
  });

  test('tells the seconds until the rate limit resets, never negative', async () => {
    const hint = async (reset: number) => {
      const { fake, sink } = setup();
      fake.failWith = {
        match: '/git/trees',
        status: 429,
        headers: { 'x-ratelimit-reset': String(reset) },
      };
      return (await failure(sink.publish(change))).message;
    };
    const now = Math.floor(Date.now() / 1000);
    const [, secs] = /resets in (\d+)s/.exec(await hint(now + 120)) ?? [];
    expect(Number(secs)).toBeGreaterThan(100);
    expect(Number(secs)).toBeLessThanOrEqual(120);
    expect(await hint(now - 500)).toEndWith('(resets in 0s)');
  });

  test('refuses an absolute path, a drive-letter path and a drive-letter prefix', async () => {
    const { sink } = setup();
    for (const path of ['/etc/passwd', 'C:/x', 'c:x']) {
      const r = await failure(
        sink.publish({ ...change, files: [{ path, content: 'x' }] }),
      );
      expect(r.code).toBe('publish.path-invalid');
      expect(r.message).toEndWith('rejected: absolute');
    }
    expect(
      () =>
        new GitHubChangeSink({
          token: TOKEN,
          owner: 'acme',
          repo: 'shop',
          allowedPrefixes: ['C:/'],
        }),
    ).toThrow(AgenticError);
  });

  test('maps 403 with an exhausted rate limit to host-rate-limited; a plain 403 stays denied', async () => {
    const a = setup();
    a.fake.failWith = {
      match: '/git/trees',
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'retry-after': 'abc' },
    };
    const r = await failure(a.sink.publish(change));
    expect(r.code).toBe('publish.host-rate-limited');
    expect(r.message).not.toContain('abc');
    const b = setup();
    b.fake.failWith = { match: '/git/trees', status: 403 };
    expect((await failure(b.sink.publish(change))).code).toBe(
      'publish.host-denied',
    );
  });

  test('a non-JSON 200 answer is host-failed without echoing the body', async () => {
    const sink = new GitHubChangeSink({
      token: TOKEN,
      owner: 'acme',
      repo: 'shop',
      allowedPrefixes: ['changes/'],
      fetch: (async () =>
        new Response('<html>LEAK</html>', {
          status: 200,
        })) as unknown as typeof fetch,
    });
    const r = await failure(sink.publish(change));
    expect(r.code).toBe('publish.host-failed');
    expect(r.message).not.toContain('LEAK');
  });

  test('a 422 on ref creation that is not "already exists" is host-failed', async () => {
    const { fake, sink } = setup();
    fake.failWith = {
      match: '/git/refs',
      status: 422,
      body: 'Object does not exist',
    };
    expect((await failure(sink.publish(change))).code).toBe(
      'publish.host-failed',
    );
  });
});
