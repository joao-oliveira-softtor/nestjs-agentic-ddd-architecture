import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop.js';
import { analyze } from './analyze.js';
import { renderDevSkill } from './render/dev-skill.js';

const ROOT = resolve(import.meta.dir, '../..');
const { ir } = analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] });
const files = renderDevSkill(ir, ir.modules[0]!, 'hash-fixo');
const skill = files.get('SKILL.md')!;

describe('renderDevSkill', () => {
  test('gera SKILL.md e references', () => {
    expect([...files.keys()]).toEqual([
      'SKILL.md',
      'references/schemas.json',
      'references/state-machine.md',
    ]);
  });

  test('frontmatter de dev com nome do módulo', () => {
    expect(
      skill.startsWith(
        '---\nname: shop-dev\ndescription: "Domínio shop: entidades Product; use-cases create_product, publish_product; operators catalog-operator.',
      ),
    ).toBe(true);
    expect(skill).toContain('  agentic-ddd.audience: dev');
  });

  test('descreve entidade, invariantes com quem garante e métodos com fonte', () => {
    expect(skill).toContain('### Product — `entity:Product`');
    expect(skill).toMatch(
      /\| `invariant:Product\/publicacao-exige-estoque` \| Só é possível publicar um produto com estoque maior que zero\. \| `Product\.publish` \| `src\/compiler\/__fixtures__\/shop\.ts:\d+` \|/,
    );
    expect(skill).toMatch(
      /\| `Product\.publish` \| Publica o produto no catálogo\. \| `draft` → `published` \| `ProductPublished` \|/,
    );
  });

  test('lista dependências e obrigações de teste sem nenhum estado de implementação', () => {
    expect(skill).toContain(
      '| `usecase:create_product` | application | `entity:Product` |',
    );
    expect(skill).toContain(
      '| `method:Product.publish` | `invariant:Product/publicacao-exige-estoque`, `method:Product.publish` |',
    );
    expect(skill).not.toMatch(/\bpendente|\bpendência/i);
  });

  test('explica como estender usando o caminho do módulo', () => {
    expect(skill).toContain(
      '| Use-case | `src/compiler/__fixtures__/application/<nome>.ts` |',
    );
  });

  test('snapshot dos arquivos', () => {
    for (const [path, content] of files) expect(content).toMatchSnapshot(path);
  });
});
