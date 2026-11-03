import { describe, expect, test } from 'bun:test';
import { AgenticError } from '../contracts/codes';
import { createFakeGitHost } from './fake-git-host';
import { GitHubChangeSink } from './github-sink';

const TOKEN = 'ghp_SECRET_TOKEN_123';
const change = {
  number: '0007',
  slug: 'refund-window',
  title: 'Add refund window',
  body: 'Body',
  files: [{ path: 'changes/0007-refund-window/proposal.md', content: '# hi' }],
};

function setup(
  host: { defaultBranch?: string; existingBranches?: string[] } = {},
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
    expect([...fake.blobs.values()]).toEqual(['# hi']);
  });

  test('issues a deterministic request sequence', async () => {
    const { fake, sink } = setup();
    await sink.publish(change);
    const r = '/repos/acme/shop';
    expect(fake.requests).toEqual([
      `GET ${r}`,
      `GET ${r}/git/ref/heads/main`,
      `GET ${r}/git/ref/heads/changes/0007-refund-window`,
      `GET ${r}/git/commits/sha-base`,
      `POST ${r}/git/blobs`,
      `POST ${r}/git/trees`,
      `POST ${r}/git/commits`,
      `POST ${r}/git/refs`,
      `POST ${r}/pulls`,
    ]);
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
    fake.failWith = { match: '/git/refs', status: 422 };
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
});
