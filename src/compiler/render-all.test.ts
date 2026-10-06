import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop.js';
import { analyze } from './analyze.js';
import { irHash } from './ir.js';
import { BLOCK_BEGIN, BLOCK_END } from './render/agents-md.js';
import { DEFAULT_OUT, renderAll } from './render/index.js';
import { stripKind } from './render/markdown.js';

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
});
