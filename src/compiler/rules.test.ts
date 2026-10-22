import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop';
import { analyze } from './analyze';
import { resolveConfig } from './config';
import { BLOCK_END, renderAgentsBlock } from './render/agents-md';
import {
  CORE_RULES,
  RuleError,
  briefRules,
  composeRules,
  fillMarkers,
  loadRules,
  ruleHash,
  rulesFor,
  type Rule,
} from './rules';

const ROOT = resolve(import.meta.dir, '../..');

const team = (key: string, body = 'texto', paths: string[] | null = null) =>
  ({ key, file: `.ai/rules/${key}.md`, paths, body }) satisfies Rule;

function failure(fn: () => unknown): RuleError {
  try {
    fn();
  } catch (error) {
    if (error instanceof RuleError) return error;
    throw error;
  }
  throw new Error('esperava RuleError');
}

describe('CORE_RULES', () => {
  test('com os marcadores preenchidos reproduz as convenções do bloco de hoje', () => {
    const { ir } = analyze(defineShop(), {
      root: ROOT,
      modules: [SHOP_MODULE],
    });
    const paths = {
      devSkills: '.agents/skills',
      runtimeSkills: '.agentic/runtime',
      changesDir: 'changes',
    };
    const block = renderAgentsBlock(ir, paths);
    const lines = block
      .slice(block.indexOf('### Convenções\n\n') + '### Convenções\n\n'.length)
      .replace(BLOCK_END, '')
      .trimEnd()
      .split('\n');
    const values = {
      changes: paths.changesDir,
      devSkills: paths.devSkills,
      runtimeSkills: paths.runtimeSkills,
    };
    expect(CORE_RULES.map((r) => fillMarkers(r.body, values))).toEqual(lines);
    expect(CORE_RULES.map((r) => r.key)).toEqual([
      'core/decorators',
      'core/layers',
      'core/private-methods',
      'core/not-implemented',
      'core/coordination',
      'core/skeleton',
      'core/tests-covers',
      'core/changes',
      'core/done',
      'core/generated',
    ]);
    expect(CORE_RULES.every((r) => r.file === null && r.paths === null)).toBe(
      true,
    );
  });
});

describe('composeRules', () => {
  test('regra do time com chave do núcleo substitui na mesma posição', () => {
    const out = composeRules([team('core/layers', 'novo')], []);
    expect(out.map((r) => r.key)).toEqual(CORE_RULES.map((r) => r.key));
    expect(out[1]!.body).toBe('novo');
    expect(out[1]!.file).toBe('.ai/rules/core/layers.md');
  });

  test('exclude remove chaves do núcleo', () => {
    const out = composeRules([team('a')], ['core/done', 'core/generated']);
    expect(out.map((r) => r.key)).toEqual([
      ...CORE_RULES.slice(0, 8).map((r) => r.key),
      'a',
    ]);
  });

  test('regras do time vêm depois do núcleo em ordem lexicográfica de chave', () => {
    const out = composeRules(
      [team('b'), team('B'), team('a/z'), team('a')],
      [],
    );
    expect(out.slice(CORE_RULES.length).map((r) => r.key)).toEqual([
      'B',
      'a',
      'a/z',
      'b',
    ]);
  });

  test('chave core/ inexistente no núcleo é erro', () => {
    const error = failure(() => composeRules([team('core/nada')], []));
    expect(error.source).toBe('.ai/rules/core/nada.md');
    expect(error.message).toContain('core/nada');
  });

  test('override do núcleo com paths é erro', () => {
    const error = failure(() =>
      composeRules([team('core/layers', 'x', ['app/**'])], []),
    );
    expect(error.source).toBe('.ai/rules/core/layers.md');
    expect(error.message).toContain('paths');
  });

  test('chave de exclude inexistente é erro', () => {
    const error = failure(() => composeRules([], ['nao/existe']));
    expect(error.source).toBe('agentic.config.ts');
    expect(error.message).toContain('nao/existe');
  });

  test('chave no exclude que também tem arquivo do time é erro', () => {
    const error = failure(() => composeRules([team('a')], ['a']));
    expect(error.source).toBe('agentic.config.ts');
    expect(error.message).toContain('a');
  });
});

