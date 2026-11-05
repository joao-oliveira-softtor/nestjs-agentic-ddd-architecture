import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop';
import { analyze } from './analyze';
import { approxTokens, lintRendered, lintSkill } from './lint';
import { DEFAULT_OUT, renderAll } from './render/index';

const ROOT = resolve(import.meta.dir, '../..');

function skill(name: string, description: string, body = 'Body.\n'): string {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\nmetadata:\n  agentic-ddd.generated: "true"\n---\n${body}`;
}

const errorCodesOf = (path: string, content: string) =>
  lintSkill(path, content)
    .filter((f) => f.severity === 'error')
    .map((f) => f.code);

describe('lintSkill', () => {
  test('valid skill has no errors', () => {
    expect(
      errorCodesOf(
        'x/my-skill/SKILL.md',
        skill('my-skill', 'Does something. Use when needed.'),
      ),
    ).toEqual([]);
  });

  test('name differs from the folder or does not match the pattern', () => {
    expect(errorCodesOf('x/other/SKILL.md', skill('my-skill', 'D.'))).toEqual([
      'lint.name-mismatch',
    ]);
    expect(
      errorCodesOf('x/My--Skill/SKILL.md', skill('My--Skill', 'D.')),
    ).toContain('lint.name-invalid');
  });

  test('description empty or longer than 1024 characters', () => {
    expect(errorCodesOf('x/s/SKILL.md', skill('s', ''))).toEqual([
      'lint.description-length',
    ]);
    expect(errorCodesOf('x/s/SKILL.md', skill('s', 'a'.repeat(1100)))).toEqual([
      'lint.description-length',
    ]);
  });

  test('description length message reports the character count', () => {
    expect(
      lintSkill('x/s/SKILL.md', skill('s', 'a'.repeat(1100)))[0]?.message,
    ).toBe('description has 1100 characters (needs 1 to 1024)');
  });

  test('SKILL.md over 500 lines and a deep reference', () => {
    expect(
      errorCodesOf('x/s/SKILL.md', skill('s', 'D.', 'line\n'.repeat(500))),
    ).toContain('lint.skill-too-long');
    expect(
      errorCodesOf(
        'x/s/SKILL.md',
        skill('s', 'D.', '[x](references/a/b.md)\n'),
      ),
    ).toEqual(['lint.reference-too-deep']);
  });

  test('SKILL.md with exactly 500 lines has no error', () => {
    expect(
      errorCodesOf('x/s/SKILL.md', skill('s', 'D.', 'line\n'.repeat(494))),
    ).toEqual([]);
  });

  test('missing frontmatter', () => {
    expect(errorCodesOf('x/s/SKILL.md', '# no frontmatter\n')).toEqual([
      'lint.frontmatter-missing',
    ]);
  });

  test('token budget becomes a warning', () => {
    const findings = lintSkill(
      'x/s/SKILL.md',
      skill('s', 'D.', 'x'.repeat(21_000)),
    );
    expect(findings).toEqual([
      {
        path: 'x/s/SKILL.md',
        severity: 'warning',
        code: 'lint.body-tokens',
        message: 'body is ~5250 tokens (budget < 5000)',
      },
    ]);
    expect(approxTokens('abcd')).toBe(1);
  });

  test('skills generated for shop pass lint', () => {
    const rendered = renderAll(
      analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] }).ir,
      DEFAULT_OUT,
    );
    expect(
      lintRendered(rendered).filter((f) => f.severity === 'error'),
    ).toEqual([]);
  });
});
