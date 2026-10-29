import { describe, expect, test } from 'bun:test';
import { DomainEvent } from '@agentic-ddd/core';
import { covers, createTestContext, parseCovers } from '@agentic-ddd/testing';

class Ping extends DomainEvent<object> {}

describe('covers', () => {
  test('accepts an ID of a port method', () => {
    expect(covers(['port:PedidoRepository.salvar'], 'grava')).toBe(
      '[covers: port:PedidoRepository.salvar] grava',
    );
  });

  test('sorts, removes duplicates and prefixes the title', () => {
    expect(
      covers(
        ['method:Order.confirm', 'invariant:Order/x', 'method:Order.confirm'],
        'confirma',
      ),
    ).toBe('[covers: invariant:Order/x, method:Order.confirm] confirma');
  });

  test('accepts a value object ID', () => {
    expect(
      covers(['valueobject:Dinheiro', 'invariant:Dinheiro/nao-negativo'], 'x'),
    ).toBe('[covers: invariant:Dinheiro/nao-negativo, valueobject:Dinheiro] x');
  });

  test('rejects an empty list and a malformed ID', () => {
    expect(() => covers([], 'x')).toThrow('requires at least one ID');
    expect(() => covers(['Order.confirm'], 'x')).toThrow('invalid ID');
  });

  test('parseCovers returns the IDs from the test name', () => {
    expect(
      parseCovers('[covers: invariant:Order/x, method:Order.confirm] confirma'),
    ).toEqual(['invariant:Order/x', 'method:Order.confirm']);
    expect(parseCovers('teste comum')).toEqual([]);
  });
});

describe('createTestContext', () => {
  test('stamps and accumulates the published events', async () => {
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
