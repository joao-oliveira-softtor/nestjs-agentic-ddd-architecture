import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from '../__fixtures__/shop';
import { analyze } from '../analyze';
import type { IRValueObject } from '../../contracts/ir';
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

  test('invariante de use-case não cria seção de entidade e cai em use-cases', () => {
    const useCaseChange: LockChange[] = [
      {
        id: '0003',
        title: 'Matrícula exige aluno ativo',
        path: 'changes/archive/0003-matricula-exige-aluno-ativo/proposal.md',
        summary: 'Só aluno ativo se matricula.',
        hash: 'h3',
        items: [
          {
            id: 'invariant:matricular_aluno/aluno-ativo',
            kind: 'added',
            classification: 'behavioral',
            module: 'shop',
          },
        ],
      },
    ];
    const text = renderHistory(ir, module, useCaseChange, HISTORY);
    expect(text).not.toContain('## matricular_aluno');
    expect(text.indexOf('## Eventos, use-cases e operators')).toBeLessThan(
      text.indexOf(
        'added `invariant:matricular_aluno/aluno-ativo` (behavioral)',
      ),
    );
  });

  const dinheiro: IRValueObject = {
    id: 'valueobject:Dinheiro',
    name: 'Dinheiro',
    module: 'shop',
    description: 'Quantia monetária.',
    invariants: [
      {
        id: 'invariant:Dinheiro/nao-negativo',
        text: 'Valor não pode ser negativo.',
        on: null,
        source: 'src/shop/domain/dinheiro.ts',
      },
    ],
    source: 'src/shop/domain/dinheiro.ts',
  };
  const withVo = { ...ir, valueObjects: [dinheiro] };

  test('value object sem mudança ganha seção própria com "nenhuma mudança"', () => {
    const text = renderHistory(withVo, module, changes, HISTORY);
    expect(text).toContain('## Dinheiro\n\n_Nenhuma mudança registrada._');
  });

  test('mudança de value object e de sua invariante vai para a seção do VO', () => {
    const voChange: LockChange[] = [
      {
        id: '0004',
        title: 'Dinheiro não negativo',
        path: 'changes/archive/0004-dinheiro-nao-negativo/proposal.md',
        summary: 'Dinheiro nunca negativo.',
        hash: 'h4',
        items: [
          {
            id: 'valueobject:Dinheiro',
            kind: 'added',
            classification: 'behavioral',
            module: 'shop',
          },
          {
            id: 'invariant:Dinheiro/nao-negativo',
            kind: 'added',
            classification: 'behavioral',
            module: 'shop',
          },
        ],
      },
    ];
    const text = renderHistory(withVo, module, voChange, HISTORY);
    expect(text).toContain(
      '| [0004](../../../../changes/archive/0004-dinheiro-nao-negativo/proposal.md) | Dinheiro não negativo | added `valueobject:Dinheiro` (behavioral); added `invariant:Dinheiro/nao-negativo` (behavioral) | Dinheiro nunca negativo. |',
    );
    expect(text.indexOf('## Dinheiro')).toBeLessThan(text.indexOf('| [0004]'));
    expect(text).not.toContain('## Eventos, use-cases e operators');
  });
});
