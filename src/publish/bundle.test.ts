import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { createFakeGitHost } from '../../test/helpers/fake-git-host';
import {
  CHANGE,
  GOOD,
  bundleOf,
  modelOf,
} from '../../test/helpers/publish-bundle';
import { publishBundle, sinkFromEnv } from './bundle';
import { GitHubChangeSink } from './github-sink';

const TOKEN = 'ghp_SECRET_TOKEN_123';
const root = resolve('project-root');
const config = {
  root,
  outRoot: root,
  changesDir: 'changes',
  modules: [
    { name: 'shop', path: 'src/shop' },
    { name: 'billing', path: 'src/billing' },
  ],
};

function setup() {
  const fake = createFakeGitHost({ owner: 'acme', repo: 'shop', token: TOKEN });
  const sink = new GitHubChangeSink({
    token: TOKEN,
    owner: 'acme',
    repo: 'shop',
    allowedPrefixes: ['src/shop/', 'src/billing/', 'changes/'],
    fetch: fake.fetch,
  });
  const publish = (
    bundle: ReturnType<typeof bundleOf>,
    access: 'all' | ReadonlySet<string> = 'all',
  ) => publishBundle({ bundle, root, config, access, sink });
  return { fake, publish };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code: string }).code;
  }
  return 'resolved';
}

describe('publishBundle', () => {
  test('publishes exactly the files apply would write, on the change branch', async () => {
    const { fake, publish } = setup();
    const out = await publish(bundleOf(GOOD));
    expect(out).toEqual({
      branch: `${CHANGE}`,
      url: 'https://github.com/acme/shop/pull/1',
    });
    const [tree] = [...fake.trees.values()] as {
      tree: { path: string }[];
    }[];
    expect(tree!.tree.map((f) => f.path).sort()).toEqual([
      `${CHANGE}/examples.json`,
      `${CHANGE}/proposal.md`,
      'src/shop/domain/refund.ts',
    ]);
    expect(fake.pulls[0]!.head).toBe(CHANGE);
    expect(fake.pulls[0]!.body).toContain(bundleOf(GOOD).hash);
    expect(fake.pulls[0]!.body).toContain('abc123');
  });

  test('refuses a changed file with apply.hash-mismatch and calls no host', async () => {
    const { fake, publish } = setup();
    const bundle = bundleOf(GOOD);
    bundle.files[0] = { ...bundle.files[0]!, content: 'tampered\n' };
    expect(await code(publish(bundle))).toBe('apply.hash-mismatch');
    expect(fake.requests).toEqual([]);
  });

  test('refuses a hash the client claims that is not the bundle hash', async () => {
    const { fake, publish } = setup();
    const bundle = { ...bundleOf(GOOD), hash: 'f'.repeat(64) };
    expect(await code(publish(bundle))).toBe('apply.hash-mismatch');
    expect(fake.requests).toEqual([]);
  });

  test('refuses a valid-hash bundle with a path outside the allow-list, and calls no host', async () => {
    const { fake, publish } = setup();
    for (const path of [
      'target/skeleton/.github/workflows/ci.yml',
      'target/skeleton/package.json',
      'target/skeleton/src/shop/../../.git/config',
      'target/skeleton/src/shop/node_modules/x.js',
    ]) {
      const bundle = bundleOf({ ...GOOD, [path]: 'x\n' });
      expect(await code(publish(bundle))).toMatch(/^apply\.path-/);
    }
    expect(fake.requests).toEqual([]);
  });

  test('a module-scoped grant publishes only that module and the change directory', async () => {
    const { fake, publish } = setup();
    expect(await code(publish(bundleOf(GOOD), new Set(['billing'])))).toBe(
      'auth.scope-missing',
    );
    expect(fake.requests).toEqual([]);
    expect((await publish(bundleOf(GOOD), new Set(['shop']))).branch).toBe(
      CHANGE,
    );
  });

  test('a module-scoped grant cannot publish a change-only bundle of another module', async () => {
    const { fake, publish } = setup();
    const changeOnly = bundleOf({
      [`target/${CHANGE}/proposal.md`]: '# proposal\n',
      'neutral/model.json': modelOf('billing'),
    });
    expect(await code(publish(changeOnly, new Set(['shop'])))).toBe(
      'auth.scope-missing',
    );
    // No recorded module: a module-scoped grant cannot prove it, so it is refused too.
    const unknown = bundleOf({ [`target/${CHANGE}/proposal.md`]: '# p\n' });
    expect(await code(publish(unknown, new Set(['shop'])))).toBe(
      'auth.scope-missing',
    );
    expect(fake.requests).toEqual([]);
  });

  test('the path allow-list still holds when the recorded module is the granted one', async () => {
    const { fake, publish } = setup();
    const crossing = bundleOf({
      ...GOOD,
      'target/skeleton/src/billing/domain/x.ts': 'x\n',
    });
    expect(await code(publish(crossing, new Set(['shop'])))).toBe(
      'apply.path-forbidden',
    );
    expect(fake.requests).toEqual([]);
  });

  test('refuses a bundle without exactly one change directory with apply.change-invalid', async () => {
    const { fake, publish } = setup();
    const { 'target/changes/0003-refund-order/proposal.md': _p, ...noChange } =
      GOOD;
    expect(await code(publish(bundleOf(noChange)))).toBe(
      'apply.change-invalid',
    );
    expect(fake.requests).toEqual([]);
  });
});

describe('sinkFromEnv', () => {
  const prefixes = ['src/shop/', 'changes/'];

  test('is undefined when neither variable is set', () => {
    expect(sinkFromEnv({}, prefixes)).toBeUndefined();
    expect(
      sinkFromEnv(
        { AGENTIC_GITHUB_TOKEN: '', AGENTIC_GITHUB_REPO: '' },
        prefixes,
      ),
    ).toBeUndefined();
  });

  test('refuses a half or malformed configuration with publish.config-invalid, never echoing the token', () => {
    for (const env of [
      { AGENTIC_GITHUB_TOKEN: TOKEN },
      { AGENTIC_GITHUB_REPO: 'acme/shop' },
      { AGENTIC_GITHUB_TOKEN: TOKEN, AGENTIC_GITHUB_REPO: 'acme' },
      { AGENTIC_GITHUB_TOKEN: TOKEN, AGENTIC_GITHUB_REPO: 'a/b/c' },
    ]) {
      let thrown: { code?: string; message?: string } = {};
      try {
        sinkFromEnv(env, prefixes);
      } catch (e) {
        thrown = e as typeof thrown;
      }
      expect(thrown.code).toBe('publish.config-invalid');
      expect(thrown.message).not.toContain(TOKEN);
    }
  });

  test('builds a sink that uses the token from the environment', async () => {
    const fake = createFakeGitHost({
      owner: 'acme',
      repo: 'shop',
      token: TOKEN,
    });
    const sink = sinkFromEnv(
      { AGENTIC_GITHUB_TOKEN: TOKEN, AGENTIC_GITHUB_REPO: 'acme/shop' },
      prefixes,
      fake.fetch,
    )!;
    await sink.publish({
      number: '0003',
      slug: 'refund-order',
      title: 't',
      body: 'b',
      files: [{ path: `${CHANGE}/proposal.md`, content: 'x' }],
    });
    expect(fake.auth.every((a) => a === `Bearer ${TOKEN}`)).toBe(true);
  });
});
