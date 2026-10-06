import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, resolveConfig } from './config.js';

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

describe('validação do caminho dos módulos', () => {
  test('resolveConfig rejeita "." (raiz do projeto)', () => {
    expect(() =>
      resolveConfig({ modules: [{ name: 'x', path: '.' }] }, dir),
    ).toThrow(
      'agentic.config.ts: o módulo "x" não pode apontar para a raiz do projeto',
    );
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
    await expect(loadConfig(file)).rejects.toThrow(
      'agentic.config.ts: o caminho "nao-existe" do módulo "x" não existe ou não é um diretório',
    );
  });

  test('loadConfig rejeita caminho que é arquivo', async () => {
    await writeFile(join(dir, 'arquivo.ts'), '');
    const file = await configFor('arquivo.ts');
    await expect(loadConfig(file)).rejects.toThrow(
      'não existe ou não é um diretório',
    );
  });

  test('loadConfig rejeita "."', async () => {
    const file = await configFor('.');
    await expect(loadConfig(file)).rejects.toThrow(
      'o módulo "x" não pode apontar para a raiz do projeto',
    );
  });

  test('loadConfig aceita diretório existente dentro da raiz', async () => {
    await mkdir(join(dir, 'src/x'), { recursive: true });
    const file = await configFor('./src/x/');
    const config = await loadConfig(file);
    expect(config.modules).toEqual([{ name: 'x', path: 'src/x' }]);
  });
});
