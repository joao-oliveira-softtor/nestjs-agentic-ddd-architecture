import { expect, test } from 'bun:test';
import { z } from 'zod';
import {
  DomainEvent,
  type UseCase,
  type UseCaseContext,
} from '@agentic-ddd/core';
import type { UseCaseRecord } from '@agentic-ddd/decorators';
import { InMemoryEventBus } from './event-bus';
import { executeUseCase } from './execute-use-case';

class Rang extends DomainEvent<object> {}
class Other extends DomainEvent<object> {}

const recordFor = (target: UseCaseRecord['target']): UseCaseRecord => ({
  target,
  name: 'ring',
  description: 'Rings',
  whenToUse: 'Always',
  whenNotToUse: null,
  input: z.object({ times: z.number() }),
  output: z.object({ ok: z.literal(true) }),
  uses: [],
  emits: [Rang],
  source: { file: 'x.ts', line: 1 },
});

test('publishes declared events stamped with one id per call and validates the output', async () => {
  class Ring implements UseCase<{ times: number }, { ok: true }> {
    async execute(_: { times: number }, ctx: UseCaseContext) {
      await ctx.publish([new Rang({})]);
      return { ok: true as const };
    }
  }
  const bus = new InMemoryEventBus();
  expect(
    await executeUseCase(recordFor(Ring), new Ring(), { times: 1 }, bus),
  ).toEqual({ ok: true });
  const [event] = bus.events;
  expect(event?.name).toBe('Rang');
  expect(event?.correlationId).toMatch(/^[0-9a-f-]{36}$/);
});

test('each call gets a fresh UUID, with correlationId equal to causationId', async () => {
  class Ring implements UseCase<{ times: number }, { ok: true }> {
    async execute(_: { times: number }, ctx: UseCaseContext) {
      await ctx.publish([new Rang({})]);
      return { ok: true as const };
    }
  }
  const bus = new InMemoryEventBus();
  for (let i = 0; i < 2; i++)
    await executeUseCase(recordFor(Ring), new Ring(), { times: 1 }, bus);
  const [first, second] = bus.events;
  expect(first?.correlationId).toBe(first?.causationId);
  expect(second?.correlationId).toBe(second?.causationId);
  expect(first?.correlationId).not.toBe(second?.correlationId);
});

test('an output outside its schema rejects the execution', async () => {
  class Wrong implements UseCase<{ times: number }, unknown> {
    async execute() {
      return { ok: false };
    }
  }
  expect(
    executeUseCase(
      recordFor(Wrong),
      new Wrong(),
      { times: 1 },
      new InMemoryEventBus(),
    ),
  ).rejects.toThrow();
});

test('an event outside emits fails the execution even if the use-case swallows the error', async () => {
  class Sneaky implements UseCase<{ times: number }, { ok: true }> {
    async execute(_: { times: number }, ctx: UseCaseContext) {
      await ctx.publish([new Other({})]).catch(() => {});
      return { ok: true as const };
    }
  }
  const bus = new InMemoryEventBus();
  expect(
    executeUseCase(recordFor(Sneaky), new Sneaky(), { times: 1 }, bus),
  ).rejects.toThrow('Use-case ring published an undeclared event');
  expect(bus.events).toEqual([]);
});
