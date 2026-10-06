import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
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
  extractAgentsBlock,
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

  test('marcador citado no meio de uma frase não conta como bloco', () => {
    const existing = `Use ${BLOCK_BEGIN} para abrir o bloco.\n\n${BLOCK_BEGIN}\nvelho\n${BLOCK_END}\n\nRodapé.\n`;
    expect(extractAgentsBlock(existing)).toBe(
      `${BLOCK_BEGIN}\nvelho\n${BLOCK_END}`,
    );
    expect(mergeAgentsBlock(existing, block)).toBe(
      `Use ${BLOCK_BEGIN} para abrir o bloco.\n\n${block}\n\nRodapé.\n`,
    );
    expect(extractAgentsBlock(`Só cita ${BLOCK_BEGIN} e ${BLOCK_END}.\n`)).toBe(
      null,
    );
  });

  test('é idempotente, inclusive com marcadores corrompidos', () => {
    for (const existing of [
      null,
      '# Projeto\n\nNotas.\n',
      `${BLOCK_BEGIN}\nvelho\n${BLOCK_END}\n`,
      `${BLOCK_END}\n${BLOCK_BEGIN}\n`,
    ]) {
      const once = mergeAgentsBlock(existing, block);
      expect(mergeAgentsBlock(once, block)).toBe(once);
    }
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
    const skillPath = join(out, '.agents/skills/shop-dev/SKILL.md');
    await writeFile(
      skillPath,
      `${await readFile(skillPath, 'utf8')}\nmexido à mão\n`,
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
    expect(await checkOutputs(config, rendered)).toEqual([
      { path: '.claude/skills/shop-dev', reason: 'conflict' },
    ]);

    await rm(join(out, '.claude/skills/shop-dev'), { recursive: true });
    expect(await checkOutputs(config, rendered)).toEqual([
      { path: '.claude/skills/shop-dev', reason: 'mirror' },
    ]);
  });

  test('espelho: remove só link órfão de skill gerada; link do usuário sobrevive', async () => {
    const old = join(out, '.agents/skills/velha-dev');
    await mkdir(old, { recursive: true });
    await writeFile(
      join(old, 'SKILL.md'),
      '---\nname: velha-dev\nmetadata:\n  agentic-ddd.generated: "true"\n---\n',
    );
    const mine = join(out, '.agents/skills/minha');
    await mkdir(mine, { recursive: true });
    await writeFile(join(mine, 'SKILL.md'), '---\nname: minha\n---\n');
    await mkdir(join(out, '.claude/skills'), { recursive: true });
    const skills = join(out, '.claude/skills');
    await symlink('../../.agents/skills/velha-dev', join(skills, 'velha-dev'));
    await symlink('../../.agents/skills/minha', join(skills, 'minha'));
    await symlink('../../.agents/skills/sumiu', join(skills, 'sumiu'));
    await symlink('../../fora/nao-existe', join(skills, 'fora'));

    await writeOutputs(config, rendered);

    expect(await lstat(join(skills, 'velha-dev')).catch(() => null)).toBeNull();
    expect(await lstat(join(skills, 'sumiu')).catch(() => null)).toBeNull();
    expect(await readlink(join(skills, 'minha'))).toBe(
      '../../.agents/skills/minha',
    );
    expect(await readlink(join(skills, 'fora'))).toBe('../../fora/nao-existe');
    expect(await readFile(join(mine, 'SKILL.md'), 'utf8')).toBe(
      '---\nname: minha\n---\n',
    );
  });

  test('skill do usuário com o mesmo nome não é sobrescrita e vira conflito', async () => {
    const dir = join(out, '.agents/skills/shop-dev');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'SKILL.md'),
      '---\nname: shop-dev\n---\nmanual\n',
    );

    const { warnings } = await writeOutputs(config, rendered);

    expect(warnings).toEqual([
      '.agents/skills/shop-dev existe e não foi gerado pelo agentic-ddd; não foi sobrescrito',
    ]);
    expect(await readFile(join(dir, 'SKILL.md'), 'utf8')).toBe(
      '---\nname: shop-dev\n---\nmanual\n',
    );
    expect(await readdir(dir)).toEqual(['SKILL.md']);
    expect(
      await lstat(join(out, '.claude/skills/shop-dev')).catch(() => null),
    ).toBeNull();
    expect(await checkOutputs(config, rendered)).toEqual([
      { path: '.agents/skills/shop-dev', reason: 'conflict' },
    ]);
  });

  test('pasta gerenciada existente sem SKILL.md é conflito e não perde arquivos do usuário', async () => {
    const dir = join(out, '.agents/skills/shop-dev');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'notes.md'), 'minhas notas\n');

    for (let i = 0; i < 2; i++) {
      const { warnings } = await writeOutputs(config, rendered);
      expect(warnings).toEqual([
        '.agents/skills/shop-dev existe e não foi gerado pelo agentic-ddd; não foi sobrescrito',
      ]);
      expect(await readdir(dir)).toEqual(['notes.md']);
      expect(await readFile(join(dir, 'notes.md'), 'utf8')).toBe(
        'minhas notas\n',
      );
    }
    expect(await checkOutputs(config, rendered)).toEqual([
      { path: '.agents/skills/shop-dev', reason: 'conflict' },
    ]);
  });

  test('a marca de gerado só vale no frontmatter', async () => {
    const dir = join(out, '.agentic/runtime/doc-operator');
    await mkdir(dir, { recursive: true });
    const text =
      '---\nname: doc-operator\n---\nCita agentic-ddd.generated: "true"\n';
    await writeFile(join(dir, 'SKILL.md'), text);

    expect(await checkOutputs(config, rendered)).not.toContainEqual({
      path: '.agentic/runtime/doc-operator',
      reason: 'extra',
    });
    await writeOutputs(config, rendered);
    expect(await readFile(join(dir, 'SKILL.md'), 'utf8')).toBe(text);
  });
});
