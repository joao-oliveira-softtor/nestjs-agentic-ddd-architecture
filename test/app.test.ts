import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { AppModule } from '../src/app.module';

describe('AppModule', () => {
  test('não registra nenhum controller', () => {
    expect(Reflect.getMetadata('controllers', AppModule) ?? []).toEqual([]);
  });
});

test('AppModule compõe o runtime e os use-cases de orders', async () => {
  const { Test } = await import('@nestjs/testing');
  const { OperatorRuntime } = await import('@agentic-ddd/runtime');
  const { CreateOrder } =
    await import('../examples/orders/application/create-order');
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  try {
    expect(module.get(OperatorRuntime)).toBeInstanceOf(OperatorRuntime);
    expect(module.get(CreateOrder)).toBeInstanceOf(CreateOrder);
  } finally {
    await module.close();
  }
});