describe('rulesFor e briefRules', () => {
  const rules = [
    team('livre'),
    team('app-todos', 'x', ['app/**']),
    team('app-ts', 'x', ['app/**/*.ts']),
    team('src-ts', 'x', ['src/*.ts']),
  ];
  const keys = (files: string[]) => rulesFor(rules, files).map((r) => r.key);

  test.each([
    ['app/a.ts', ['livre', 'app-todos', 'app-ts']],
    ['app/x/y/a.ts', ['livre', 'app-todos', 'app-ts']],
    ['app/x/a.md', ['livre', 'app-todos']],
    ['src/a.ts', ['livre', 'src-ts']],
    ['src/x/a.ts', ['livre']],
    ['outro/a.ts', ['livre']],
  ])('arquivo %s', (file, expected) => {
    expect(keys([file])).toEqual(expected);
  });

  test('qualquer arquivo casando basta e a ordem é preservada', () => {
    expect(keys(['src/a.ts', 'app/a.ts'])).toEqual([
      'livre',
      'app-todos',
      'app-ts',
      'src-ts',
    ]);
  });

  test('briefRules inclui a substituição do time e exclui o texto do núcleo', () => {
    const composed = composeRules([team('core/layers', 'novo'), team('z')], []);
    const keysOut = briefRules(composed, []).map((r) => r.key);
    expect(keysOut).toEqual(['core/layers', 'z']);
  });
});

describe('ruleHash', () => {
  test('são 12 hex do sha256 do corpo', () => {
    const hash = ruleHash(team('a', 'abc'));
    expect(hash).toBe('ba7816bf8f01');
  });
});

describe('validação do conteúdo da regra', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agentic-rules-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const config = () =>
    resolveConfig({ modules: [{ name: 'x', path: 'x' }] }, dir);
  async function write(rel: string, content: string) {
    const file = join(dir, '.ai/rules', rel);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, content);
  }
  async function loadError(rel: string, content: string) {
    await write(rel, content);
    try {
      await loadRules(config());
    } catch (error) {
      if (error instanceof RuleError) return error;
      throw error;
    }
    throw new Error('esperava RuleError');
  }

  test('pasta inexistente devolve só o núcleo', async () => {
    expect(await loadRules(config())).toEqual([...CORE_RULES]);
  });

  test('lê subpasta, CRLF, frontmatter e ordena', async () => {
    await write(
      'testes.md',
      '---\r\npaths:\r\n  - "app/**"\r\n---\r\n- Teste em pt.\r\n',
    );
    await write('sub/a.md', '- Linha 1\r\n- Linha 2\r\n');
    await write('ignorado.txt', 'x');
    const out = await loadRules(config());
    const mine = out.slice(CORE_RULES.length);
    expect(mine).toEqual([
      {
        key: 'sub/a',
        file: '.ai/rules/sub/a.md',
        paths: null,
        body: '- Linha 1\n- Linha 2',
      },
      {
        key: 'testes',
        file: '.ai/rules/testes.md',
        paths: ['app/**'],
        body: '- Teste em pt.',
      },
    ]);
  });

  test('override pelo arquivo core/layers.md e exclude da config', async () => {
    await write('core/layers.md', '- Camadas do time');
    const out = await loadRules(
      resolveConfig(
        {
          modules: [{ name: 'x', path: 'x' }],
          rules: { exclude: ['core/done'] },
        },
        dir,
      ),
    );
    expect(out.length).toBe(CORE_RULES.length - 1);
    expect(out[1]!.body).toBe('- Camadas do time');
  });

  test.each([
    ['frontmatter YAML inválido', '---\na: [\n---\ncorpo'],
    ['frontmatter sem fechamento', '---\npaths: ["app/**"]\n- corpo'],
    ['frontmatter que não é objeto', '---\n- a\n---\ncorpo'],
    ['chave de frontmatter desconhecida', '---\nfoo: 1\n---\ncorpo'],
    ['paths vazio', '---\npaths: []\n---\ncorpo'],
    ['paths que não é lista', '---\npaths: app/**\n---\ncorpo'],
    ['paths com item vazio', '---\npaths: [""]\n---\ncorpo'],
    ['glob absoluto', '---\npaths: ["/app/**"]\n---\ncorpo'],
    ['glob com ..', '---\npaths: ["app/../x"]\n---\ncorpo'],
    ['corpo vazio', '---\npaths: ["a/**"]\n---\n  \n'],
    ['título Markdown', '- ok\n## Título\n- ok'],
    ['marcador begin', '- <!-- agentic-ddd:begin -->'],
    ['marcador end', '- <!-- agentic-ddd:end -->'],
  ])('erro: %s', async (_nome, content) => {
    const error = await loadError('r.md', content);
    expect(error.source).toBe('.ai/rules/r.md');
    expect(error.message.length).toBeGreaterThan(10);
  });
});
