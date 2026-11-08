import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createFakeGitHost } from '../../test/helpers/fake-git-host';
import {
  CHANGE,
  GOOD,
  bundleOf,
  modelOf,
} from '../../test/helpers/publish-bundle';
import {
  SHORT_PATH_TEST_TIMEOUT_MS,
  shortPath,
} from '../../test/helpers/short-path';
import { publishBundle, publishTargetFromProject, sinkFromEnv } from './bundle';
import { GitHubChangeSink } from './github-sink';

const TOKEN = 'ghp_SECRET_TOKEN_123';
const root = resolve('project-root');
const config = {
  root,
  outRoot: root,
  changesDir: 'changes',
  out: { lock: '.agentic/domain.lock.json' },
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
    expect(fake.pulls[0]!.body).toContain('sha-base');
  });

  test('refuses with publish.base-mismatch when main changed a target since the bundle base, and creates nothing', async () => {
    const { fake, publish } = setup();
    fake.history.set('old', { 'src/shop/domain/refund.ts': 'v1' });
    fake.history.set('sha-base', { 'src/shop/domain/refund.ts': 'v2' });
    expect(await code(publish(bundleOf(GOOD, 'old')))).toBe(
      'publish.base-mismatch',
    );
    expect(fake.requests.some((r) => r.startsWith('POST'))).toBe(false);
  });

  test('refuses with publish.base-mismatch when main moved the project lock, though no target changed', async () => {
    const { fake, publish } = setup();
    const target = 'src/shop/domain/refund.ts';
    fake.history.set('old', { [target]: 'v1', [config.out.lock]: 'a' });
    fake.history.set('sha-base', { [target]: 'v1', [config.out.lock]: 'b' });
    expect(await code(publish(bundleOf(GOOD, 'old')))).toBe(
      'publish.base-mismatch',
    );
    expect(fake.pulls).toEqual([]);
  });

  test('refuses a bundle whose base ref the host never saw', async () => {
    const { fake, publish } = setup();
    expect(await code(publish(bundleOf(GOOD, 'never-pushed')))).toBe(
      'publish.base-unknown',
    );
    expect(fake.pulls).toEqual([]);
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
      changesDir: 'changes',
      baseRef: 'sha-base',
      lockPath: 'domain.lock.json',
      files: [{ path: `${CHANGE}/proposal.md`, content: 'x' }],
    });
    expect(fake.auth.every((a) => a === `Bearer ${TOKEN}`)).toBe(true);
  });
});

describe('publishTargetFromProject', () => {
  const temps: string[] = [];
  afterAll(() =>
    Promise.all(temps.map((d) => rm(d, { recursive: true, force: true }))),
  );
  const env = { AGENTIC_GITHUB_TOKEN: TOKEN, AGENTIC_GITHUB_REPO: 'acme/shop' };

  // A git repository whose project (agentic.config.ts) lives in `sub/app`, as in a monorepo.
  async function monorepo() {
    const top = await mkdtemp(join(tmpdir(), 'agentic-mono-'));
    temps.push(top);
    const project = join(top, 'sub', 'app');
    await mkdir(join(project, 'src', 'shop'), { recursive: true });
    const configPath = join(project, 'agentic.config.ts');
    await writeFile(
      configPath,
      "export default { modules: [{ name: 'shop', path: 'src/shop' }] };\n",
    );
    expect(Bun.spawnSync(['git', 'init', '-q'], { cwd: top }).exitCode).toBe(0);
    return { project, configPath };
  }

  test('is undefined, without reading the config, when the environment asks for no sink', async () => {
    expect(
      await publishTargetFromProject('nowhere', 'nope.ts', {}),
    ).toBeUndefined();
  });

  test('paths sent to GitHub are relative to the repository root, not to the project folder', async () => {
    const { project, configPath } = await monorepo();
    const fake = createFakeGitHost({
      owner: 'acme',
      repo: 'shop',
      token: TOKEN,
    });
    const target = (await publishTargetFromProject(
      project,
      configPath,
      env,
      fake.fetch,
    ))!;
    await publishBundle({
      bundle: bundleOf(GOOD),
      root: project,
      config: target.config,
      access: 'all',
      sink: target.sink,
    });
    const [tree] = [...fake.trees.values()] as { tree: { path: string }[] }[];
    expect(tree!.tree.map((f) => f.path).sort()).toEqual([
      `sub/app/${CHANGE}/examples.json`,
      `sub/app/${CHANGE}/proposal.md`,
      'sub/app/src/shop/domain/refund.ts',
    ]);
    const outside = await target.sink
      .publish({
        number: '0009',
        slug: 'x',
        title: 't',
        body: 'b',
        changesDir: 'changes',
        baseRef: 'sha-base',
        lockPath: 'domain.lock.json',
        files: [{ path: 'elsewhere/a.ts', content: 'x' }],
      })
      .catch((e: { code: string }) => e.code);
    expect(outside).toBe('publish.path-invalid');
  });

  test('guards the lock at its repository-relative path, below the project folder', async () => {
    const { project, configPath } = await monorepo();
    const fake = createFakeGitHost({
      owner: 'acme',
      repo: 'shop',
      token: TOKEN,
    });
    const lock = 'sub/app/.agentic/domain.lock.json';
    fake.history.set('old', { [lock]: 'a' });
    fake.history.set('sha-base', { [lock]: 'b' });
    const target = (await publishTargetFromProject(
      project,
      configPath,
      env,
      fake.fetch,
    ))!;
    const refused = await publishBundle({
      bundle: bundleOf(GOOD, 'old'),
      root: project,
      config: target.config,
      access: 'all',
      sink: target.sink,
    }).catch((e: { code: string }) => e.code);
    expect(refused).toBe('publish.base-mismatch');
  });

  // Windows reports the temp folder by its 8.3 name (RUNNER~1) while the config paths are expanded.
  test(
    'a project root given by its 8.3 short name publishes the same repository-relative paths',
    async () => {
      const { project, configPath } = await monorepo();
      const fake = createFakeGitHost({
        owner: 'acme',
        repo: 'shop',
        token: TOKEN,
      });
      const target = (await publishTargetFromProject(
        project,
        configPath,
        env,
        fake.fetch,
      ))!;
      await publishBundle({
        bundle: bundleOf(GOOD),
        root: shortPath(project),
        config: target.config,
        access: 'all',
        sink: target.sink,
      });
      const [tree] = [...fake.trees.values()] as { tree: { path: string }[] }[];
      expect(tree!.tree.map((f) => f.path)).toContain(
        'sub/app/src/shop/domain/refund.ts',
      );
    },
    SHORT_PATH_TEST_TIMEOUT_MS,
  );

  test('the number check looks at the changes directory of the repository, below the project path', async () => {
    const { project, configPath } = await monorepo();
    const fake = createFakeGitHost({
      owner: 'acme',
      repo: 'shop',
      token: TOKEN,
      dirs: { 'sub/app/changes': ['0003-other'] },
    });
    const target = (await publishTargetFromProject(
      project,
      configPath,
      env,
      fake.fetch,
    ))!;
    const result = await publishBundle({
      bundle: bundleOf(GOOD),
      root: project,
      config: target.config,
      access: 'all',
      sink: target.sink,
    }).catch((e: { code: string }) => e.code);
    expect(result).toBe('publish.change-exists');
  });
});
