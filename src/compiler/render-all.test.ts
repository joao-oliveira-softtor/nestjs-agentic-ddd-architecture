import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop';
import { analyze } from './analyze';
import { resolveConfig } from './config';
import { irHash } from './ir';
import { composeRules, type Rule } from './rules';
import { BLOCK_BEGIN, BLOCK_END } from './render/agents-md';
import { DEFAULT_OUT, renderAll } from './render/index';
import { stripKind } from './render/markdown';

const ROOT = resolve(import.meta.dir, '../..');
const { ir } = analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] });
const rendered = renderAll(ir, DEFAULT_OUT);

describe('renderAll', () => {
  test('gera os arquivos das skills de dev e de runtime nos caminhos padrão', () => {
    expect([...rendered.files.keys()]).toEqual([
      '.agentic/runtime/catalog-operator/SKILL.md',
      '.agentic/runtime/catalog-operator/references/state-machine.md',
      '.agentic/runtime/catalog-operator/references/tools.schema.json',
      '.agents/skills/shop-dev/SKILL.md',
      '.agents/skills/shop-dev/references/history.md',
      '.agents/skills/shop-dev/references/schemas.json',
      '.agents/skills/shop-dev/references/state-machine.md',
    ]);
    expect(rendered.devSkillDirs).toEqual(['shop-dev']);
    expect(rendered.runtimeSkillDirs).toEqual(['catalog-operator']);
  });

  test('todas as skills carregam o mesmo ir-hash', () => {
    const line = `  agentic-ddd.ir-hash: "${irHash(ir)}"`;
    for (const [path, content] of rendered.files)
      if (path.endsWith('SKILL.md')) expect(content).toContain(line);
  });

  test('o bloco do AGENTS.md tem marcadores, mapa e convenções', () => {
    expect(rendered.agentsBlock.startsWith(BLOCK_BEGIN)).toBe(true);
    expect(rendered.agentsBlock.endsWith(BLOCK_END)).toBe(true);
    expect(rendered.agentsBlock).toContain(
      '| shop | `src/compiler/__fixtures__` | `.agents/skills/shop-dev/SKILL.md` |',
    );
    expect(rendered.agentsBlock).toContain(
      '| catalog-operator | `.agentic/runtime/catalog-operator/SKILL.md` |',
    );
    expect(rendered.agentsBlock).toContain('`notImplemented()`');
    expect(rendered.agentsBlock).toContain(
      '`bun run agentic verify <NNNN>` retorna `done` ou `needs-human`',
    );
    expect(rendered.agentsBlock).toContain('`changes/NNNN-<slug>/proposal.md`');
    expect(rendered.agentsBlock).toMatchSnapshot();
  });

  test('fidelidade: todo elemento da IR aparece em ao menos um arquivo gerado', () => {
    const all = [...rendered.files.values()].join('\n');
    const ids = [
      ...ir.entities.flatMap((e) => [
        e.id,
        ...e.invariants.map((i) => i.id),
        ...e.methods.map((m) => stripKind(m.id)),
      ]),
      ...ir.events.map((e) => e.name),
      ...ir.useCases.map((u) => u.name),
      ...ir.operators.map((o) => o.name),
    ];
    expect(ids.filter((id) => !all.includes(id))).toEqual([]);
  });

  test('é determinístico', () => {
    const again = renderAll(
      analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] }).ir,
      DEFAULT_OUT,
    );
    expect([...again.files]).toEqual([...rendered.files]);
    expect(again.agentsBlock).toBe(rendered.agentsBlock);
  });

  test('com regras do time: override, exclude, regra sem paths e índice por caminho', () => {
    const team: Rule[] = [
      {
        key: 'core/layers',
        file: '.ai/rules/core/layers.md',
        paths: null,
        body: '- Camadas do time.',
      },
      {
        key: 'estilo',
        file: '.ai/rules/estilo.md',
        paths: null,
        body: '- Estilo do time.\n- Segunda linha.',
      },
      {
        key: 'testes',
        file: '.ai/rules/testes.md',
        paths: ['src/compiler/__fixtures__/**', 'test/**'],
        body: '- Testes em português.',
      },
      {
        key: 'docs',
        file: '.ai/rules/docs.md',
        paths: ['docs/**'],
        body: '- Docs.',
      },
    ];
    const rules = composeRules(team, ['core/done']);
    const out = renderAll(ir, DEFAULT_OUT, { rules });
    expect(out.agentsBlock).toContain('- Camadas do time.');
    expect(out.agentsBlock).not.toContain('Onde criar:');
    expect(out.agentsBlock).not.toContain('`verify <NNNN>`');
    expect(out.agentsBlock).toContain('- Estilo do time.\n- Segunda linha.');
    expect(out.agentsBlock).not.toContain('Testes em português');
    expect(out.agentsBlock).toContain('### Regras por caminho');
    expect(out.agentsBlock.endsWith(BLOCK_END)).toBe(true);
    expect(out.agentsBlock).toMatchSnapshot();
    const skill = out.files.get('.agents/skills/shop-dev/SKILL.md')!;
    expect(skill).toContain('## Regras do time');
    expect(skill).toContain('.ai/rules/testes.md');
    expect(skill).not.toContain('.ai/rules/docs.md');
    expect(skill).toMatchSnapshot();
  });
  test('convenções de layout: caminhos e sufixos vêm da config, a camada do item vem do decorator', () => {
    const { conventions } = resolveConfig(
      {
        modules: [{ name: 'shop', path: 'src/shop/core' }],
        conventions: {
          layers: { domain: 'model' },
          suffixes: { events: '.evt.ts' },
        },
      },
      ROOT,
    );
    const custom = {
      ...ir,
      modules: ir.modules.map((m) => ({ ...m, path: 'src/shop/core' })),
    };
    const out = renderAll(custom, DEFAULT_OUT, { conventions });
    const skill = out.files.get('.agents/skills/shop-dev/SKILL.md')!;
    expect(skill).toContain('`src/shop/core/model/<nome>.ts`');
    expect(skill).toContain('`src/shop/core/model/<agregado>.evt.ts`');
    expect(skill).toContain('`src/shop/core/application/<nome>.ts`');
    expect(skill).not.toContain('.events.ts');
    expect(out.agentsBlock).toContain('`<caminho do módulo>/model`');
    expect(out.agentsBlock).toContain('`<caminho do módulo>/application`');
    expect(out.agentsBlock).not.toContain('`<caminho do módulo>/domain`');
    expect(skill).toContain('| `entity:Product` | domain |');
    expect(skill).toContain('| `usecase:create_product` | application |');
    expect(skill).toMatchSnapshot();
  });
});
