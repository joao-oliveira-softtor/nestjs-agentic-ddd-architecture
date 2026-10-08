import { Module } from '@nestjs/common';
import { AgenticModule } from '@agentic-ddd/nestjs';
import { CreateOrder } from './application/create-order';
import { ConfirmOrder } from './application/confirm-order';
import { CancelOrder } from './application/cancel-order';
import type { OrderRepository } from './domain/order.repository';
import { InMemoryOrderRepository } from './infrastructure/in-memory-order.repository';
import { OrderOperator } from './operators/order.operator';

export const ORDER_REPOSITORY = Symbol('orders.OrderRepository');

@Module({
  imports: [
    AgenticModule.forFeature({
      operators: [OrderOperator],
      providers: [
        {
          provide: ORDER_REPOSITORY,
          useFactory: () => new InMemoryOrderRepository(),
        },
      ],
      useCases: [
        {
          provide: CreateOrder,
          inject: [ORDER_REPOSITORY],
          useFactory: (orders: OrderRepository) => new CreateOrder(orders),
        },
        {
          provide: ConfirmOrder,
          inject: [ORDER_REPOSITORY],
          useFactory: (orders: OrderRepository) => new ConfirmOrder(orders),
        },
        {
          provide: CancelOrder,
          inject: [ORDER_REPOSITORY],
          useFactory: (orders: OrderRepository) => new CancelOrder(orders),
        },
      ],
    }),
  ],
  exports: [AgenticModule],
})
export class OrdersModule {}
