import 'reflect-metadata';
import { describe, expect, spyOn, test } from 'bun:test';
import { Test } from '@nestjs/testing';
import { AgenticModule } from '@agentic-ddd/nestjs';
import { OperatorRuntime, type LlmResponse } from '@agentic-ddd/runtime';
import {
  covers,
  FakeLlm,
  FakeApproval,
  InMemoryEventBus,
} from '@agentic-ddd/testing';
import { compile, loadConfig } from '@agentic-ddd/compiler';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CancelOrder } from '../application/cancel-order';
import { OrdersModule, ORDER_REPOSITORY } from '../orders.module';
import { InMemoryOrderRepository } from '../infrastructure/in-memory-order.repository';
import { Order } from '../domain/order';

const configPath = resolve(process.cwd(), 'agentic.config.ts');
const { root, modules } = await loadConfig(configPath);
const orderInput = {
  order_id: 'e2e-order',
  customer_id: 'customer',
  items: [{ sku: 'sku', quantity: 2, unit_price: 12 }],
};
const text: LlmResponse = {
  content: [{ type: 'text', text: 'Pedido confirmado.' }],
  stopReason: 'end',
};
const tool = (id: string, name: string, input: unknown): LlmResponse => ({
  content: [{ type: 'tool_call', id, name, input }],
  stopReason: 'tool_calls',
});

async function composition(
  llm: FakeLlm,
  approval: FakeApproval,
  runtimeDir?: string,
) {
  const bus = new InMemoryEventBus();
  const module = await Test.createTestingModule({
    imports: [
      AgenticModule.forRoot({
        llm,
        approval,
        eventBus: bus,
        root,
        modules,
        runtimeDir,
      }),
      OrdersModule,
    ],
  }).compile();
  return {
    module,
    bus,
    runtime: module.get(OperatorRuntime),
    repository: module.get<InMemoryOrderRepository>(ORDER_REPOSITORY),
  };
}

