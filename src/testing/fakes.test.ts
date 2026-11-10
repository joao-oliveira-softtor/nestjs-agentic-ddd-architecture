import { expect, test } from 'bun:test';
import { DomainEvent } from '@agentic-ddd/core';
import { FakeLlm, FakeApproval, InMemoryEventBus } from './index';
import type { LlmRequest, LlmResponse } from '@agentic-ddd/runtime';

const request: LlmRequest = {
  model: 'default',
  system: 'skill',
  messages: [{ role: 'user', text: 'hi' }],
  tools: [],
  toolChoice: 'auto',
};
const payload = { native: ['reasoning'] };
const response: LlmResponse = {
  content: [{ type: 'text', text: 'ok' }],
  stopReason: 'end',
  providerPayload: payload,
};

test('FakeLlm consumes responses/functions, records requests and preserves opaque payload', async () => {
  const fake = new FakeLlm([
    response,
    (req) => {
      expect(req).toEqual(request);
      return response;
    },
  ]);
  expect((await fake.complete(request)).providerPayload).toBe(payload);
  await fake.complete(request);
  expect(fake.requests).toEqual([request, request]);
  expect(fake.complete(request)).rejects.toThrow('FakeLlm script exhausted');
});

test('FakeApproval supports allow, deny and asynchronous decisions with history', async () => {
  const req = {
    operator: 'orders',
    runId: 'run',
    useCase: 'cancel',
    input: { id: '1' },
  };
  expect(await new FakeApproval(true).request(req)).toEqual({ approved: true });
  expect(await new FakeApproval(false).request(req)).toEqual({
    approved: false,
  });
  const fake = new FakeApproval(async (value) => ({
    approved: false,
    reason: value.useCase,
  }));
  expect(await fake.request(req)).toEqual({
    approved: false,
    reason: 'cancel',
  });
  expect(fake.requests).toEqual([req]);
});

class Created extends DomainEvent {}
test('bus awaits handlers in publication order, including concurrent batches, and unsubscribes', async () => {
  const bus = new InMemoryEventBus({ record: true });
  const seen: string[] = [];
  const remove = bus.subscribe(async (event) => {
    await Bun.sleep(2);
    seen.push(String(event.payload));
  });
  const events = [new Created('a'), new Created('b'), new Created('c')];
  await Promise.all([
    bus.publish(events.slice(0, 2)),
    bus.publish(events.slice(2)),
  ]);
  expect(seen).toEqual(['a', 'b', 'c']);
  expect(bus.events).toEqual(events);
  remove();
  await bus.publish([new Created('d')]);
  expect(seen).toEqual(['a', 'b', 'c']);
});

test('bus rejects reentrant awaited publication without poisoning subsequent delivery', async () => {
  const errors: unknown[] = [];
  const bus = new InMemoryEventBus({
    record: true,
    onError: (error) => errors.push(error),
  });
  const remove = bus.subscribe(async (event) => {
    if (event.payload === 'outer') await bus.publish([new Created('inner')]);
  });
  const result = await Promise.race([
    bus.publish([new Created('outer')]).then(
      () => 'delivered',
      (error) => String(error),
    ),
    Bun.sleep(30).then(() => 'deadlocked'),
  ]);
  expect(result).toBe('delivered');
  expect(errors.map(String)).toEqual([
    expect.stringContaining('Reentrant publication'),
  ]);
  remove();
  await bus.publish([new Created('next')]);
  expect(bus.events.map((event) => event.payload)).toEqual(['outer', 'next']);
});

test('bus isolates a throwing handler: later handlers and events are still delivered', async () => {
  const failures: [unknown, DomainEvent][] = [];
  const bus = new InMemoryEventBus({
    onError: (error, event) => failures.push([error, event]),
  });
  const boom = new Error('boom');
  const seen: string[] = [];
  bus.subscribe((event) => {
    if (event.payload === 'a') throw boom;
  });
  bus.subscribe((event) => {
    seen.push(String(event.payload));
  });
  const [a, b] = [new Created('a'), new Created('b')];
  await bus.publish([a, b]);
  expect(seen).toEqual(['a', 'b']);
  expect(failures).toEqual([[boom, a]]);
});

test('bus reports a handler error to console.error without onError', async () => {
  const original = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => void calls.push(args);
  try {
    const bus = new InMemoryEventBus();
    const boom = new Error('boom');
    bus.subscribe(async () => {
      throw boom;
    });
    await bus.publish([new Created('a')]);
    expect(calls.flat()).toContain(boom);
  } finally {
    console.error = original;
  }
});

test('bus sends an error thrown by onError to console.error and still resolves', async () => {
  const original = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => void calls.push(args);
  try {
    const hookError = new Error('hook');
    const bus = new InMemoryEventBus({
      onError: () => {
        throw hookError;
      },
    });
    bus.subscribe(() => {
      throw new Error('boom');
    });
    await bus.publish([new Created('a')]);
    expect(calls.flat()).toContain(hookError);
  } finally {
    console.error = original;
  }
});

test('bus keeps no events unless record is true', async () => {
  const events = [new Created('a'), new Created('b')];
  const plain = new InMemoryEventBus();
  await plain.publish(events);
  expect(plain.events).toEqual([]);
  const recording = new InMemoryEventBus({ record: true });
  await recording.publish(events);
  expect(recording.events).toEqual(events);
});
