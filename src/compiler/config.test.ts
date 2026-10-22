import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_CONVENTIONS,
  loadConfig,
  resolveConfig,
  type AgenticConfig,
} from './config';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agentic-config-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function configFor(path: string): Promise<string> {
  const file = join(dir, 'agentic.config.ts');
  await writeFile(
    file,
    `export default { modules: [{ name: 'x', path: ${JSON.stringify(path)} }] };\n`,
  );
  return file;
}

async function failure(file: string): Promise<string> {
  try {
    await loadConfig(file);
    return '';
  } catch (error) {
    return (error as Error).message;
  }
}

describe('validação do caminho dos módulos', () => {
  test('resolveConfig rejeita "." (raiz do projeto)', () => {
    expect(() =>
      resolveConfig({ modules: [{ name: 'x', path: '.' }] }, dir),
    ).toThrow(
      'agentic.config.ts: o módulo "x" não pode apontar para a raiz do projeto',
    );
  });

  test('resolveConfig normaliza o caminho relativo à raiz', () => {
    for (const path of ['examples/./orders', './examples/orders/']) {
      const resolved = resolveConfig({ modules: [{ name: 'x', path }] }, dir);
      expect(resolved.modules).toEqual([
        { name: 'x', path: 'examples/orders' },
      ]);
    }
  });

  test('resolveConfig rejeita caminho fora da raiz', () => {
    expect(() =>
      resolveConfig({ modules: [{ name: 'x', path: '../fora' }] }, dir),
    ).toThrow(
      'agentic.config.ts: o módulo "x" não pode apontar para fora da raiz do projeto',
    );
  });

  test('loadConfig rejeita caminho inexistente', async () => {
    const file = await configFor('nao-existe');
    expect(await failure(file)).toContain(
      'agentic.config.ts: o caminho "nao-existe" do módulo "x" não existe ou não é um diretório',
    );
  });

  test('loadConfig rejeita caminho que é arquivo', async () => {
    await writeFile(join(dir, 'arquivo.ts'), '');
    const file = await configFor('arquivo.ts');
    expect(await failure(file)).toContain('não existe ou não é um diretório');
  });

  test('loadConfig rejeita "."', async () => {
    const file = await configFor('.');
    expect(await failure(file)).toContain(
      'o módulo "x" não pode apontar para a raiz do projeto',
    );
  });

  test('resolveConfig rejeita módulos com o mesmo nome', () => {
    expect(() =>
      resolveConfig(
        {
          modules: [
            { name: 'x', path: 'src/a' },
            { name: 'x', path: 'src/b' },
          ],
        },
        dir,
      ),
    ).toThrow('agentic.config.ts: o nome do módulo "x" está repetido');
  });

  test('resolveConfig rejeita módulos com o mesmo caminho', () => {
    expect(() =>
      resolveConfig(
        {
          modules: [
            { name: 'a', path: 'src/x' },
            { name: 'b', path: './src/x/' },
          ],
        },
        dir,
      ),
    ).toThrow(
      'agentic.config.ts: os módulos "a" e "b" apontam para o mesmo caminho "src/x"',
    );
  });

  test('loadConfig aceita diretório existente dentro da raiz', async () => {
    await mkdir(join(dir, 'src/x'), { recursive: true });
    const file = await configFor('./src/x/');
    const config = await loadConfig(file);
    expect(config.modules).toEqual([{ name: 'x', path: 'src/x' }]);
  });
});

