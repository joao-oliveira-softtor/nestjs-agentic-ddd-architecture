import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from '../__fixtures__/shop';
import { analyze } from '../analyze';
import type { LockChange } from '../lock';
import { renderHistory } from './history';

const ROOT = resolve(import.meta.dir, '../../..');
const { ir } = analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] });
const module = ir.modules[0]!;
const HISTORY = '.agents/skills/shop-dev/references/history.md';

const changes: LockChange[] = [
  {
    id: '0001',
    title: 'estado inicial',
    path: 'changes/archive/0001-estado-inicial/proposal.md',
    summary: 'Base do histórico.',
    hash: 'h1',
    items: [
      {
        id: 'entity:Product',
        kind: 'added',
        classification: 'behavioral',
        module: 'shop',
      },
      {
        id: 'usecase:publish_product',
        kind: 'added',
        classification: 'behavioral',
        module: 'shop',
      },
    ],
  },
  {
    id: '0002',
    title: 'Publicação exige estoque',
    path: 'changes/archive/0002-publicacao-exige-estoque/proposal.md',
    summary: 'Evitar vender sem estoque.',
    hash: 'h2',
    items: [
      {
        id: 'invariant:Product/publicacao-exige-estoque',
        kind: 'added',
        classification: 'behavioral',
        module: 'shop',
      },
      {
        id: 'entity:Outro',
        kind: 'added',
        classification: 'behavioral',
        module: 'outro',
      },
    ],
  },
];

describe('renderHistory', () => {
  test('sem changes', () => {
    expect(renderHistory(ir, module, [], HISTORY)).toContain(
      '_Nenhuma mudança registrada._',
    );
  });

  test('agrupa por entidade, ignora outros módulos e linka a proposta arquivada', () => {
    const text = renderHistory(ir, module, changes, HISTORY);
    expect(text).toContain('# Histórico do módulo `shop`');
    expect(text).toContain(
      '| [0001](../../../../changes/archive/0001-estado-inicial/proposal.md) | estado inicial | added `entity:Product` (behavioral) | Base do histórico. |',
    );
    expect(text).toContain(
      '| [0002](../../../../changes/archive/0002-publicacao-exige-estoque/proposal.md) | Publicação exige estoque | added `invariant:Product/publicacao-exige-estoque` (behavioral) | Evitar vender sem estoque. |',
    );
    expect(text).toContain('## Eventos, use-cases e operators');
    expect(text).toContain('added `usecase:publish_product` (behavioral)');
    expect(text).not.toContain('entity:Outro');
    expect(text).toMatchSnapshot();
  });
});
