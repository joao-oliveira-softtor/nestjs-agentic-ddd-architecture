import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { type DomainLock, parseLock } from '../compiler/lock';
import type { Rule } from '../compiler/rules';
import {
  catalogue,
  findDoc,
  index,
  loadAuthoringDocs,
  type SkillDoc,
} from './skills';

const root = resolve(import.meta.dir, '../..');
const fullLock = parseLock(
  await Bun.file(resolve(root, '.agentic/domain.lock.json')).text(),
  'lock',
);
const authoring = await loadAuthoringDocs(resolve(root, 'skills/agentic-ddd'));

// The repo lock plus a hidden-by-default `billing` module.
const lock: DomainLock = {
  ...fullLock,
  ir: {
    ...fullLock.ir,
    modules: [
      ...fullLock.ir.modules,
      { name: 'billing', path: 'examples/billing' },
    ],
    entities: [
      ...fullLock.ir.entities,
      {
        id: 'entity:Invoice',
        name: 'Invoice',
        module: 'billing',
        description: 'invoice',
        source: 'examples/billing/domain/invoice.ts:1',
        states: [],
        invariants: [],
        methods: [],
      },
    ],
  },
};

const rule = (key: string, paths: string[] | null): Rule => ({
  key,
  file: `rules/${key}.md`,
  paths,
  body: `- body of ${key}`,
});
const rules: Rule[] = [
  { key: 'core/done', file: null, paths: null, body: '- core' },
  rule('open', null),
  rule('mixed', ['examples/orders/**', 'examples/billing/**']),
  rule('billing-only', ['examples/billing/**']),
];

const build = (skillAccess: 'all' | ReadonlySet<string>) =>
  catalogue({ authoring, lock, fullLock: lock, rules, skillAccess });
const uris = (docs: SkillDoc[]) => docs.map((d) => d.uri);

describe('loadAuthoringDocs', () => {
  test('reads SKILL.md and references/*.md sorted, without assets', () => {
    const paths = authoring.map((a) => a.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths).toContain('SKILL.md');
    expect(paths).toContain('references/authoring.md');
    expect(paths.some((p) => p.startsWith('assets'))).toBe(false);
  });
});

describe('catalogue', () => {
  test('an empty set yields nothing', () => {
    expect(build(new Set())).toEqual([]);
  });

  test("'all' lists the authoring skill, every dev skill and the team rules", () => {
    const all = uris(build('all'));
    expect(all).toContain('skill://agentic-ddd/SKILL.md');
    expect(all).toContain('skill://agentic-ddd/references/authoring.md');
    expect(all).toContain('skill://orders-dev/SKILL.md');
    expect(all).toContain('skill://billing-dev/SKILL.md');
    expect(all).toContain('skill://agentic-ddd/rules/billing-only.md');
    expect(all).not.toContain('skill://agentic-ddd/rules/core/done.md');
  });

  test('a scoped token loses the hidden dev skill and its bound rule, and narrows the others', () => {
    const docs = build(new Set(['orders']));
    const all = uris(docs);
    expect(all).toContain('skill://orders-dev/SKILL.md');
    expect(all.some((u) => u.includes('billing'))).toBe(false);
    expect(all).toContain('skill://agentic-ddd/rules/open.md');
    expect(all).not.toContain('skill://agentic-ddd/rules/billing-only.md');
    const mixed = docs.find((d) => d.uri.endsWith('/rules/mixed.md'))!;
    expect(mixed.content).toContain('examples/orders/**');
    expect(mixed.content).not.toContain('billing');
    expect(docs.every((d) => !d.content.includes('Invoice'))).toBe(true);
  });

  test('runtime skills are never listed', () => {
    expect(uris(build('all')).some((u) => u.includes('operator'))).toBe(false);
  });

  test("'all' equals the generated orders dev skill", async () => {
    const docs = catalogue({
      authoring,
      lock: fullLock,
      fullLock,
      rules: [],
      skillAccess: 'all',
    });
    const generated = await Bun.file(
      resolve(root, '.agents/skills/orders-dev/SKILL.md'),
    ).text();
    expect(
      docs.find((d) => d.uri === 'skill://orders-dev/SKILL.md')!.content,
    ).toBe(generated);
  });

  test('no document carries an absolute path', () => {
    for (const d of build('all')) {
      expect(d.content).not.toContain(root);
      expect(d.content).not.toMatch(/[A-Za-z]:\\|\/Users\/|\/home\/[a-z]/);
    }
  });

  test('title and purpose come from the heading and frontmatter', () => {
    const skill = build('all').find((d) =>
      d.uri.endsWith('agentic-ddd/SKILL.md'),
    )!;
    expect(skill.purpose.startsWith('Declare domains')).toBe(true);
    expect(skill.purpose.length).toBeLessThanOrEqual(160);
    expect(skill.title).not.toBe('');
  });
});

describe('findDoc', () => {
  const docs = build('all');
  test('accepts the full URI and short names', () => {
    const skill = 'skill://agentic-ddd/SKILL.md';
    expect(findDoc(docs, skill)?.uri).toBe(skill);
    expect(findDoc(docs, 'agentic-ddd')?.uri).toBe(skill);
    expect(findDoc(docs, 'orders-dev')?.uri).toBe(
      'skill://orders-dev/SKILL.md',
    );
    expect(findDoc(docs, 'authoring')?.uri).toBe(
      'skill://agentic-ddd/references/authoring.md',
    );
  });

  test('returns undefined for unknown and ambiguous names', () => {
    expect(findDoc(docs, 'nope')).toBeUndefined();
    expect(findDoc(docs, 'SKILL.md')).toBeUndefined();
  });
});

describe('index', () => {
  test('has the language rule, the read order and one row per document', () => {
    const docs = build('all');
    const text = index(docs);
    expect(text).toContain("Reply to the user in the user's language");
    expect(text).toContain('references/authoring.md');
    for (const d of docs) expect(text).toContain(`| ${d.uri} |`);
  });
});
