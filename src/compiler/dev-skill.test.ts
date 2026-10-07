import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop';
import { analyze } from './analyze';
import { renderDevSkill } from './render/dev-skill';
import type { IR } from './ir';

const ROOT = resolve(import.meta.dir, '../..');
const { ir } = analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] });
const files = renderDevSkill(ir, ir.modules[0]!, 'hash-fixo');
const skill = files.get('SKILL.md')!;

describe('renderDevSkill', () => {
  test('gera SKILL.md e references', () => {
    expect([...files.keys()]).toEqual([
      'SKILL.md',
      'references/history.md',
      'references/schemas.json',
      'references/state-machine.md',
    ]);
  });

  test('lista o histórico de mudanças nas referências', () => {
    expect(skill).toContain('- [Histórico de mudanças](references/history.md)');
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

  test('limita description a 1024 caracteres quando há muitos use-cases', () => {
    // Build IR manually with 60 use-cases
    const largeIR: IR = {
      irVersion: 1,
      modules: [{ name: 'large', path: 'src/large' }],
      entities: [
        {
          id: 'entity:Item',
          name: 'Item',
          module: 'large',
          description: 'Test item',
          states: [],
          invariants: [],
          methods: [],
          source: 'src/large:1',
        },
      ],
      events: [],
      useCases: Array.from({ length: 60 }, (_, i) => ({
        id: `usecase:caso_de_uso_${i}`,
        name: `caso_de_uso_${i}`,
        module: 'large',
        description: `Use case ${i}`,
        whenToUse: 'Always',
        whenNotToUse: null,
        inputSchema: {},
        outputSchema: {},
        uses: [],
        emits: [],
        source: `src/large:${i + 2}`,
      })),
      operators: [],
    };

    const largeFiles = renderDevSkill(
      largeIR,
      largeIR.modules[0]!,
      'hash-fixo',
    );
    const largeSkill = largeFiles.get('SKILL.md')!;

    // Extract frontmatter
    const frontmatterMatch = largeSkill.match(/^---\n([\s\S]*?)\n---/);
    expect(frontmatterMatch).toBeTruthy();
    const frontmatter = frontmatterMatch![1]!;

    // Parse description from frontmatter
    const descMatch = frontmatter.match(/^description: "(.+)"$/m);
    expect(descMatch).toBeTruthy();
    const description = JSON.parse(`"${descMatch![1]!}"`);

    // Must be ≤ 1024 chars
    expect(description.length).toBeLessThanOrEqual(1024);

    // Must use count form: should contain "60 use-cases"
    expect(description).toContain('60 use-cases');

    // Normal shop should still use names form
    const normalDesc = skill
      .match(/^description: "(.+)"$/m)?.[1]!
      .replace(/\\"/g, '"');
    expect(normalDesc).toContain('create_product');
    expect(normalDesc).toContain('publish_product');
  });
});
