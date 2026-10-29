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

async function failureCode(file: string): Promise<string> {
  try {
    await loadConfig(file);
    return '';
  } catch (error) {
    return (error as { code?: string }).code ?? '';
  }
}

function codeOf(run: () => unknown): string {
  try {
    run();
    return '';
  } catch (error) {
    return (error as { code?: string }).code ?? '';
  }
}

describe('validação do caminho dos módulos', () => {
  test('resolveConfig rejeita "." (raiz do projeto)', () => {
    expect(
      codeOf(() => resolveConfig({ modules: [{ name: 'x', path: '.' }] }, dir)),
    ).toBe('config.module-root');
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
    expect(
      codeOf(() =>
        resolveConfig({ modules: [{ name: 'x', path: '../fora' }] }, dir),
      ),
    ).toBe('config.module-outside');
  });

  test('loadConfig rejeita caminho inexistente', async () => {
    const file = await configFor('nao-existe');
    expect(await failureCode(file)).toBe('config.module-path-missing');
  });

  test('loadConfig rejeita caminho que é arquivo', async () => {
    await writeFile(join(dir, 'arquivo.ts'), '');
    const file = await configFor('arquivo.ts');
    expect(await failureCode(file)).toBe('config.module-path-missing');
  });

  test('loadConfig rejeita "."', async () => {
    const file = await configFor('.');
    expect(await failureCode(file)).toBe('config.module-root');
  });

  test('resolveConfig rejeita módulos com o mesmo nome', () => {
    expect(
      codeOf(() =>
        resolveConfig(
          {
            modules: [
              { name: 'x', path: 'src/a' },
              { name: 'x', path: 'src/b' },
            ],
          },
          dir,
        ),
      ),
    ).toBe('config.module-duplicate');
  });

  test('resolveConfig rejeita módulos com o mesmo caminho', () => {
    expect(
      codeOf(() =>
        resolveConfig(
          {
            modules: [
              { name: 'a', path: 'src/x' },
              { name: 'b', path: './src/x/' },
            ],
          },
          dir,
        ),
      ),
    ).toBe('config.module-path-duplicate');
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
    expect(
      codeOf(() => resolveConfig({ ...base, rules: { dir: '../fora' } }, dir)),
    ).toBe('config.rules-dir-outside');
  });

  test('resolveConfig rejeita rules.dir absoluto', () => {
    expect(
      codeOf(() =>
        resolveConfig({ ...base, rules: { dir: '/etc/regras' } }, dir),
      ),
    ).toBe('config.rules-dir-absolute');
  });

  test('resolveConfig rejeita briefMaxTokens que não é inteiro positivo', () => {
    for (const briefMaxTokens of [0, -1, 1.5, Number.NaN])
      expect(
        codeOf(() =>
          resolveConfig({ ...base, rules: { briefMaxTokens } }, dir),
        ),
      ).toBe('config.brief-tokens-invalid');
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
      expect(codeOf(() => withConventions({ layers: { domain: value } }))).toBe(
        'config.folder-invalid',
      );
    }
  });

  test('rejeita nome de pasta em infrastructure que não é uma pasta só', () => {
    expect(codeOf(() => withConventions({ infrastructure: ['a/b'] }))).toBe(
      'config.folder-invalid',
    );
  });

  test('rejeita sufixo de teste, declaração ou com segmento vazio', () => {
    for (const value of ['.x.test.ts', '.x.d.ts', '..ts'])
      expect(
        codeOf(() => withConventions({ suffixes: { events: value } })),
      ).toBe('config.suffix-test-file');
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
      expect(
        codeOf(() => withConventions({ suffixes: { events: value } })),
      ).toBe('config.suffix-format');
    }
  });

  test('rejeita sufixo de eventos igual ao de operator', () => {
    expect(
      codeOf(() => withConventions({ suffixes: { operator: '.events.ts' } })),
    ).toBe('config.suffix-duplicate');
  });

  test('rejeita infrastructure vazio', () => {
    expect(codeOf(() => withConventions({ infrastructure: [] }))).toBe(
      'config.infrastructure-empty',
    );
  });

  test('rejeita nome de pasta repetido entre camadas e infrastructure', () => {
    expect(
      codeOf(() => withConventions({ layers: { application: 'infra' } })),
    ).toBe('config.folder-duplicate');
    expect(codeOf(() => withConventions({ infrastructure: ['x', 'x'] }))).toBe(
      'config.folder-duplicate',
    );
  });

  test('rejeita tipo errado com código indicando o tipo', () => {
    const cases: [unknown, string][] = [
      ['x', 'config.not-object'],
      [{ layers: 'x' }, 'config.not-object'],
      [{ layers: { domain: 1 } }, 'config.not-text'],
      [{ suffixes: 'x' }, 'config.not-object'],
      [{ suffixes: { events: 1 } }, 'config.not-text'],
      [{ infrastructure: 'infra' }, 'config.not-text-list'],
      [{ infrastructure: [1] }, 'config.not-text-list'],
      [{ forbiddenImports: 'x' }, 'config.not-object'],
      [{ forbiddenImports: { domain: 'application' } }, 'config.not-text-list'],
    ];
    for (const [conventions, code] of cases)
      expect(codeOf(() => withConventions(conventions))).toBe(code);
  });

  test('rejeita chave desconhecida em qualquer nível com código de chave inexistente', () => {
    expect(codeOf(() => withConventions({ layer: { domain: 'core' } }))).toBe(
      'config.key-unknown',
    );
    expect(codeOf(() => withConventions({ layers: { core: 'x' } }))).toBe(
      'config.key-unknown',
    );
    expect(
      codeOf(() => withConventions({ suffixes: { event: '.x.ts' } })),
    ).toBe('config.key-unknown');
    expect(
      codeOf(() => withConventions({ forbiddenImports: { infra: [] } })),
    ).toBe('config.key-unknown');
  });

  test('rejeita forbiddenImports.operators com código de chave inválida', () => {
    expect(
      codeOf(() => withConventions({ forbiddenImports: { operators: [] } })),
    ).toBe('config.key-invalid');
  });

  test('rejeita alvo de forbiddenImports fora de application, operators e infrastructure', () => {
    expect(
      codeOf(() =>
        withConventions({ forbiddenImports: { domain: ['domain'] } }),
      ),
    ).toBe('config.import-target-invalid');
  });
});

