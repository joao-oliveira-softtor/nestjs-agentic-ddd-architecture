import { afterAll, describe, expect, test } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertChangeFree,
  checkedWrites,
  compileRefusal,
  forbiddenWrite,
  plan,
  splitBundleFiles,
  transaction,
  verifyBundle,
  writableDirs,
} from './apply';
import { buildManifest } from './manifest';

describe('forbiddenWrite', () => {
  const allowed = ['src/shop', 'changes/0001-x'];
  test.each([
    ['../x', 'apply.path-escape'],
    ['src/shop/../../x', 'apply.path-escape'],
    ['/etc/passwd', 'apply.path-escape'],
    ['C:/Windows/x', 'apply.path-escape'],
    ['src\\shop\\x.ts', 'apply.path-escape'],
    ['', 'apply.path-escape'],
    ['.git/hooks/pre-commit', 'apply.path-forbidden'],
    ['src/shop/.GIT/config', 'apply.path-forbidden'],
    ['src/shop/.git./config', 'apply.path-forbidden'],
    ['src/shop/node_modules/x.js', 'apply.path-forbidden'],
    ['.github/workflows/x.yml', 'apply.path-forbidden'],
    ['bunfig.toml', 'apply.path-forbidden'],
    ['src/evil.ts', 'apply.path-forbidden'],
    ['src/shop-evil/x.ts', 'apply.path-forbidden'],
    ['changes/0002-y/proposal.md', 'apply.path-forbidden'],
  ])('refuses %p with %s', (path, code) => {
    expect(forbiddenWrite(path, allowed)).toBe(
      code as ReturnType<typeof forbiddenWrite>,
    );
  });

  test.each(['src/shop/domain/order.ts', 'changes/0001-x/proposal.md'])(
    'allows %p',
    (path) => {
      expect(forbiddenWrite(path, allowed)).toBeUndefined();
    },
  );
});

const files = () =>
  new Map([
    ['target/skeleton/src/shop/a.ts', 'export const a = 1;\n'],
    ['target/changes/0001-x/proposal.md', '# x\n'],
  ]);

/** A manifest text that matches `fs`, as `compileBundle` would write it. */
const manifestFor = (fs: ReadonlyMap<string, string>, over = {}) =>
  JSON.stringify({
    ...buildManifest(
      {
        baseRef: 'abc',
        baseLockHash: 'def',
        layers: {},
        examples: [],
      } as never,
      [...fs].map(([path, content]) => ({ path, content })),
    ),
    ...over,
  });

const refusal = (call: () => unknown) => {
  try {
    call();
  } catch (error) {
    return error as { code: string; message: string };
  }
  throw new Error('did not throw');
};

describe('verifyBundle', () => {
  test('returns the manifest of an intact bundle', () => {
    const manifest = verifyBundle(manifestFor(files()), files());
    expect(manifest.baseRef).toBe('abc');
    expect(manifest.files.map((f) => f.path)).toEqual([
      'target/changes/0001-x/proposal.md',
      'target/skeleton/src/shop/a.ts',
    ]);
  });

  test('refuses a changed file, naming it', () => {
    const text = manifestFor(files());
    const changed = files().set('target/changes/0001-x/proposal.md', '# y\n');
    const error = refusal(() => verifyBundle(text, changed));
    expect(error.code).toBe('apply.hash-mismatch');
    expect(error.message).toBe(
      'the bundle is not intact: "target/changes/0001-x/proposal.md" differs from the manifest',
    );
  });

  test('refuses an extra file, naming it', () => {
    const text = manifestFor(files());
    const extra = files().set('target/skeleton/src/shop/evil.ts', 'x');
    expect(refusal(() => verifyBundle(text, extra)).message).toContain(
      '"target/skeleton/src/shop/evil.ts" differs',
    );
  });

  test('refuses a missing file, naming it', () => {
    const text = manifestFor(files());
    const fewer = files();
    fewer.delete('target/skeleton/src/shop/a.ts');
    expect(refusal(() => verifyBundle(text, fewer)).message).toContain(
      '"target/skeleton/src/shop/a.ts" differs',
    );
  });

  test('refuses a manifest whose hash is not the hash of its content', () => {
    const error = refusal(() =>
      verifyBundle(manifestFor(files(), { baseRef: 'zzz' }), files()),
    );
    expect(error.code).toBe('apply.hash-mismatch');
    expect(error.message).toBe(
      'the bundle is not intact: the manifest does not match its hash',
    );
  });

  test.each(['not json', 'null', '{}'])(
    'refuses %p as not a manifest',
    (text) => {
      const error = refusal(() => verifyBundle(text, files()));
      expect(error.code).toBe('apply.hash-mismatch');
    },
  );

  test('refuses text that is not JSON with the "not a manifest" message', () => {
    expect(refusal(() => verifyBundle('not json', files())).message).toBe(
      'the bundle is not intact: bundle.json is not a manifest',
    );
  });
});

