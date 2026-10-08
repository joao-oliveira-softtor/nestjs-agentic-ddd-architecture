import { describe, expect, test } from 'bun:test';
import { DomainEvent } from '@agentic-ddd/core';
import { covers, createTestContext, parseCovers } from '@agentic-ddd/testing';

class Ping extends DomainEvent<object> {}

describe('covers', () => {
  test('ordena, remove duplicatas e prefixa o título', () => {
    expect(
      covers(
        ['method:Order.confirm', 'invariant:Order/x', 'method:Order.confirm'],
        'confirma',
      ),
    ).toBe('[covers: invariant:Order/x, method:Order.confirm] confirma');
  });

  test('rejeita lista vazia e ID malformado', () => {
    expect(() => covers([], 'x')).toThrow('ao menos um ID');
    expect(() => covers(['Order.confirm'], 'x')).toThrow('ID inválido');
  });

  test('parseCovers devolve os IDs do nome do teste', () => {
    expect(
      parseCovers('[covers: invariant:Order/x, method:Order.confirm] confirma'),
    ).toEqual(['invariant:Order/x', 'method:Order.confirm']);
    expect(parseCovers('teste comum')).toEqual([]);
  });
});

describe('createTestContext', () => {
  test('carimba e acumula os eventos publicados', async () => {
    const ctx = createTestContext({
      correlationId: 'run-1',
      causationId: 'step-1',
    });
    const event = new Ping({});
    await ctx.publish([event]);
    expect(ctx.published).toEqual([event]);
    expect([event.correlationId, event.causationId]).toEqual([
      'run-1',
      'step-1',
    ]);
  });
});