describe('order-operator E2E', () => {
  test(
    covers(
      ['operator:order-operator'],
      'compile → skill → Nest → FakeLlm cria e confirma pedido',
    ),
    async () => {
      const out = mkdtempSync(join(tmpdir(), 'orders-runtime-e2e-'));
      try {
        await compile({
          configPath,
          outRoot: out,
          mode: 'write',
        });
        const native = { reasoning: ['provider content'] };
        const llm = new FakeLlm([
          {
            ...tool('create', 'create_order', orderInput),
            providerPayload: native,
          },
          tool('confirm', 'confirm_order', { order_id: orderInput.order_id }),
          text,
        ]);
        const approval = new FakeApproval(false);
        const f = await composition(
          llm,
          approval,
          join(out, '.agentic/runtime'),
        );
        try {
          const result = await f.runtime.run('order-operator', {
            message: 'Crie e confirme meu pedido.',
          });
          expect(result.status).toBe('completed');
          expect(result.output).toBe('Pedido confirmado.');
          expect(result.steps).toHaveLength(3);
          expect(approval.requests).toEqual([]);
          expect(
            (await f.repository.findById(orderInput.order_id))?.status,
          ).toBe('confirmed');
          const skill = readFileSync(
            join(out, '.agentic/runtime/order-operator/SKILL.md'),
            'utf8',
          ).split('\n---\n')[1]!;
          expect(llm.requests[0]!.system).toContain(skill);
          expect(llm.requests[0]!.system).toContain('responda em português');
          expect(llm.requests[0]!.tools.map((t) => t.name)).toEqual([
            'cancel_order',
            'confirm_order',
            'create_order',
          ]);
          expect(llm.requests[0]!.tools[0]!.inputSchema).toMatchObject({
            required: ['order_id', 'reason'],
          });
          expect(result.steps[0]!.tools[0]!.result?.content).toEqual({
            output: {
              order_id: orderInput.order_id,
              status: 'pending',
              total: 24,
            },
            events: [
              {
                name: 'OrderCreated',
                payload: {
                  orderId: orderInput.order_id,
                  customerId: orderInput.customer_id,
                  total: 24,
                },
              },
            ],
          });
          expect(result.steps[1]!.tools[0]!.result?.content).toMatchObject({
            output: { order_id: orderInput.order_id, status: 'confirmed' },
          });
          const assistant = llm.requests[1]!.messages[1]!;
          expect(
            assistant.role === 'assistant' && assistant.providerPayload,
          ).toBe(native);
          expect(result.events.map((e) => e.name)).toEqual([
            'OrderCreated',
            'OrderConfirmed',
          ]);
          expect(f.bus.events).toEqual(result.events);
          expect(new Set(result.events.map((e) => e.eventId)).size).toBe(2);
          for (const [i, event] of result.events.entries()) {
            expect(event.correlationId).toBe(result.runId);
            expect(event.causationId).toBe(result.steps[i]!.id);
            expect(result.steps[i]!.events).toEqual([event]);
          }
        } finally {
          await f.module.close();
        }
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
    },
  );

  for (const approved of [false, true]) {
    test(
      covers(
        ['operator:order-operator'],
        `cancelamento com aprovação ${approved ? 'concedida' : 'negada'}`,
      ),
      async () => {
        const llm = new FakeLlm([
          tool('cancel', 'cancel_order', {
            order_id: orderInput.order_id,
            reason: 'Desisti',
          }),
          {
            content: [
              {
                type: 'text',
                text: approved ? 'Cancelado.' : 'Aprovação negada.',
              },
            ],
            stopReason: 'end',
          },
        ]);
        const approval = new FakeApproval(() => ({
          approved,
          reason: 'Decisão humana',
        }));
        const f = await composition(llm, approval);
        const order = Order.create({
          id: orderInput.order_id,
          customerId: orderInput.customer_id,
          items: [{ sku: 'sku', quantity: 2, unitPrice: 12 }],
        });
        order.pullEvents();
        await f.repository.save(order);
        const execute = spyOn(f.module.get(CancelOrder), 'execute');
        try {
          const result = await f.runtime.run('order-operator', {
            message: 'Cancele o pedido.',
          });
          expect(result.status).toBe('completed');
          expect(approval.requests).toHaveLength(1);
          expect(approval.requests[0]).toEqual({
            operator: 'order-operator',
            runId: result.runId,
            useCase: 'cancel_order',
            input: { order_id: orderInput.order_id, reason: 'Desisti' },
          });
          expect(execute).toHaveBeenCalledTimes(approved ? 1 : 0);
          expect(order.status).toBe(approved ? 'cancelled' : 'pending');
          expect(result.events.map((e) => e.name)).toEqual(
            approved ? ['OrderCancelled'] : [],
          );
          expect(f.bus.events).toEqual(result.events);
          expect(result.steps[0]!.tools[0]!.approval).toEqual({
            approved,
            reason: 'Decisão humana',
          });
          const results = llm.requests[1]!.messages[2]!;
          expect(results.role).toBe('tool');
          if (results.role !== 'tool') throw new Error('missing results');
          expect(results.results[0]!.isError).toBe(!approved);
          if (!approved) {
            expect(results.results[0]!.content).toEqual({
              code: 'approval_denied',
              reason: 'Decisão humana',
            });
            expect(result.steps[0]!.events).toEqual([]);
          } else {
            expect(results.results[0]!.content).toMatchObject({
              output: { order_id: orderInput.order_id, status: 'cancelled' },
              events: [
                {
                  name: 'OrderCancelled',
                  payload: { orderId: orderInput.order_id },
                },
              ],
            });
            expect(result.events[0]!.correlationId).toBe(result.runId);
            expect(result.events[0]!.causationId).toBe(result.steps[0]!.id);
          }
        } finally {
          execute.mockRestore();
          await f.module.close();
        }
      },
    );
  }
});