const temp: string[] = [];
afterAll(async () => {
  for (const d of temp) await rm(d, { recursive: true, force: true });
});
const tempDir = async () => {
  const d = await mkdtemp(join(tmpdir(), 'apply-unit-'));
  temp.push(d);
  return d;
};

describe('splitBundleFiles', () => {
  test('returns the manifest text and the other files as LF text, without the derived files', async () => {
    const dir = await tempDir();
    await mkdir(join(dir, 'target', 'skeleton'), { recursive: true });
    await writeFile(join(dir, 'bundle.json'), '{"a":1}\r\n');
    await writeFile(join(dir, 'BUNDLE.md'), '# derived\n');
    await writeFile(join(dir, 'target', 'skeleton', 'a.ts'), 'a\r\nb\r\n');
    await writeFile(join(dir, 'neutral.md'), 'n\n');
    const result = await splitBundleFiles(dir);
    expect(result.manifestText).toBe('{"a":1}\n');
    expect([...result.files]).toEqual(
      expect.arrayContaining([
        ['target/skeleton/a.ts', 'a\nb\n'],
        ['neutral.md', 'n\n'],
      ]),
    );
    expect(result.files.size).toBe(2);
  });

  test('refuses a directory without bundle.json as not intact', async () => {
    const error = await splitBundleFiles(await tempDir()).then(
      () => ({ code: 'resolved', message: '' }),
      (e: { code: string; message: string }) => e,
    );
    expect(error.code).toBe('apply.hash-mismatch');
    expect(error.message).toBe(
      'the bundle is not intact: bundle.json is missing',
    );
  });
});

describe('splitBundleFiles errors', () => {
  test('a missing directory is a bundle without bundle.json', async () => {
    const error = await splitBundleFiles(join(await tempDir(), 'nope')).catch(
      (e: { message: string }) => e,
    );
    expect((error as { message: string }).message).toContain(
      'bundle.json is missing',
    );
  });

  test('any other read failure is reported as it is, not as a missing bundle.json', async () => {
    const file = join(await tempDir(), 'a-file');
    await writeFile(file, 'x');
    const error = await splitBundleFiles(file).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('bundle.json is missing');
  });
});

describe('writableDirs', () => {
  test('lists the module paths relative to the project, then the change directory', () => {
    const root = join(tmpdir(), 'proj');
    const dirs = writableDirs(
      root,
      {
        root,
        modules: [
          { name: 'a', path: 'src/a' },
          { name: 'b', path: 'packages/b' },
        ],
      },
      join(root, 'changes'),
      '0002-y',
    );
    expect(dirs).toEqual(['src/a', 'packages/b', 'changes/0002-y']);
  });
});

describe('checkedWrites', () => {
  const planned = (...rels: string[]) =>
    rels.map((rel) => ({ rel, content: '' }));

  test('accepts paths under an allowed directory', () => {
    expect(() =>
      checkedWrites(planned('src/a/x.ts', 'changes/0001-x/p.md'), [
        'src/a',
        'changes/0001-x',
      ]),
    ).not.toThrow();
  });

  test('names a path outside the project', () => {
    const error = refusal(() => checkedWrites(planned('../x'), ['src/a']));
    expect(error.code).toBe('apply.path-escape');
    expect(error.message).toBe('bundle path "../x" is outside the project');
  });

  test('names a path outside the allowed directories or inside a protected folder', () => {
    const error = refusal(() =>
      checkedWrites(planned('src/a/ok.ts', 'package.json'), ['src/a']),
    );
    expect(error.code).toBe('apply.path-forbidden');
    expect(error.message).toBe(
      'bundle path "package.json" is not under a module path or the change directory, or is inside a protected folder',
    );
  });
});