describe('mcp section', () => {
  const base = { modules: [{ name: 'x', path: 'x' }] };
  const mcp = {
    issuer: 'https://auth.example.com',
    resource: 'https://orders.example.com/mcp',
  };

  function withMcp(section: unknown) {
    return resolveConfig({ ...base, mcp: section } as AgenticConfig, dir);
  }

  test('resolveConfig leaves mcp undefined when the section is absent', () => {
    expect(resolveConfig(base, dir).mcp).toBeUndefined();
  });

  test('resolveConfig keeps issuer, resource and jwksUri as written', () => {
    const jwksUri = 'https://auth.example.com/.well-known/jwks.json';
    expect(withMcp({ ...mcp, jwksUri }).mcp).toEqual({ ...mcp, jwksUri });
    expect(withMcp(mcp).mcp).toEqual(mcp);
  });

  test('accepts http only on loopback hosts', () => {
    for (const issuer of [
      'http://127.0.0.1:9000',
      'http://127.5.6.7:9000',
      'http://localhost:9000',
      'http://[::1]:9000',
    ])
      expect(withMcp({ ...mcp, issuer }).mcp?.issuer).toBe(issuer);
    expect(
      codeOf(() => withMcp({ ...mcp, issuer: 'http://auth.example.com' })),
    ).toBe('config.mcp-url-invalid');
    expect(
      codeOf(() =>
        withMcp({ ...mcp, resource: 'http://orders.example.com/mcp' }),
      ),
    ).toBe('config.mcp-url-invalid');
  });

  test('rejects missing issuer or resource with config.mcp-field-missing', () => {
    expect(codeOf(() => withMcp({ resource: mcp.resource }))).toBe(
      'config.mcp-field-missing',
    );
    expect(codeOf(() => withMcp({ issuer: mcp.issuer }))).toBe(
      'config.mcp-field-missing',
    );
    expect(codeOf(() => withMcp({}))).toBe('config.mcp-field-missing');
  });

  test('rejects URLs that are not absolute https (or loopback http)', () => {
    for (const issuer of [
      'auth.example.com',
      '/relative',
      'ftp://auth.example.com',
      'not a url',
    ])
      expect(codeOf(() => withMcp({ ...mcp, issuer }))).toBe(
        'config.mcp-url-invalid',
      );
  });

  test('rejects a query or fragment on issuer and a fragment on resource', () => {
    expect(
      codeOf(() =>
        withMcp({ ...mcp, issuer: 'https://auth.example.com/?tenant=a' }),
      ),
    ).toBe('config.mcp-url-invalid');
    expect(
      codeOf(() =>
        withMcp({ ...mcp, issuer: 'https://auth.example.com/#top' }),
      ),
    ).toBe('config.mcp-url-invalid');
    expect(
      codeOf(() =>
        withMcp({ ...mcp, resource: 'https://orders.example.com/mcp#x' }),
      ),
    ).toBe('config.mcp-url-invalid');
  });

  test('rejects a jwksUri that is not an absolute https URL', () => {
    expect(codeOf(() => withMcp({ ...mcp, jwksUri: 'jwks.json' }))).toBe(
      'config.mcp-url-invalid',
    );
  });

  test('rejects a non-string value with config.not-text', () => {
    expect(codeOf(() => withMcp({ ...mcp, issuer: 42 }))).toBe(
      'config.not-text',
    );
  });

  test('rejects an unknown key in mcp with config.key-unknown', () => {
    expect(codeOf(() => withMcp({ ...mcp, audience: 'x' }))).toBe(
      'config.key-unknown',
    );
  });

  test('rejects a non-object mcp with config.not-object', () => {
    expect(codeOf(() => withMcp('x'))).toBe('config.not-object');
  });
});
