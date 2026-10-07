import { describe, expect, test } from 'bun:test';
import { ValueObject } from '@agentic-ddd/core';

class Bag<P extends object> extends ValueObject<P> {
  constructor(props: P) {
    super(props);
  }
}

describe('ValueObject: isolamento das props', () => {
  test('mutar o objeto aninhado original não altera o VO', () => {
    const nested = { value: 1, deep: { list: [1, 2] } };
    const vo = new Bag({ nested });
    nested.value = 99;
    nested.deep.list.push(3);
    expect(vo.props.nested.value).toBe(1);
    expect(vo.props.nested.deep.list).toEqual([1, 2]);
  });

  test('as props aninhadas ficam congeladas', () => {
    const vo = new Bag({ nested: { value: 1 }, list: [{ n: 1 }] });
    expect(Object.isFrozen(vo.props)).toBe(true);
    expect(Object.isFrozen(vo.props.nested)).toBe(true);
    expect(Object.isFrozen(vo.props.list)).toBe(true);
    expect(Object.isFrozen(vo.props.list[0])).toBe(true);
    expect(() => {
      (vo.props.nested as { value: number }).value = 2;
    }).toThrow(TypeError);
  });

  test('VO aninhado é mantido por referência e continua comparando por equals', () => {
    const inner = new Bag({ amount: 10 });
    const vo = new Bag({ inner });
    expect(vo.props.inner).toBe(inner);
    expect(vo.equals(new Bag({ inner: new Bag({ amount: 10 }) }))).toBe(true);
    expect(vo.equals(new Bag({ inner: new Bag({ amount: 11 }) }))).toBe(false);
  });

  test('alterar o Date original não altera o VO', () => {
    const date = new Date('2026-01-01T00:00:00Z');
    const vo = new Bag({ date });
    date.setTime(0);
    expect(vo.props.date.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(vo.props.date).not.toBe(date);
  });

  test('Map e Set são copiados, com os elementos copiados', () => {
    const item = { n: 1 };
    const set = new Set([item]);
    const map = new Map([['k', { n: 1 }]]);
    const vo = new Bag({ set, map });
    item.n = 2;
    set.add({ n: 3 });
    map.get('k')!.n = 2;
    map.set('outra', { n: 5 });
    expect([...vo.props.set]).toEqual([{ n: 1 }]);
    expect([...vo.props.map]).toEqual([['k', { n: 1 }]]);
  });

  test('objetos sem protótipo continuam sem protótipo', () => {
    const bare = Object.create(null) as Record<string, number>;
    bare.a = 1;
    const vo = new Bag({ bare });
    expect(Object.getPrototypeOf(vo.props.bare)).toBeNull();
    expect(vo.props.bare.a).toBe(1);
    expect(Object.isFrozen(vo.props.bare)).toBe(true);
  });
});

describe('ValueObject: equals', () => {
  test('Set é igual independentemente da ordem de inserção', () => {
    expect(
      new Bag({ s: new Set([1, 2]) }).equals(new Bag({ s: new Set([2, 1]) })),
    ).toBe(true);
    expect(
      new Bag({ s: new Set([{ n: 1 }, { n: 2 }]) }).equals(
        new Bag({ s: new Set([{ n: 2 }, { n: 1 }]) }),
      ),
    ).toBe(true);
  });

  test('Map é igual independentemente da ordem das entradas', () => {
    const a = new Map([
      ['x', 1],
      ['y', 2],
    ]);
    const b = new Map([
      ['y', 2],
      ['x', 1],
    ]);
    expect(new Bag({ m: a }).equals(new Bag({ m: b }))).toBe(true);
  });

  test('Set com elementos profundamente iguais não casa duas vezes o mesmo elemento', () => {
    const a = new Bag({ s: new Set([{ n: 1 }, { n: 1 }]) });
    const b = new Bag({ s: new Set([{ n: 1 }, { n: 2 }]) });
    expect(a.equals(b)).toBe(false);
    expect(b.equals(a)).toBe(false);
  });

  test('Set e Map diferentes continuam diferentes', () => {
    expect(
      new Bag({ s: new Set([1, 2]) }).equals(new Bag({ s: new Set([1, 3]) })),
    ).toBe(false);
    expect(
      new Bag({ s: new Set([1, 2]) }).equals(new Bag({ s: new Set([1]) })),
    ).toBe(false);
    expect(
      new Bag({ m: new Map([['x', 1]]) }).equals(
        new Bag({ m: new Map([['x', 2]]) }),
      ),
    ).toBe(false);
    expect(
      new Bag({ m: new Map([['x', 1]]) }).equals(
        new Bag({ m: new Map([['y', 1]]) }),
      ),
    ).toBe(false);
  });
});
