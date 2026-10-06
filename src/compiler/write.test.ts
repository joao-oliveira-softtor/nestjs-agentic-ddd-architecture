import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop.js';
import { analyze } from './analyze.js';
import type { ResolvedConfig } from './config.js';
import { BLOCK_BEGIN, BLOCK_END } from './render/agents-md.js';
import { DEFAULT_OUT, renderAll } from './render/index.js';
import {
  CLAUDE_MD_CONTENT,
  checkOutputs,
  mergeAgentsBlock,
  writeOutputs,
} from './write.js';

const ROOT = resolve(import.meta.dir, '../..');
const rendered = renderAll(
  analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] }).ir,
  DEFAULT_OUT,
);
const block = `${BLOCK_BEGIN}\nconteúdo\n${BLOCK_END}`;

let out: string;
let config: ResolvedConfig;

beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), 'agentic-write-'));
  config = {
    root: ROOT,
    outRoot: out,
    modules: [SHOP_MODULE],
    out: DEFAULT_OUT,
    mirrors: ['.claude/skills'],
  };
});

afterEach(async () => {
  await rm(out, { recursive: true, force: true });
});

describe('mergeAgentsBlock', () => {
  test('cria o arquivo quando não existe', () => {
    expect(mergeAgentsBlock(null, block)).toBe(`# AGENTS.md\n\n${block}\n`);
  });

  test('anexa o bloco preservando texto manual sem marcadores', () => {
    expect(mergeAgentsBlock('# Projeto\n\nNotas do time.\n', block)).toBe(
      `# Projeto\n\nNotas do time.\n\n${block}\n`,
    );
  });

  test('substitui só o bloco e preserva o resto', () => {
    const existing = `# Projeto\n\n${BLOCK_BEGIN}\nvelho\n${BLOCK_END}\n\nRodapé manual.\n`;
    expect(mergeAgentsBlock(existing, block)).toBe(
      `# Projeto\n\n${block}\n\nRodapé manual.\n`,
    );
  });

  test('marcadores corrompidos (fim antes do início) fazem anexar', () => {
    const existing = `${BLOCK_END}\n${BLOCK_BEGIN}\n`;
    expect(mergeAgentsBlock(existing, block)).toBe(
      `${existing.trimEnd()}\n\n${block}\n`,
    );
  });
});

describe('writeOutputs / checkOutputs', () => {
  test('escreve tudo e o check fica limpo', async () => {
    await writeOutputs(config, rendered);
    expect(await checkOutputs(config, rendered)).toEqual([]);
    expect(await readFile(join(out, 'CLAUDE.md'), 'utf8')).toBe(
      CLAUDE_MD_CONTENT,
    );
    expect(await readlink(join(out, '.claude/skills/shop-dev'))).toBe(
      '../../.agents/skills/shop-dev',
    );
  });

  test('detecta arquivo alterado, removido e extra', async () => {
    await writeOutputs(config, rendered);
    await writeFile(
      join(out, '.agents/skills/shop-dev/SKILL.md'),
      'mexido à mão',
    );
    await rm(
      join(
        out,
        '.agentic/runtime/catalog-operator/references/tools.schema.json',
      ),
    );
    await writeFile(
      join(out, '.agentic/runtime/catalog-operator/references/velho.md'),
      'x',
    );
    expect(await checkOutputs(config, rendered)).toEqual([
      {
        path: '.agentic/runtime/catalog-operator/references/tools.schema.json',
        reason: 'missing',
      },
      {
        path: '.agentic/runtime/catalog-operator/references/velho.md',
        reason: 'extra',
      },
      { path: '.agents/skills/shop-dev/SKILL.md', reason: 'changed' },
    ]);
  });

  test('remove skill gerada órfã e nunca toca skill do usuário', async () => {
    const orphan = join(out, '.agentic/runtime/old-operator');
    await mkdir(orphan, { recursive: true });
    await writeFile(
      join(orphan, 'SKILL.md'),
      '---\nname: old-operator\nmetadata:\n  agentic-ddd.generated: "true"\n---\n',
    );
    const mine = join(out, '.agents/skills/minha-skill');
    await mkdir(mine, { recursive: true });
    await writeFile(join(mine, 'SKILL.md'), '---\nname: minha-skill\n---\n');

    expect(await checkOutputs(config, rendered)).toContainEqual({
      path: '.agentic/runtime/old-operator',
      reason: 'extra',
    });
    await writeOutputs(config, rendered);
    expect(await lstat(orphan).catch(() => null)).toBeNull();
    expect(await readFile(join(mine, 'SKILL.md'), 'utf8')).toBe(
      '---\nname: minha-skill\n---\n',
    );
    expect(await checkOutputs(config, rendered)).toEqual([]);
  });

  test('AGENTS.md: preserva texto manual e só o bloco conta para o check', async () => {
    await writeFile(join(out, 'AGENTS.md'), '# Projeto\n\nNotas do time.\n');
    await writeOutputs(config, rendered);
    const agents = await readFile(join(out, 'AGENTS.md'), 'utf8');
    expect(
      agents.startsWith(
        '# Projeto\n\nNotas do time.\n\n<!-- agentic-ddd:begin -->',
      ),
    ).toBe(true);
    await writeFile(
      join(out, 'AGENTS.md'),
      agents.replace('Notas do time.', 'Notas novas.'),
    );
    expect(await checkOutputs(config, rendered)).toEqual([]);
    await writeFile(
      join(out, 'AGENTS.md'),
      agents.replace('## Domínio (agentic-ddd)', '## Mexido'),
    );
    expect(await checkOutputs(config, rendered)).toEqual([
      { path: 'AGENTS.md', reason: 'changed' },
    ]);
  });

  test('CLAUDE.md existente nunca é sobrescrito', async () => {
    await writeFile(join(out, 'CLAUDE.md'), 'meu CLAUDE.md\n');
    await writeOutputs(config, rendered);
    expect(await readFile(join(out, 'CLAUDE.md'), 'utf8')).toBe(
      'meu CLAUDE.md\n',
    );
  });

  test('espelho: link errado vira drift; diretório real não é substituído', async () => {
    await writeOutputs(config, rendered);
    await rm(join(out, '.claude/skills/shop-dev'));
    await symlink('../outro-lugar', join(out, '.claude/skills/shop-dev'));
    expect(await checkOutputs(config, rendered)).toEqual([
      { path: '.claude/skills/shop-dev', reason: 'mirror' },
    ]);

    await rm(join(out, '.claude/skills/shop-dev'));
    await mkdir(join(out, '.claude/skills/shop-dev'));
    const { warnings } = await writeOutputs(config, rendered);
    expect(warnings).toEqual([
      '.claude/skills/shop-dev existe e não é um link; não foi substituído',
    ]);
    expect(
      (await lstat(join(out, '.claude/skills/shop-dev'))).isDirectory(),
    ).toBe(true);
  });
});
