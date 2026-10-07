import { describe, expect, test } from 'bun:test';
import { defaultRegistry } from '@agentic-ddd/decorators';
import { covers } from '@agentic-ddd/testing';
import { CancelOrder } from '../application/cancel-order';
import { ConfirmOrder } from '../application/confirm-order';
import { CreateOrder } from '../application/create-order';
import { OrderOperator } from '../operators/order.operator';

describe('order-operator', () => {
  test(
    covers(
      ['operator:order-operator'],
      'expõe os três use-cases e exige aprovação para cancelar',
    ),
    () => {
      const record = defaultRegistry.operators.find(
        (o) => o.target === OrderOperator,
      )!;
      expect(record.useCases).toEqual([CreateOrder, ConfirmOrder, CancelOrder]);
      expect(record.requiresApproval).toEqual([CancelOrder]);
    },
  );
});