describe('configuração das regras do time', () => {
  const base = { modules: [{ name: 'x', path: 'x' }] };

  test('resolveConfig usa os padrões quando rules não é informado', () => {
    expect(resolveConfig(base, dir).rules).toEqual({
      dir: '.ai/rules',
      exclude: [],
      briefMaxTokens: 2000,
    });
  });

  test('resolveConfig normaliza rules.dir e repassa exclude e briefMaxTokens', () => {
    const { rules } = resolveConfig(
      {
        ...base,
        rules: {
          dir: './docs/regras/',
          exclude: ['core/done'],
          briefMaxTokens: 500,
        },
      },
      dir,
    );
    expect(rules).toEqual({
      dir: 'docs/regras',
      exclude: ['core/done'],
      briefMaxTokens: 500,
    });
  });

  test('resolveConfig tira todos os ./ iniciais de rules.dir', () => {
    expect(
      resolveConfig({ ...base, rules: { dir: '././docs/regras' } }, dir).rules
        .dir,
    ).toBe('docs/regras');
  });

  test('resolveConfig rejeita rules.dir fora da raiz', () => {
    expect(() =>
      resolveConfig({ ...base, rules: { dir: '../fora' } }, dir),
    ).toThrow('agentic.config.ts: rules.dir não pode apontar');
  });

  test('resolveConfig rejeita rules.dir absoluto', () => {
    expect(() =>
      resolveConfig({ ...base, rules: { dir: '/etc/regras' } }, dir),
    ).toThrow('agentic.config.ts: rules.dir deve ser relativo');
  });

  test('resolveConfig rejeita briefMaxTokens que não é inteiro positivo', () => {
    for (const briefMaxTokens of [0, -1, 1.5, Number.NaN])
      expect(() =>
        resolveConfig({ ...base, rules: { briefMaxTokens } }, dir),
      ).toThrow('agentic.config.ts: rules.briefMaxTokens deve ser um inteiro');
  });
});