describe('compileRefusal', () => {
  const ok = { code: 0, stderr: '', timedOut: false };

  test('passes a clean exit', () => {
    expect(compileRefusal(ok, false, 1000)).toBeUndefined();
  });

  test('a timeout names the limit and says what was restored', () => {
    const error = compileRefusal({ ...ok, timedOut: true }, false, 120_000)!;
    expect(error.code).toBe('apply.compile-timeout');
    expect(error.message).toContain('within 120 s and was stopped');
    expect(error.message).toContain('run `bun run agentic compile`');
  });

  test('a timeout wins over the exit code and a signal', () => {
    const error = compileRefusal(
      { code: 1, stderr: 'boom', timedOut: true },
      true,
      1000,
    )!;
    expect(error.code).toBe('apply.compile-timeout');
  });

  test('a non-zero exit is a failure carrying the trimmed stderr', () => {
    const error = compileRefusal(
      { code: 1, stderr: '  boom\n', timedOut: false },
      false,
      1000,
    )!;
    expect(error.code).toBe('apply.compile-failed');
    expect(error.message).toContain('compile failed after writing the bundle');
    expect(error.message).toEndWith('"boom"');
  });

  test('a signal is a failure even when the exit code was 0', () => {
    const error = compileRefusal(ok, true, 1000)!;
    expect(error.code).toBe('apply.compile-failed');
    expect(error.message).toContain(
      'compile was interrupted by a signal after writing the bundle',
    );
  });
});

describe('plan', () => {
  const manifest = { examples: [] };

  test('maps skeleton files to the project and change files under the changes directory, in path order, then adds examples.json', () => {
    const files = new Map([
      ['target/skeleton/src/shop/z.ts', 'z'],
      ['target/changes/0001-x/proposal.md', 'p'],
      ['target/packets/ignored.json', 'no'],
      ['target/skeleton/src/shop/a.ts', 'a'],
      ['neutral/README.md', 'no'],
    ]);
    const { planned, change } = plan(manifest, files, 'out/changes');
    expect(change).toBe('0001-x');
    expect(planned).toEqual([
      { rel: 'out/changes/0001-x/proposal.md', content: 'p' },
      { rel: 'src/shop/a.ts', content: 'a' },
      { rel: 'src/shop/z.ts', content: 'z' },
      { rel: 'out/changes/0001-x/examples.json', content: '[]\n' },
    ]);
  });

  test('sorts the same way whatever order the files come in', () => {
    const names = ['d', 'b', 'a', 'c', 'e'];
    for (const order of [names, [...names].reverse()]) {
      const files = new Map(
        [...order, 'ch'].map((n) => [
          n === 'ch'
            ? 'target/changes/0001-x/p.md'
            : `target/skeleton/src/${n}.ts`,
          n,
        ]),
      );
      const rels = plan(manifest, files, 'c').planned.map((p) => p.rel);
      expect(rels).toEqual([
        'c/0001-x/p.md',
        'src/a.ts',
        'src/b.ts',
        'src/c.ts',
        'src/d.ts',
        'src/e.ts',
        'c/0001-x/examples.json',
      ]);
    }
  });

  test.each([
    ['no change directory', []],
    ['two change directories', ['0001-x', '0002-y']],
    ['a name that is not NNNN-slug', ['1-x']],
    ['an upper-case slug', ['0001-X']],
  ])('refuses %s with apply.change-invalid', (_name, dirs) => {
    const files = new Map(
      dirs.map((d) => [`target/changes/${d}/proposal.md`, 'p']),
    );
    const error = refusal(() => plan(manifest, files, 'changes'));
    expect(error.code).toBe('apply.change-invalid');
    expect(error.message).toContain(
      'exactly one change directory named NNNN-slug',
    );
  });
});

