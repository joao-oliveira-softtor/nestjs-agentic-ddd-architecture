import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONVENTIONS, type ResolvedConventions } from './conventions';
import { EMPTY_IR } from './diff';
import type { DomainLock } from './lock';
import {
  createPublishedLock,
  parsePublishedLock,
  readPublishedLock,
  serializePublishedLock,
} from './published';
import type { Rule } from './rules';

const PATH = 'published/domain.lock.json';

function codeOf(run: () => unknown): string {
  try {
    run();
    return '';
  } catch (error) {
    return (error as { code?: string }).code ?? '';
  }
}

async function asyncCodeOf(run: () => Promise<unknown>): Promise<{
  code: string;
  message: string;
}> {
  try {
    await run();
    return { code: '', message: '' };
  } catch (error) {
    const e = error as { code?: string; message: string };
    return { code: e.code ?? '', message: e.message };
  }
}

const lock: DomainLock = { lockVersion: 1, ir: EMPTY_IR, changes: [] };
const rules: Rule[] = [
  { key: 'core/a', file: null, paths: null, body: '- one' },
];

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agentic-published-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('published lock', () => {
  const published = createPublishedLock('v1', lock, rules);
  const text = serializePublishedLock(published);
  const edit = (change: (o: Record<string, unknown>) => void): string => {
    const o = JSON.parse(text) as Record<string, unknown>;
    change(o);
    return JSON.stringify(o);
  };

  test('round trips create, serialize and parse', () => {
    expect(published.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(parsePublishedLock(text, PATH)).toEqual(published);
  });

  test('a tampered lock fails with digest-mismatch', () => {
    const bad = edit((o) => {
      (o.lock as DomainLock & { changes: unknown[] }).changes = [];
      (o.lock as Record<string, unknown>).extra = 1;
    });
    expect(codeOf(() => parsePublishedLock(bad, PATH))).toBe(
      'published.digest-mismatch',
    );
  });

  test('tampered rules fail with digest-mismatch', () => {
    const bad = edit((o) => (o.rules = []));
    expect(codeOf(() => parsePublishedLock(bad, PATH))).toBe(
      'published.digest-mismatch',
    );
  });

  test('conventions round trip and are covered by the digest', () => {
    const custom: ResolvedConventions = {
      ...DEFAULT_CONVENTIONS,
      layers: { domain: 'core', application: 'app', operators: 'ops' },
    };
    const other = createPublishedLock('v1', lock, rules, custom);
    expect(other.digest).not.toBe(published.digest);
    expect(parsePublishedLock(serializePublishedLock(other), PATH)).toEqual(
      other,
    );
    const bad = edit((o) => (o.conventions = custom));
    expect(codeOf(() => parsePublishedLock(bad, PATH))).toBe(
      'published.digest-mismatch',
    );
  });

  test('missing or malformed conventions fail with malformed', () => {
    for (const value of [undefined, null, 'x', { layers: {} }]) {
      const bad = edit((o) => (o.conventions = value));
      expect(codeOf(() => parsePublishedLock(bad, PATH))).toBe(
        'published.malformed',
      );
    }
  });

  test('a tampered digest field fails with digest-mismatch', () => {
    const bad = edit((o) => (o.digest = 'a'.repeat(64)));
    expect(codeOf(() => parsePublishedLock(bad, PATH))).toBe(
      'published.digest-mismatch',
    );
  });

  test('a malformed digest field fails with malformed', () => {
    const bad = edit((o) => (o.digest = 'xyz'));
    expect(codeOf(() => parsePublishedLock(bad, PATH))).toBe(
      'published.malformed',
    );
  });

  test('expectDigest matches, also in uppercase', () => {
    expect(parsePublishedLock(text, PATH, published.digest)).toEqual(published);
    expect(
      parsePublishedLock(text, PATH, published.digest.toUpperCase()),
    ).toEqual(published);
  });

  test('a wrong expectDigest fails with digest-unexpected', () => {
    expect(codeOf(() => parsePublishedLock(text, PATH, 'b'.repeat(64)))).toBe(
      'published.digest-unexpected',
    );
  });

  test('a wrong publishedLockVersion fails with version-unsupported', () => {
    const bad = edit((o) => (o.publishedLockVersion = 2));
    expect(codeOf(() => parsePublishedLock(bad, PATH))).toBe(
      'published.version-unsupported',
    );
  });

  test('an invalid version label fails on create and on parse', () => {
    for (const version of ['', 'x'.repeat(65), 'a\nb']) {
      expect(codeOf(() => createPublishedLock(version, lock, rules))).toBe(
        'published.version-invalid',
      );
      const bad = edit((o) => (o.version = version));
      expect(codeOf(() => parsePublishedLock(bad, PATH))).toBe(
        'published.version-invalid',
      );
    }
  });

  test('non-JSON and non-object input fail with malformed', () => {
    expect(codeOf(() => parsePublishedLock('{', PATH))).toBe(
      'published.malformed',
    );
    expect(codeOf(() => parsePublishedLock('[]', PATH))).toBe(
      'published.malformed',
    );
    expect(
      codeOf(() =>
        parsePublishedLock(
          edit((o) => (o.rules = 1)),
          PATH,
        ),
      ),
    ).toBe('published.malformed');
  });

  test('a tampered version fails with digest-mismatch', () => {
    const bad = edit((o) => (o.version = 'v2'));
    expect(codeOf(() => parsePublishedLock(bad, PATH))).toBe(
      'published.digest-mismatch',
    );
  });

  test('a missing or non-object lock fails with malformed', () => {
    for (const value of [undefined, null, 1, []]) {
      const bad = edit((o) => (o.lock = value));
      expect(codeOf(() => parsePublishedLock(bad, PATH))).toBe(
        'published.malformed',
      );
    }
  });

  test('a rule that is not an object fails with malformed even with a valid digest', () => {
    for (const badRules of [[null], [1], [[]], [{ ...rules[0], key: 1 }]]) {
      const forged = createPublishedLock(
        'v1',
        lock,
        badRules as unknown as Rule[],
      );
      expect(
        codeOf(() => parsePublishedLock(serializePublishedLock(forged), PATH)),
      ).toBe('published.malformed');
    }
  });

  test('rule fields that consumers dereference are validated, naming the field', () => {
    const cases: [unknown, string][] = [
      [{ ...rules[0], paths: 'src/**' }, 'rules[0].paths'],
      [{ ...rules[0], paths: ['a', 1] }, 'rules[0].paths'],
      [{ ...rules[0], paths: undefined }, 'rules[0].paths'],
      [{ ...rules[0], file: 1 }, 'rules[0].file'],
    ];
    for (const [rule, field] of cases) {
      const forged = createPublishedLock('v1', lock, [rule as Rule]);
      const run = () =>
        parsePublishedLock(serializePublishedLock(forged), PATH);
      expect(codeOf(run)).toBe('published.malformed');
      expect(() => run()).toThrow(field);
    }
  });

  test('lock elements that consumers dereference are validated even with a valid digest', () => {
    const withIr = (patch: Record<string, unknown>): DomainLock => ({
      ...lock,
      ir: { ...lock.ir, ...patch } as DomainLock['ir'],
    });
    const cases: [DomainLock, string][] = [
      [withIr({ modules: [{ name: 'orders' }] }), 'modules[0].path'],
      [withIr({ modules: [null] }), 'modules[0]'],
      [withIr({ entities: [{ id: 'e' }] }), 'entities[0].module'],
      [withIr({ events: [null] }), 'events[0]'],
      [withIr({ useCases: [{ module: 'm' }] }), 'useCases[0].id'],
      [withIr({ operators: [1] }), 'operators[0]'],
    ];
    for (const [badLock, field] of cases) {
      const forged = createPublishedLock('v1', badLock, rules);
      const run = () =>
        parsePublishedLock(serializePublishedLock(forged), PATH);
      expect(codeOf(run)).toBe('published.malformed');
      expect(() => run()).toThrow(field);
    }
  });

  test('version labels with C1 or bidi characters are rejected', () => {
    for (const c of ['\u0085', '‮', '⁦', '‏', '؜']) {
      const version = `v${c}1`;
      expect(codeOf(() => createPublishedLock(version, lock, rules))).toBe(
        'published.version-invalid',
      );
      const bad = edit((o) => (o.version = version));
      expect(codeOf(() => parsePublishedLock(bad, PATH))).toBe(
        'published.version-invalid',
      );
    }
  });

  test('a directory is refused as malformed', async () => {
    expect((await asyncCodeOf(() => readPublishedLock(dir, PATH))).code).toBe(
      'published.malformed',
    );
  });

  test('an invalid embedded lock is reported as malformed with the inner code', () => {
    const bad = edit((o) => (o.lock = { lockVersion: 1 }));
    let message = '';
    try {
      parsePublishedLock(bad, PATH);
    } catch (error) {
      message = (error as Error).message;
      expect((error as { code?: string }).code).toBe('published.malformed');
    }
    expect(message).toContain('lock.incomplete');
    expect(message).toContain('agentic-ddd publish-lock');
    expect(message).not.toContain('git');
  });

  test('a missing file is unreadable and does not leak the absolute path', async () => {
    const abs = join(dir, 'missing.json');
    const { code, message } = await asyncCodeOf(() =>
      readPublishedLock(abs, PATH),
    );
    expect(code).toBe('published.unreadable');
    expect(message).toContain(PATH);
    expect(message).not.toContain(dir);
  });

  test('an oversized file fails with malformed', async () => {
    const abs = join(dir, 'big.json');
    await writeFile(abs, Buffer.alloc(32 * 1024 * 1024 + 1, 0x20));
    expect((await asyncCodeOf(() => readPublishedLock(abs, PATH))).code).toBe(
      'published.malformed',
    );
  });

  test('reads a valid file from disk', async () => {
    const abs = join(dir, 'ok.json');
    await writeFile(abs, text);
    expect(await readPublishedLock(abs, PATH, published.digest)).toEqual(
      published,
    );
  });
});