describe('configuração das convenções', () => {
  const base = { modules: [{ name: 'x', path: 'x' }] };

  function withConventions(conventions: unknown) {
    return resolveConfig({ ...base, conventions } as AgenticConfig, dir);
  }

  test('resolveConfig preenche conventions com o padrão quando o campo não existe', () => {
    expect(resolveConfig(base, dir).conventions).toEqual(DEFAULT_CONVENTIONS);
  });

  test('resolveConfig mescla layers e suffixes por chave', () => {
    expect(
      withConventions({
        layers: { domain: 'core' },
        suffixes: { operator: '.op.ts' },
      }).conventions,
    ).toEqual({
      ...DEFAULT_CONVENTIONS,
      layers: {
        domain: 'core',
        application: 'application',
        operators: 'operators',
      },
      suffixes: { events: '.events.ts', operator: '.op.ts' },
    });
  });

  test('resolveConfig mescla forbiddenImports por camada', () => {
    expect(
      withConventions({ forbiddenImports: { domain: ['application'] } })
        .conventions?.forbiddenImports,
    ).toEqual({
      domain: ['application'],
      application: ['operators', 'infrastructure'],
    });
  });

  test('listas substituem o padrão em vez de somar', () => {
    const resolved = withConventions({
      infrastructure: ['infra'],
      forbiddenImports: { domain: ['infrastructure'] },
    }).conventions;
    expect(resolved?.infrastructure).toEqual(['infra']);
    expect(resolved?.forbiddenImports.domain).toEqual(['infrastructure']);
  });

  test('forbiddenImports aceita lista vazia', () => {
    expect(
      withConventions({ forbiddenImports: { application: [] } }).conventions
        ?.forbiddenImports.application,
    ).toEqual([]);
  });

  test('rejeita nome de pasta de camada que não é uma pasta só', () => {
    for (const value of ['core/domain', 'core\\domain', '', '.', '..']) {
      expect(() => withConventions({ layers: { domain: value } })).toThrow(
        `agentic.config.ts: conventions.layers.domain "${value}" deve ser o nome de uma pasta só dentro do módulo; layout aninhado se faz por modules[].path`,
      );
    }
  });

  test('rejeita nome de pasta em infrastructure que não é uma pasta só', () => {
    expect(() => withConventions({ infrastructure: ['a/b'] })).toThrow(
      'agentic.config.ts: conventions.infrastructure[0] "a/b" deve ser o nome de uma pasta só dentro do módulo',
    );
  });

  test('rejeita sufixo de teste, declaração ou com segmento vazio', () => {
    for (const value of ['.x.test.ts', '.x.d.ts', '..ts'])
      expect(() => withConventions({ suffixes: { events: value } })).toThrow(
        `conventions.suffixes.events "${value}" não pode terminar em`,
      );
  });

  test('rejeita sufixo fora do formato ".nome.ts"', () => {
    for (const value of [
      '.ts',
      'events.ts',
      '.events',
      '.events.js',
      'x/.events.ts',
      '.a\\b.ts',
    ]) {
      expect(() => withConventions({ suffixes: { events: value } })).toThrow(
        `agentic.config.ts: conventions.suffixes.events "${value}" deve começar com "." e terminar em ".ts"`,
      );
    }
  });

  test('rejeita sufixo de eventos igual ao de operator', () => {
    expect(() =>
      withConventions({ suffixes: { operator: '.events.ts' } }),
    ).toThrow(
      'agentic.config.ts: conventions.suffixes.events e conventions.suffixes.operator não podem ser iguais',
    );
  });

  test('rejeita infrastructure vazio', () => {
    expect(() => withConventions({ infrastructure: [] })).toThrow(
      'agentic.config.ts: conventions.infrastructure não pode ser vazio',
    );
  });

  test('rejeita nome de pasta repetido entre camadas e infrastructure', () => {
    expect(() => withConventions({ layers: { application: 'infra' } })).toThrow(
      'agentic.config.ts: a pasta "infra" aparece mais de uma vez (conventions.layers.application e conventions.infrastructure[1])',
    );
    expect(() => withConventions({ infrastructure: ['x', 'x'] })).toThrow(
      'a pasta "x" aparece mais de uma vez',
    );
  });

  test('rejeita tipo errado com mensagem indicando o campo', () => {
    const cases: [unknown, string][] = [
      ['x', 'conventions deve ser um objeto'],
      [{ layers: 'x' }, 'conventions.layers deve ser um objeto'],
      [
        { layers: { domain: 1 } },
        'conventions.layers.domain deve ser um texto',
      ],
      [{ suffixes: 'x' }, 'conventions.suffixes deve ser um objeto'],
      [
        { suffixes: { events: 1 } },
        'conventions.suffixes.events deve ser um texto',
      ],
      [
        { infrastructure: 'infra' },
        'conventions.infrastructure deve ser uma lista de textos',
      ],
      [
        { infrastructure: [1] },
        'conventions.infrastructure deve ser uma lista de textos',
      ],
      [
        { forbiddenImports: 'x' },
        'conventions.forbiddenImports deve ser um objeto',
      ],
      [
        { forbiddenImports: { domain: 'application' } },
        'conventions.forbiddenImports.domain deve ser uma lista de textos',
      ],
    ];
    for (const [conventions, message] of cases)
      expect(() => withConventions(conventions)).toThrow(
        `agentic.config.ts: ${message}`,
      );
  });

  test('rejeita chave desconhecida em qualquer nível listando as válidas', () => {
    expect(() => withConventions({ layer: { domain: 'core' } })).toThrow(
      'agentic.config.ts: conventions.layer não existe; as chaves válidas em conventions são: layers, suffixes, infrastructure, forbiddenImports',
    );
    expect(() => withConventions({ layers: { core: 'x' } })).toThrow(
      'agentic.config.ts: conventions.layers.core não existe; as chaves válidas em conventions.layers são: domain, application, operators',
    );
    expect(() => withConventions({ suffixes: { event: '.x.ts' } })).toThrow(
      'agentic.config.ts: conventions.suffixes.event não existe; as chaves válidas em conventions.suffixes são: events, operator',
    );
    expect(() => withConventions({ forbiddenImports: { infra: [] } })).toThrow(
      'agentic.config.ts: conventions.forbiddenImports.infra não existe',
    );
  });

  test('rejeita forbiddenImports.operators dizendo que operators não tem regra de import', () => {
    expect(() =>
      withConventions({ forbiddenImports: { operators: [] } }),
    ).toThrow('operators não tem regra de import');
  });

  test('rejeita alvo de forbiddenImports fora de application, operators e infrastructure', () => {
    expect(() =>
      withConventions({ forbiddenImports: { domain: ['domain'] } }),
    ).toThrow(
      'agentic.config.ts: conventions.forbiddenImports.domain aceita só application, operators ou infrastructure (recebido "domain")',
    );
  });
});
