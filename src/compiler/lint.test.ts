import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop.js';
import { analyze } from './analyze.js';
import { approxTokens, lintRendered, lintSkill } from './lint.js';
import { DEFAULT_OUT, renderAll } from './render/index.js';

const ROOT = resolve(import.meta.dir, '../..');

function skill(name: string, description: string, body = 'Corpo.\n'): string {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\nmetadata:\n  agentic-ddd.generated: "true"\n---\n${body}`;
}

const errorsOf = (path: string, content: string) =>
  lintSkill(path, content)
    .filter((f) => f.severity === 'error')
    .map((f) => f.message);

describe('lintSkill', () => {
  test('skill válida não tem erros', () => {
    expect(
      errorsOf(
        'x/minha-skill/SKILL.md',
        skill('minha-skill', 'Faz algo. Use quando precisar.'),
      ),
    ).toEqual([]);
  });

  test('name diferente da pasta ou fora do padrão', () => {
    expect(errorsOf('x/outra/SKILL.md', skill('minha-skill', 'D.'))).toEqual([
      'name "minha-skill" difere da pasta "outra"',
    ]);
    expect(
      errorsOf('x/Minha--Skill/SKILL.md', skill('Minha--Skill', 'D.')),
    ).toContain(
      'name "Minha--Skill" fora do padrão (a-z, 0-9 e hífens simples; até 64)',
    );
  });

  test('description vazia ou acima de 1024 caracteres', () => {
    expect(errorsOf('x/s/SKILL.md', skill('s', ''))).toEqual([
      'description com 0 caracteres (precisa de 1 a 1024)',
    ]);
    expect(errorsOf('x/s/SKILL.md', skill('s', 'a'.repeat(1100)))).toEqual([
      'description com 1100 caracteres (precisa de 1 a 1024)',
    ]);
  });

  test('SKILL.md acima de 500 linhas e referência profunda', () => {
    expect(
      errorsOf('x/s/SKILL.md', skill('s', 'D.', 'linha\n'.repeat(500))),
    ).toContain('SKILL.md com 507 linhas (máximo 500)');
    expect(
      errorsOf('x/s/SKILL.md', skill('s', 'D.', '[x](references/a/b.md)\n')),
    ).toEqual([
      'referência references/a/b.md passa de um nível de profundidade',
    ]);
  });

  test('frontmatter ausente', () => {
    expect(errorsOf('x/s/SKILL.md', '# sem frontmatter\n')).toEqual([
      'frontmatter YAML ausente',
    ]);
  });

  test('orçamento de tokens vira aviso', () => {
    const findings = lintSkill(
      'x/s/SKILL.md',
      skill('s', 'D.', 'x'.repeat(21_000)),
    );
    expect(findings).toEqual([
      {
        path: 'x/s/SKILL.md',
        severity: 'warning',
        message: 'corpo com ~5250 tokens (orçamento < 5000)',
      },
    ]);
    expect(approxTokens('abcd')).toBe(1);
  });

  test('as skills geradas do shop passam no lint', () => {
    const rendered = renderAll(
      analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] }).ir,
      DEFAULT_OUT,
    );
    expect(
      lintRendered(rendered).filter((f) => f.severity === 'error'),
    ).toEqual([]);
  });
});
