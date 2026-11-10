import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  link,
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
import { SHOP_MODULE, defineShop } from './__fixtures__/shop';
import { analyze } from './analyze';
import { toPosix } from './ir';
import type { ResolvedConfig } from './config';
import { BLOCK_BEGIN, BLOCK_END } from './render/agents-md';
import { DEFAULT_OUT, renderAll } from './render/index';
import {
  CLAUDE_MD_CONTENT,
  extractAgentsBlock,
  checkOutputs,
  mergeAgentsBlock,
  writeFileAtomic,
  writeOutputs,
} from './write';

const ROOT = resolve(import.meta.dir, '../..');
const rendered = renderAll(
  analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] }).ir,
  DEFAULT_OUT,
);
const block = `${BLOCK_BEGIN}\nconteúdo\n${BLOCK_END}`;

let out: string;
let config: ResolvedConfig;

const rejection = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => null,
    (error: unknown) => error,
  );

beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), 'agentic-write-'));
  config = {
    root: ROOT,
    outRoot: out,
    modules: [SHOP_MODULE],
    out: DEFAULT_OUT,
    mirrors: ['.claude/skills'],
    changesDir: 'changes',
    rules: { dir: '.ai/rules', exclude: [], briefMaxTokens: 2000 },
    verify: { test: ['bun', 'test'], commands: [] },
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
  test('cria o diretório de um CLAUDE.md em subpasta', async () => {
    const nested: ResolvedConfig = {
      ...config,
      out: { ...DEFAULT_OUT, claudeMd: 'claude/CLAUDE.md' },
    };
    const result = await writeOutputs(nested, rendered);
    expect(result.written).toContain('claude/CLAUDE.md');
    expect(await readFile(join(out, 'claude/CLAUDE.md'), 'utf8')).toContain(
      '@AGENTS.md',
    );
  });

  test('escreve tudo e o check fica limpo', async () => {
    await writeOutputs(config, rendered);
    expect(await checkOutputs(config, rendered)).toEqual([]);
    expect(await readFile(join(out, 'CLAUDE.md'), 'utf8')).toBe(
      CLAUDE_MD_CONTENT,
    );
    expect(toPosix(await readlink(join(out, '.claude/skills/shop-dev')))).toBe(
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

  describe('CRLF checkout', () => {
    const toCrlf = async (path: string): Promise<void> => {
      const absolute = join(out, path);
      await writeFile(
        absolute,
        (await readFile(absolute, 'utf8')).replace(/\n/g, '\r\n'),
      );
    };
    const allToCrlf = async (): Promise<void> => {
      for (const path of [...rendered.files.keys(), 'AGENTS.md'])
        await toCrlf(path);
    };

    test('files converted to CRLF by git are not drift', async () => {
      await writeOutputs(config, rendered);
      await allToCrlf();
      expect(await checkOutputs(config, rendered)).toEqual([]);
    });

    test('a real change in a CRLF file is still reported', async () => {
      await writeOutputs(config, rendered);
      await allToCrlf();
      const skillPath = join(out, '.agents/skills/shop-dev/SKILL.md');
      await writeFile(
        skillPath,
        `${await readFile(skillPath, 'utf8')}edited\r\n`,
      );
      const agentsPath = join(out, 'AGENTS.md');
      await writeFile(
        agentsPath,
        (await readFile(agentsPath, 'utf8')).replace(
          '## Domain (agentic-ddd)',
          '## Edited',
        ),
      );
      expect(await checkOutputs(config, rendered)).toEqual([
        { path: '.agents/skills/shop-dev/SKILL.md', reason: 'changed' },
        { path: 'AGENTS.md', reason: 'changed' },
      ]);
    });

    test('a write keeps the CRLF text of the user outside the generated block', async () => {
      await writeFile(
        join(out, 'AGENTS.md'),
        `# Project\r\n\r\nNotes.\r\n\r\n${BLOCK_BEGIN}\r\nold\r\n${BLOCK_END}\r\nend\r\n`,
      );
      await writeOutputs(config, rendered);
      const agents = await readFile(join(out, 'AGENTS.md'), 'utf8');
      expect(agents.startsWith('# Project\r\n\r\nNotes.\r\n\r\n')).toBe(true);
      expect(agents.endsWith(`${BLOCK_END}\r\nend\r\n`)).toBe(true);
    });
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

  test('a stale file inside a kept skill directory is removed and check is clean', async () => {
    await writeOutputs(config, rendered);
    const stale = join(out, '.agents/skills/shop-dev/references/stale.md');
    await writeFile(stale, 'stale\n');
    expect(await checkOutputs(config, rendered)).toContainEqual({
      path: '.agents/skills/shop-dev/references/stale.md',
      reason: 'extra',
    });

    await writeOutputs(config, rendered);

    expect(await lstat(stale).catch(() => null)).toBeNull();
    expect(await checkOutputs(config, rendered)).toEqual([]);
  });

  test('a failure in the middle of the writes leaves the other skill directories as they were', async () => {
    await writeOutputs(config, rendered);
    const sentinel = join(out, '.agents/skills/shop-dev/references/history.md');
    await writeFile(sentinel, 'previous content\n');
    // the runtime directory is written first; its references path cannot be created
    const blocked = join(out, '.agentic/runtime/catalog-operator/references');
    await rm(blocked, { recursive: true });
    await writeFile(blocked, 'not a directory\n');
    const orphan = join(out, '.agents/skills/gone-dev');
    await mkdir(orphan, { recursive: true });
    await writeFile(
      join(orphan, 'SKILL.md'),
      '---\nname: gone-dev\nmetadata:\n  agentic-ddd.generated: "true"\n---\n',
    );

    expect(await rejection(writeOutputs(config, rendered))).not.toBeNull();

    // an orphan directory is removed only after every write, so it survives too
    expect((await lstat(join(orphan, 'SKILL.md'))).isFile()).toBe(true);
    expect(await readFile(sentinel, 'utf8')).toBe('previous content\n');
    expect(
      await readFile(join(out, '.agents/skills/shop-dev/SKILL.md'), 'utf8'),
    ).toBe(rendered.files.get('.agents/skills/shop-dev/SKILL.md')!);
  });

  test('the directory of a removed module goes away with its mirror link', async () => {
    const gone = join(out, '.agents/skills/gone-dev');
    await mkdir(gone, { recursive: true });
    await writeFile(
      join(gone, 'SKILL.md'),
      '---\nname: gone-dev\nmetadata:\n  agentic-ddd.generated: "true"\n---\n',
    );
    const skills = join(out, '.claude/skills');
    await mkdir(skills, { recursive: true });
    await symlink('../../.agents/skills/gone-dev', join(skills, 'gone-dev'));

    const { written } = await writeOutputs(config, rendered);

    expect(await lstat(gone).catch(() => null)).toBeNull();
    expect(await lstat(join(skills, 'gone-dev')).catch(() => null)).toBeNull();
    expect(written).toContain('.agents/skills/gone-dev (removed)');
    expect(written).toContain('.claude/skills/gone-dev (link removed)');
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
      agents.replace('## Domain (agentic-ddd)', '## Mexido'),
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
      '.claude/skills/shop-dev exists and is not a link; it was not replaced',
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
    expect(toPosix(await readlink(join(skills, 'minha')))).toBe(
      '../../.agents/skills/minha',
    );
    expect(toPosix(await readlink(join(skills, 'fora')))).toBe(
      '../../fora/nao-existe',
    );
    expect(await readFile(join(mine, 'SKILL.md'), 'utf8')).toBe(
      '---\nname: minha\n---\n',
    );
  });

  test('check acusa link de espelho órfão que a escrita removeria', async () => {
    await writeOutputs(config, rendered);
    expect(await checkOutputs(config, rendered)).toEqual([]);
    const skills = join(out, '.claude/skills');
    // pendente sob .agents/skills: a escrita remove, então o check acusa
    await symlink('../../.agents/skills/sumiu', join(skills, 'sumiu'));
    // pendente fora de .agents/skills (ex.: link autoral para skills/): não é órfão
    await symlink('../../skills/agentic-ddd', join(skills, 'agentic-ddd'));
    await symlink('../../fora/nao-existe', join(skills, 'fora'));
    // skill do usuário existente: não é órfão
    const mine = join(out, '.agents/skills/minha');
    await mkdir(mine, { recursive: true });
    await writeFile(join(mine, 'SKILL.md'), '---\nname: minha\n---\n');
    await symlink('../../.agents/skills/minha', join(skills, 'minha'));

    expect(await checkOutputs(config, rendered)).toEqual([
      { path: '.claude/skills/sumiu', reason: 'extra' },
    ]);

    await writeOutputs(config, rendered);
    expect(await checkOutputs(config, rendered)).toEqual([]);
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
      '.agents/skills/shop-dev exists and was not generated by agentic-ddd; it was not overwritten',
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
        '.agents/skills/shop-dev exists and was not generated by agentic-ddd; it was not overwritten',
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

  test('AGENTS.md that cannot be read fails write and check without touching the skills', async () => {
    await writeOutputs(config, rendered);
    const skillPath = join(out, '.agents/skills/shop-dev/SKILL.md');
    // a hand edit that a rewrite of the skill directory would erase
    const before = `${await readFile(skillPath, 'utf8')}\nhand edit\n`;
    await writeFile(skillPath, before);
    await rm(join(out, 'AGENTS.md'));
    await mkdir(join(out, 'AGENTS.md'));

    expect(await rejection(writeOutputs(config, rendered))).toMatchObject({
      message: expect.stringMatching(/AGENTS\.md/),
    });
    expect(await readFile(skillPath, 'utf8')).toBe(before);
    expect((await lstat(join(out, 'AGENTS.md'))).isDirectory()).toBe(true);
    expect(await rejection(checkOutputs(config, rendered))).toMatchObject({
      message: expect.stringMatching(/AGENTS\.md/),
    });
  });

  test('a kept skill directory whose SKILL.md is a directory is a conflict, not a crash', async () => {
    const dir = join(out, '.agents/skills/shop-dev');
    await mkdir(join(dir, 'SKILL.md'), { recursive: true });

    expect(await checkOutputs(config, rendered)).toContainEqual({
      path: '.agents/skills/shop-dev',
      reason: 'conflict',
    });
    const { warnings } = await writeOutputs(config, rendered);

    expect(warnings).toContain(
      '.agents/skills/shop-dev exists and was not generated by agentic-ddd; it was not overwritten',
    );
    expect((await lstat(join(dir, 'SKILL.md'))).isDirectory()).toBe(true);
  });

  test('an extra directory with an unreadable SKILL.md does not make write or check fail', async () => {
    await mkdir(join(out, '.agentic/runtime/odd/SKILL.md'), {
      recursive: true,
    });

    await writeOutputs(config, rendered);

    expect(await checkOutputs(config, rendered)).toEqual([]);
    expect(
      (await lstat(join(out, '.agentic/runtime/odd/SKILL.md'))).isDirectory(),
    ).toBe(true);
  });

  test('a stray plain file among the skill directories breaks neither write nor check', async () => {
    await mkdir(join(out, '.agents/skills'), { recursive: true });
    await writeFile(join(out, '.agents/skills/stray.txt'), 'stray\n');

    await writeOutputs(config, rendered);

    expect(await checkOutputs(config, rendered)).toEqual([]);
    expect(await readFile(join(out, '.agents/skills/stray.txt'), 'utf8')).toBe(
      'stray\n',
    );
  });

  test('a symbolic link AGENTS.md stays a link and its target gets the block', async () => {
    const targetDir = join(out, 'shared');
    await mkdir(targetDir);
    const target = join(targetDir, 'real-agents.md');
    await writeFile(target, '# Team notes\n');
    await symlink(target, join(out, 'AGENTS.md'));

    await writeOutputs(config, rendered);

    expect((await lstat(join(out, 'AGENTS.md'))).isSymbolicLink()).toBe(true);
    const text = await readFile(target, 'utf8');
    expect(text.startsWith('# Team notes\n')).toBe(true);
    expect(text).toContain(BLOCK_BEGIN);
    expect((await readdir(out)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    expect(
      (await readdir(targetDir)).filter((n) => n.endsWith('.tmp')),
    ).toEqual([]);
  });

  test('a dangling symbolic link AGENTS.md stays a link and its target is created', async () => {
    const target = join(out, 'not-yet.md');
    await symlink(target, join(out, 'AGENTS.md'));

    await writeOutputs(config, rendered);

    expect((await lstat(join(out, 'AGENTS.md'))).isSymbolicLink()).toBe(true);
    expect(await readFile(target, 'utf8')).toContain(BLOCK_BEGIN);
    expect((await readdir(out)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  test('AGENTS.md is replaced, not rewritten in place: a hard link keeps the old content', async () => {
    const path = join(out, 'AGENTS.md');
    await writeFile(path, '# Old notes\n');
    await link(path, join(out, 'AGENTS.copy.md'));

    await writeOutputs(config, rendered);

    expect(await readFile(path, 'utf8')).toContain(BLOCK_BEGIN);
    expect(await readFile(join(out, 'AGENTS.copy.md'), 'utf8')).toBe(
      '# Old notes\n',
    );
  });

  test('writeFileAtomic replaces the content and leaves no temporary file', async () => {
    const path = join(out, 'atomic.txt');
    await writeFile(path, 'old\n');
    await writeFileAtomic(path, 'new\n');
    expect(await readFile(path, 'utf8')).toBe('new\n');
    expect((await readdir(out)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  test('writeFileAtomic keeps the destination and cleans up when the rename fails', async () => {
    const path = join(out, 'is-a-dir');
    await mkdir(path);
    expect(await rejection(writeFileAtomic(path, 'x\n'))).toBeInstanceOf(
      Error,
    );
    expect((await lstat(path)).isDirectory()).toBe(true);
    expect((await readdir(out)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
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
