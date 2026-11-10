import { expect, test } from 'bun:test';
import { z } from 'zod';
import {
  DomainError,
  DomainEvent,
  type UseCase,
  type UseCaseContext,
} from '@agentic-ddd/core';
import type { UseCaseRecord } from '@agentic-ddd/decorators';
import { InMemoryEventBus } from './event-bus';
import type { EventBus } from './ports';
import { executeUseCase } from './execute-use-case';

// `await expect(...).rejects` trips the await-thenable lint, so settle to the message instead.
const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => 'resolved',
    (error: Error) => error.message,
  );

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

class Ring implements UseCase<{ times: number }, { ok: true }> {
  async execute(_: { times: number }, ctx: UseCaseContext) {
    await ctx.publish([new Rang({})]);
    return { ok: true as const };
  }
}

test('publishes declared events stamped with one id per call and validates the output', async () => {
  const bus = new InMemoryEventBus({ record: true });
  expect(
    await executeUseCase(recordFor(Ring), new Ring(), { times: 1 }, bus),
  ).toEqual({ ok: true });
  const [event] = bus.events;
  expect(event?.name).toBe('Rang');
  expect(event?.correlationId).toMatch(/^[0-9a-f-]{36}$/);
});

test('each call gets a fresh UUID, with correlationId equal to causationId', async () => {
  const bus = new InMemoryEventBus({ record: true });
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
  const outcome = await rejection(
    executeUseCase(
      recordFor(Wrong),
      new Wrong(),
      { times: 1 },
      new InMemoryEventBus(),
    ),
  );
  expect(outcome).not.toBe('resolved');
});

test('an event outside emits fails the execution even if the use-case swallows the error', async () => {
  class Sneaky implements UseCase<{ times: number }, { ok: true }> {
    async execute(_: { times: number }, ctx: UseCaseContext) {
      await ctx.publish([new Other({})]).catch(() => {});
      return { ok: true as const };
    }
  }
  const bus = new InMemoryEventBus({ record: true });
  expect(
    await rejection(
      executeUseCase(recordFor(Sneaky), new Sneaky(), { times: 1 }, bus),
    ),
  ).toBe('Use-case ring published an undeclared event');
  expect(bus.events).toEqual([]);
});

test('an un-awaited batch is still delivered whole once the execution ended', async () => {
  const delivered: string[] = [];
  const slowBus: EventBus = {
    publish: async (events) => {
      await Bun.sleep(5);
      delivered.push(...events.map((event) => event.name));
    },
    subscribe: () => () => {},
  };
  let batch!: Promise<void>;
  class Forgetful implements UseCase<{ times: number }, { ok: true }> {
    async execute(_: { times: number }, ctx: UseCaseContext) {
      batch = ctx.publish([new Rang({}), new Rang({})]);
      return { ok: true as const };
    }
  }
  await executeUseCase(
    recordFor(Forgetful),
    new Forgetful(),
    { times: 1 },
    slowBus,
  );
  expect(await rejection(batch)).toBe('resolved');
  expect(delivered).toEqual(['Rang', 'Rang']);
});

test('a published batch reaches the bus in one call', async () => {
  const calls: string[][] = [];
  const bus: EventBus = {
    publish: async (events) => {
      calls.push(events.map((event) => event.name));
    },
    subscribe: () => () => {},
  };
  class Twice implements UseCase<{ times: number }, { ok: true }> {
    async execute(_: { times: number }, ctx: UseCaseContext) {
      await ctx.publish([new Rang({}), new Rang({})]);
      return { ok: true as const };
    }
  }
  await executeUseCase(recordFor(Twice), new Twice(), { times: 1 }, bus);
  expect(calls).toEqual([['Rang', 'Rang']]);
});

test('a batch with an undeclared event delivers none of it', async () => {
  const bus = new InMemoryEventBus({ record: true });
  class Mixed implements UseCase<{ times: number }, { ok: true }> {
    async execute(_: { times: number }, ctx: UseCaseContext) {
      await ctx.publish([new Rang({}), new Other({})]);
      return { ok: true as const };
    }
  }
  expect(
    await rejection(
      executeUseCase(recordFor(Mixed), new Mixed(), { times: 1 }, bus),
    ),
  ).toBe('Use-case ring published an undeclared event');
  expect(bus.events).toEqual([]);
});

test('a bus failure on an un-awaited publish fails the execution', async () => {
  const bus: EventBus = {
    publish: async () => {
      await Bun.sleep(5);
      throw new Error('bus down');
    },
    subscribe: () => () => {},
  };
  class Forgetful implements UseCase<{ times: number }, { ok: true }> {
    async execute(_: { times: number }, ctx: UseCaseContext) {
      void ctx.publish([new Rang({})]);
      return { ok: true as const };
    }
  }
  expect(
    await rejection(
      executeUseCase(recordFor(Forgetful), new Forgetful(), { times: 1 }, bus),
    ),
  ).toBe('bus down');
});

test('a publish made after the execution ended is refused', async () => {
  const bus = new InMemoryEventBus({ record: true });
  let late!: UseCaseContext['publish'];
  class Keeper implements UseCase<{ times: number }, { ok: true }> {
    async execute(_: { times: number }, ctx: UseCaseContext) {
      late = (batch) => ctx.publish(batch);
      return { ok: true as const };
    }
  }
  await executeUseCase(recordFor(Keeper), new Keeper(), { times: 1 }, bus);
  expect(await rejection(late([new Rang({})]))).toBe(
    'Use-case execution already ended',
  );
  expect(bus.events).toEqual([]);
});

test('an error from the use-case propagates as is, and an undeclared event wins over it', async () => {
  const failure = new DomainError('RING_BROKEN', 'The bell broke');
  class Broken implements UseCase<{ times: number }, { ok: true }> {
    async execute(): Promise<{ ok: true }> {
      throw failure;
    }
  }
  const caught = await executeUseCase(
    recordFor(Broken),
    new Broken(),
    { times: 1 },
    new InMemoryEventBus(),
  ).catch((error: unknown) => error);
  expect(caught).toBe(failure);

  class Both implements UseCase<{ times: number }, { ok: true }> {
    async execute(_: { times: number }, ctx: UseCaseContext) {
      await ctx.publish([new Other({})]);
      return { ok: true as const };
    }
  }
  expect(
    await rejection(
      executeUseCase(
        recordFor(Both),
        new Both(),
        { times: 1 },
        new InMemoryEventBus(),
      ),
    ),
  ).toBe('Use-case ring published an undeclared event');
});
