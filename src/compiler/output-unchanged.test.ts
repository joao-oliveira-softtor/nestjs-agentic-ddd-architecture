// Trava a saída de quem não usa elemento tático (ADR-0006 D2). Se este snapshot mudar, a saída de todo projeto mudou: não regravar com `-u` sem decisão registrada no PR.
// Mudam o snapshot de forma legítima: proposta pendente em orders, regras do time (`.ai/rules`), `CORE_RULES`, conventions e `changes/archive`.
import { describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { compile } from '@agentic-ddd/compiler';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop';
import { analyze } from './analyze';
import { readLock, serializeLock } from './lock';
import { DEFAULT_OUT, renderAll } from './render/index';

const ROOT = resolve(import.meta.dir, '../..');
const configPath = join(ROOT, 'agentic.config.ts');

describe('saída sem elemento tático', () => {
  test('orders: arquivos, bloco do AGENTS.md e lock não mudam', async () => {
    const result = await compile({ configPath, mode: 'check' });
    expect(result.errors).toEqual([]);
    const lock = await readLock(
      join(ROOT, '.agentic/domain.lock.json'),
      '.agentic/domain.lock.json',
    );
    expect(lock).not.toBeNull();
    expect({
      files: Object.fromEntries(result.rendered!.files),
      agentsBlock: result.rendered!.agentsBlock,
      lock: serializeLock({
        lockVersion: 1,
        ir: result.ir!,
        changes: lock!.changes,
      }),
    }).toMatchSnapshot();
  });

  test('IR de orders e shop não tem undefined e só tem as chaves de hoje', async () => {
    const orders = (await compile({ configPath, mode: 'check' })).ir!;
    const shop = analyze(defineShop(), {
      root: ROOT,
      modules: [SHOP_MODULE],
    }).ir;
    for (const ir of [orders, shop]) {
      expect(ir).toStrictEqual(JSON.parse(JSON.stringify(ir)));
      expect(Object.keys(ir).sort()).toEqual([
        'entities',
        'events',
        'irVersion',
        'modules',
        'operators',
        'useCases',
      ]);
    }
  });

  test('shop: árvore inteira de arquivos gerados não muda', () => {
    const { ir } = analyze(defineShop(), {
      root: ROOT,
      modules: [SHOP_MODULE],
    });
    const rendered = renderAll(ir, DEFAULT_OUT);
    expect({
      files: Object.fromEntries(rendered.files),
      agentsBlock: rendered.agentsBlock,
      lock: serializeLock({ lockVersion: 1, ir, changes: [] }),
    }).toMatchSnapshot();
  });
});
