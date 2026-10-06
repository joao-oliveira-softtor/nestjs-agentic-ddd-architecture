import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop.js';
import { analyze } from './analyze.js';
import { table, typeLabel } from './render/markdown.js';
import { renderRuntimeSkill } from './render/runtime-skill.js';

const ROOT = resolve(import.meta.dir, '../..');
const { ir } = analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] });
const operator = ir.operators[0]!;
const files = renderRuntimeSkill(ir, operator, 'hash-fixo');
const skill = files.get('SKILL.md')!;

describe('renderRuntimeSkill', () => {
  test('gera SKILL.md e references na ordem fixa', () => {
    expect([...files.keys()]).toEqual([
      'SKILL.md',
      'references/state-machine.md',
      'references/tools.schema.json',
    ]);
  });

  test('frontmatter só com campos da especificação', () => {
    expect(skill.split('\n').slice(0, 8)).toEqual([
      '---',
      'name: catalog-operator',
      `description: ${JSON.stringify(operator.description)}`,
      'metadata:',
      '  agentic-ddd.audience: runtime',
      '  agentic-ddd.generated: "true"',
      '  agentic-ddd.ir-hash: "hash-fixo"',
      '---',
    ]);
    expect(skill).toContain(
      '<!-- GERADO por agentic-ddd compile — não edite. Fonte: src/compiler/__fixtures__/shop.ts:',
    );
  });

  test('documenta cada tool com parâmetros, uses, emits e aprovação', () => {
    expect(skill).toContain('### `publish_product`');
    expect(skill).toContain(
      '| `product_id` | string | sim | Id do produto a publicar |',
    );
    expect(skill).toContain('- **Aciona:** `Product.publish`');
    expect(skill).toContain('- **Emite:** `ProductPublished`');
    expect(skill).toContain(
      '- **Quando não usar:** Para alterar preço ou estoque.',
    );
    expect(skill.match(/- \*\*Exige aprovação humana:\*\* sim/g)).toHaveLength(
      1,
    );
    expect(skill.match(/- \*\*Exige aprovação humana:\*\* não/g)).toHaveLength(
      1,
    );
  });

  test('lista regras e transições das entidades envolvidas', () => {
    expect(skill).toContain(
      '| `invariant:Product/publicacao-exige-estoque` | Só é possível publicar um produto com estoque maior que zero. | `Product.publish` |',
    );
    expect(skill).toContain(
      '| `invariant:Product/preco-positivo` | O preço de um produto é sempre maior que zero. | construção |',
    );
    expect(skill).toContain('| `Product.publish` | `draft` | `published` |');
  });

  test('tools.schema.json tem input e output de cada tool', () => {
    const tools = JSON.parse(
      files.get('references/tools.schema.json')!,
    ) as Record<string, { input: { required: string[] } }>;
    expect(Object.keys(tools)).toEqual(['create_product', 'publish_product']);
    expect(tools.publish_product!.input.required).toEqual(['product_id']);
  });

  test('typeLabel cobre enum, const, tipos, arrays e anyOf', () => {
    expect(typeLabel({ enum: ['a', 'b'] })).toBe('enum: a, b');
    expect(typeLabel({ const: 'x' })).toBe('const: x');
    expect(typeLabel({ type: ['string', 'null'] })).toBe('string | null');
    expect(typeLabel({ anyOf: [{ type: 'string' }, { type: 'number' }] })).toBe(
      'string | number',
    );
    expect(typeLabel({ type: 'array', items: { type: 'object' } })).toBe(
      'array<object>',
    );
    expect(typeLabel({ type: 'array' })).toBe('array');
    expect(typeLabel({ type: 'object' })).toBe('object');
    expect(typeLabel({})).toBe('qualquer');
  });

  test('SKILL.md contém legenda de aprovação e referência ao schema', () => {
    expect(skill).toContain(
      'Tools marcadas com **Exige aprovação humana: sim** só executam depois de uma pessoa aprovar; se a aprovação for negada, a tool devolve o erro `approval_denied` e nada é alterado.',
    );
    expect(skill).toContain(
      '`references/tools.schema.json` → `publish_product`',
    );
  });

  test('snapshot dos arquivos', () => {
    for (const [path, content] of files) expect(content).toMatchSnapshot(path);
  });

  test('descrição com aspas, barra vertical e quebra de linha mantém o frontmatter numa linha', () => {
    const tricky = {
      ...operator,
      description: 'Opera "pedidos" | estoque\ncom cuidado',
    };
    const lines = renderRuntimeSkill(ir, tricky, 'h')
      .get('SKILL.md')!
      .split('\n');
    expect(lines[7]).toBe('---');
    expect(JSON.parse(lines[2]!.slice('description: '.length))).toBe(
      'Opera "pedidos" | estoque com cuidado',
    );
  });

  test('table escapa barra vertical e quebra de linha nas células', () => {
    expect(table(['A', 'B'], [['x | y', 'linha\nquebrada']])).toBe(
      '| A | B |\n|---|---|\n| x \\| y | linha quebrada |',
    );
  });
});