describe('assertChangeFree', () => {
  const failure = (call: Promise<unknown>) =>
    call.then(
      () => undefined,
      (e: { code: string; message: string }) => e,
    );

  test('accepts a changes directory that is missing or holds other numbers', async () => {
    const root = await tempDir();
    expect(
      await assertChangeFree(root, join(root, 'changes'), '0002-y'),
    ).toBeUndefined();
    await mkdir(join(root, 'changes', '0001-x'), { recursive: true });
    expect(
      await assertChangeFree(root, join(root, 'changes'), '0002-y'),
    ).toBeUndefined();
  });

  test.each(['0002-other', '0002'])(
    'refuses when %p already has the number',
    async (existing) => {
      const root = await tempDir();
      await mkdir(join(root, 'changes', existing), { recursive: true });
      const error = await failure(
        assertChangeFree(root, join(root, 'changes'), '0002-y'),
      );
      expect(error?.code).toBe('apply.change-exists');
      expect(error?.message).toBe(
        `change 0002 already exists as "changes/${existing}"`,
      );
    },
  );

  test('does not mistake a longer number for the same one', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'changes', '00021-z'), { recursive: true });
    expect(
      await assertChangeFree(root, join(root, 'changes'), '0002-y'),
    ).toBeUndefined();
  });
});

describe('transaction', () => {
  /** A project with `old.txt` and a stage holding `new/old.txt`, `new/sub/deep/a.txt` and `new/b.txt`. */
  const setup = async (staged = ['old.txt', 'sub/deep/a.txt', 'b.txt']) => {
    const root = await tempDir();
    const stage = await tempDir();
    await writeFile(join(root, 'old.txt'), 'original');
    for (const rel of staged) {
      await mkdir(join(stage, 'new', rel, '..'), { recursive: true });
      await writeFile(join(stage, 'new', rel), `new ${rel}`);
    }
    return {
      root,
      stage,
      tx: transaction(stage, root, new AbortController().signal),
    };
  };
  const planned = (...rels: string[]) =>
    rels.map((rel) => ({ rel, content: '' }));
  const exists = (path: string) =>
    stat(path).then(
      () => true,
      () => false,
    );

  test('moves every file into place, backing up the original', async () => {
    const { root, stage, tx } = await setup();
    await tx.move(planned('old.txt', 'sub/deep/a.txt', 'b.txt'));
    expect(await readFile(join(root, 'old.txt'), 'utf8')).toBe('new old.txt');
    expect(await readFile(join(root, 'sub/deep/a.txt'), 'utf8')).toBe(
      'new sub/deep/a.txt',
    );
    expect(await readFile(join(stage, 'backup', 'old.txt'), 'utf8')).toBe(
      'original',
    );
  });

  test('rollback restores the original, removes the new files and the directories it created, and runs once', async () => {
    const { root, tx } = await setup();
    await tx.move(planned('old.txt', 'sub/deep/a.txt', 'b.txt'));
    await tx.rollback();
    expect(await readFile(join(root, 'old.txt'), 'utf8')).toBe('original');
    expect(await exists(join(root, 'b.txt'))).toBe(false);
    expect(await exists(join(root, 'sub'))).toBe(false);
    await tx.rollback();
    expect(await readdir(root)).toEqual(['old.txt']);
  });

  test('a failure half-way puts everything back, even when the failing file was already moved aside', async () => {
    const { root, tx } = await setup(['sub/deep/a.txt', 'b.txt']);
    // old.txt is not staged: its original is backed up, then the rename of the new file fails.
    const error = await tx
      .move(planned('sub/deep/a.txt', 'b.txt', 'old.txt'))
      .then(
        () => undefined,
        (e: { code: string; message: string }) => e,
      );
    expect(error?.code).toBe('apply.write-failed');
    expect(error?.message).toStartWith(
      'could not write the bundle, nothing was changed: ',
    );
    expect(await readdir(root)).toEqual(['old.txt']);
    expect(await readFile(join(root, 'old.txt'), 'utf8')).toBe('original');
  });

  test('beforeMove can fail a write and an aborted signal stops the moves', async () => {
    const { root, stage } = await setup();
    const abort = new AbortController();
    const tx = transaction(stage, root, abort.signal);
    const seen: number[] = [];
    abort.abort();
    const error = await tx
      .move(planned('b.txt', 'old.txt'), (i) => seen.push(i))
      .then(
        () => undefined,
        (e: { code: string; message: string }) => e,
      );
    expect(seen).toEqual([0]);
    expect(error?.code).toBe('apply.write-failed');
    expect(error?.message).toContain('interrupted by a signal');
    expect(await readdir(root)).toEqual(['old.txt']);
  });
});
