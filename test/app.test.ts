import { resolve } from 'node:path';
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

test('build preserva localização das declarações e inicializa com BunAdapter', async () => {
  const root = resolve(import.meta.dir, '..');
  const build = Bun.spawn(['bun', 'run', 'build'], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(await build.exited).toBe(0);
  const app = Bun.spawn(['bun', 'dist/main.js'], {
    cwd: root,
    env: { ...process.env, PORT: '0' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const reader = app.stdout.getReader();
  let log = '';
  const timer = setTimeout(() => app.kill(), 3000);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      log += new TextDecoder().decode(value);
      if (log.includes('Nest application successfully started')) break;
    }
    expect(log).toContain('Nest application successfully started');
  } finally {
    clearTimeout(timer);
    app.kill();
    await app.exited;
    reader.releaseLock();
  }
}, 10000);
