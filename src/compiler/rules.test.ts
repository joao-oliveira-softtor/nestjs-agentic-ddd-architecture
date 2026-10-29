import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfig } from './config';
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
  test('os marcadores de camada usam layers quando informado', () => {
    const layers = { domain: 'model', application: 'app', operators: 'ops' };
    const layersRule = CORE_RULES.find((r) => r.key === 'core/layers')!;
    const text = fillMarkers(layersRule.body, {
      changes: 'c',
      devSkills: 'd',
      runtimeSkills: 'r',
      layers,
    });
    expect(text).toContain('`<module path>/model` (entities');
    expect(text).toContain('`<module path>/app` (use-cases');
    expect(text).toContain('`<module path>/ops` (operators');
    expect(text).not.toContain('{{');
  });

  test('com os marcadores preenchidos reproduz o texto fixo das convenções anteriores à #66', () => {
    // Texto copiado de agents-md.ts antes da #66, com valores fora do padrão
    // para provar que cada marcador cai no lugar certo.
    const values = {
      changes: 'docs/changes',
      devSkills: 'out/skills',
      runtimeSkills: 'out/runtime',
    };
    expect(CORE_RULES.map((r) => fillMarkers(r.body, values))).toEqual([
      '- Entities, methods, events, use-cases and operators are declared with `@AgentEntity`, `@AgentMethod`, `@AgentEvent`, `@AgentUseCase` and `@Operator` from `@agentic-ddd/decorators`; each business rule is an `@Invariant({ id, text })` with a stable ID.',
      "- Where to create: `<module path>/domain` (entities, events, ports), `<module path>/application` (use-cases, always with `uses`), `<module path>/operators` (operators). The module's dev skill has the exact paths.",
      '- Every public entity method has `@AgentMethod`; helper methods use `#private`.',
      '- A declared body that is not implemented yet uses `notImplemented()` from `@agentic-ddd/core`.',
      '- Coordination: check `bun run agentic status` or `next` (waves); run each item from `bun run agentic packet <item>` and validate it with `bun run agentic verify --item <item> --spec-hash <hash>`. `status --static` reads test declarations without running them and never certifies `done`.',
      '- The skeleton signal only recognizes the literal `notImplemented()` call; an empty body counts as implemented. State is computed on demand and is not written into generated files.',
      '- Tests declare what they cover with `covers([...ids], title)` from `@agentic-ddd/testing`.',
      '- Business rule change: first write the proposal in `docs/changes/NNNN-<slug>/proposal.md` (delta, acceptance criteria and a `## Motivo` section), implement it and run `bun run agentic compile`; for a change already made in the code, `bun run agentic compile --draft-change <slug>` generates the draft.',
      '- A task is only complete when `bun run agentic verify <NNNN>` returns `done` or `needs-human`.',
      '- Generated (do not edit): `out/skills`, `out/runtime`, the skill mirrors and this block. Change the decorated code and run `bun run agentic compile`; CI runs `bun run agentic compile --check`.',
    ]);
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
    expect(error.code).toBe('rules.core-key-unknown');
    expect(error.message).toContain('core/nada');
  });

  test('override do núcleo com paths é erro', () => {
    const error = failure(() =>
      composeRules([team('core/layers', 'x', ['app/**'])], []),
    );
    expect(error.source).toBe('.ai/rules/core/layers.md');
    expect(error.code).toBe('rules.core-paths');
  });

  test('chave de exclude inexistente é erro', () => {
    const error = failure(() => composeRules([], ['nao/existe']));
    expect(error.source).toBe('agentic.config.ts');
    expect(error.code).toBe('rules.exclude-unknown');
    expect(error.message).toContain('nao/existe');
  });

  test('chave no exclude que também tem arquivo do time é erro', () => {
    const error = failure(() => composeRules([team('a')], ['a']));
    expect(error.source).toBe('agentic.config.ts');
    expect(error.code).toBe('rules.exclude-conflict');
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

  test('pasta de regras que é arquivo vira RuleError com a pasta como fonte', async () => {
    await mkdir(join(dir, '.ai'), { recursive: true });
    await writeFile(join(dir, '.ai/rules'), 'não é pasta');
    const error = await loadRules(config()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RuleError);
    expect((error as RuleError).source).toBe('.ai/rules');
  });

  test('links simbólicos para arquivo e para pasta fora da raiz são ignorados', async () => {
    // Protege contra mudança do padrão do Bun.Glob (followSymlinks: false).
    const outside = await mkdtemp(join(tmpdir(), 'agentic-rules-fora-'));
    try {
      await writeFile(join(outside, 'segredo.md'), '- SEGREDO');
      await write('ok.md', '- ok');
      await symlink(
        join(outside, 'segredo.md'),
        join(dir, '.ai/rules/link.md'),
      );
      await symlink(outside, join(dir, '.ai/rules/pasta'), 'dir');
      const team = (await loadRules(config())).filter((r) => r.file !== null);
      expect(team.map((r) => r.key)).toEqual(['ok']);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  test.each([
    ['a própria pasta', '.ai/rules'],
    ['uma pasta pai', '.ai'],
  ])(
    'rules.dir que passa por link para fora da raiz (%s) é RuleError',
    async (_nome, link) => {
      const outside = await mkdtemp(join(tmpdir(), 'agentic-rules-fora-'));
      try {
        await mkdir(join(outside, 'rules'), { recursive: true });
        await writeFile(join(outside, 'rules/segredo.md'), '- SEGREDO');
        await mkdir(join(dir, link, '..'), { recursive: true });
        await symlink(
          link === '.ai' ? outside : join(outside, 'rules'),
          join(dir, link),
          'dir',
        );
        const error = await loadRules(config()).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(RuleError);
        expect((error as RuleError).source).toBe('.ai/rules');
        expect((error as RuleError).code).toBe('rules.dir-outside');
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    },
  );

  test('rules.dir que é link para a própria raiz é RuleError (o scan varreria o projeto)', async () => {
    await mkdir(join(dir, '.ai'), { recursive: true });
    await symlink(dir, join(dir, '.ai/rules'), 'dir');
    const error = await loadRules(config()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RuleError);
    expect((error as RuleError).code).toBe('rules.dir-outside');
  });

  test('pasta de regras chamada ..regras é válida', async () => {
    await mkdir(join(dir, '..regras'), { recursive: true });
    await writeFile(join(dir, '..regras/ok.md'), '- ok');
    const rules = await loadRules(
      resolveConfig(
        { modules: [{ name: 'x', path: 'x' }], rules: { dir: '..regras' } },
        dir,
      ),
    );
    expect(rules.filter((r) => r.file !== null).map((r) => r.file)).toEqual([
      '..regras/ok.md',
    ]);
  });

  test('rules.dir com link que fica dentro da raiz é lido normalmente', async () => {
    await mkdir(join(dir, 'regras-reais'), { recursive: true });
    await writeFile(join(dir, 'regras-reais/ok.md'), '- ok');
    await mkdir(join(dir, '.ai'), { recursive: true });
    await symlink(join(dir, 'regras-reais'), join(dir, '.ai/rules'), 'dir');
    const team = (await loadRules(config())).filter((r) => r.file !== null);
    expect(team.map((r) => r.key)).toEqual(['ok']);
  });

  test('glob com ./ é normalizado e casa com o caminho do item', async () => {
    await write('a.md', '---\npaths: ["./app/**"]\n---\n- a');
    const rule = (await loadRules(config())).find((r) => r.key === 'a')!;
    expect(rule.paths).toEqual(['app/**']);
    expect(rulesFor([rule], ['app/domain/x.ts'])).toEqual([rule]);
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
    [
      'frontmatter YAML inválido',
      '---\na: [\n---\ncorpo',
      'rules.frontmatter-invalid',
    ],
    [
      'frontmatter sem fechamento',
      '---\npaths: ["app/**"]\n- corpo',
      'rules.frontmatter-unclosed',
    ],
    [
      'frontmatter que não é objeto',
      '---\n- a\n---\ncorpo',
      'rules.frontmatter-invalid',
    ],
    [
      'chave de frontmatter desconhecida',
      '---\nfoo: 1\n---\ncorpo',
      'rules.frontmatter-key-unknown',
    ],
    ['paths vazio', '---\npaths: []\n---\ncorpo', 'rules.paths-invalid'],
    [
      'paths que não é lista',
      '---\npaths: app/**\n---\ncorpo',
      'rules.paths-invalid',
    ],
    [
      'paths com item vazio',
      '---\npaths: [""]\n---\ncorpo',
      'rules.paths-invalid',
    ],
    [
      'glob absoluto',
      '---\npaths: ["/app/**"]\n---\ncorpo',
      'rules.glob-invalid',
    ],
    [
      'glob com ..',
      '---\npaths: ["app/../x"]\n---\ncorpo',
      'rules.glob-invalid',
    ],
    ['corpo vazio', '---\npaths: ["a/**"]\n---\n  \n', 'rules.body-empty'],
    ['título Markdown', '- ok\n## Título\n- ok', 'rules.body-heading'],
    [
      'corpo que não começa com item de lista',
      'Parágrafo solto.\n- item',
      'rules.body-not-list',
    ],
    ['marcador begin', '- <!-- agentic-ddd:begin -->', 'rules.body-marker'],
    ['marcador end', '- <!-- agentic-ddd:end -->', 'rules.body-marker'],
  ])('erro: %s', async (_nome, content, code) => {
    const error = await loadError('r.md', content);
    expect(error.source).toBe('.ai/rules/r.md');
    expect(error.code as string).toBe(code);
  });
});
