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
  const bus = new InMemoryEventBus();
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
