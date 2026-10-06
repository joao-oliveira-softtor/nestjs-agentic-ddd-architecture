import { describe, expect, test } from 'bun:test';
import {
  AggregateRoot,
  DomainError,
  DomainEvent,
  NotImplementedError,
  ValueObject,
  notImplemented,
} from '@agentic-ddd/core';

class Ping extends DomainEvent<{ n: number }> {}

class Counter extends AggregateRoot<string> {
  constructor(id: string) {
    super(id);
  }

  hit(): void {
    this.record(new Ping({ n: 1 }));
  }
}

class Money extends ValueObject<{ amount: number; currency: string }> {
  constructor(amount: number, currency: string) {
    super({ amount, currency });
  }
}

describe('core', () => {
  test('AggregateRoot acumula eventos e pullEvents os esvazia', () => {
    const counter = new Counter('c1');
    counter.hit();
    counter.hit();
    expect(counter.pullEvents().map((e) => e.name)).toEqual(['Ping', 'Ping']);
    expect(counter.pullEvents()).toEqual([]);
  });

  test('Entity compara por classe e id', () => {
    expect(new Counter('a').equals(new Counter('a'))).toBe(true);
    expect(new Counter('a').equals(new Counter('b'))).toBe(false);
    expect(new Counter('a').equals(null)).toBe(false);
  });

  test('ValueObject compara estruturalmente e congela as props', () => {
    const money = new Money(10, 'BRL');
    expect(money.equals(new Money(10, 'BRL'))).toBe(true);
    expect(money.equals(new Money(11, 'BRL'))).toBe(false);
    expect(Object.isFrozen(money.props)).toBe(true);
  });

  test('DomainEvent gera id e data e aceita um único carimbo de correlação', () => {
    const event = new Ping({ n: 1 }, { eventId: 'e1', occurredAt: new Date('2026-01-01T00:00:00Z') });
    expect(event.eventId).toBe('e1');
    expect(event.occurredAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(event.correlationId).toBeNull();
    event.stamp('run-1', 'step-1');
    expect([event.correlationId, event.causationId]).toEqual(['run-1', 'step-1']);
    expect(() => event.stamp('run-2', 'step-2')).toThrow('já foi carimbado');
  });

  test('DomainEvent sem meta gera eventId UUID', () => {
    expect(new Ping({ n: 1 }).eventId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('DomainError carrega um code estável', () => {
    const error = new DomainError('ORDER_NOT_FOUND', 'Pedido não encontrado.');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('ORDER_NOT_FOUND');
    expect(error.message).toBe('Pedido não encontrado.');
  });

  test('notImplemented lança NotImplementedError', () => {
    expect(() => notImplemented()).toThrow(NotImplementedError);
  });
});
