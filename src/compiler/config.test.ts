import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, resolveConfig } from './config';

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
