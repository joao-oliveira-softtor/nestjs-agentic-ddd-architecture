import { Module } from '@nestjs/common';
import { resolve } from 'node:path';
import { AgenticModule } from '@agentic-ddd/nestjs';
import { FakeLlm } from '@agentic-ddd/testing';
import { OrdersModule } from '../examples/orders/orders.module';

@Module({
  imports: [
    AgenticModule.forRoot({
      // The v0 composition has no external channel/provider; tests supply scripts.
      llm: new FakeLlm([]),
      root: resolve(import.meta.dir, '..'),
      modules: [{ name: 'orders', path: 'examples/orders' }],
    }),
    OrdersModule,
  ],
})
export class AppModule {}
