import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { Entity as RootEntity } from 'nestjs-agentic-ddd-architecture';
import { Entity } from 'nestjs-agentic-ddd-architecture/core';
import { defaultRegistry } from 'nestjs-agentic-ddd-architecture/decorators';
import {
  buildIR,
  irHash,
  analyzeProject,
  defineConfig,
} from 'nestjs-agentic-ddd-architecture/compiler';
import {
  OperatorRuntime,
  InMemoryEventBus,
} from 'nestjs-agentic-ddd-architecture/runtime';
import {
  AgenticModule,
  LLM_PORT,
} from 'nestjs-agentic-ddd-architecture/nestjs';
import {
  FakeLlm,
  InMemoryEventBus as TestBus,
  covers,
} from 'nestjs-agentic-ddd-architecture/testing';
import {
  Greeting,
  GreetPerson,
  GreetingOperator,
  PREFIX,
} from './shop/domain.js';

assert.equal(RootEntity, Entity);
assert.equal(TestBus, InMemoryEventBus);
assert(defaultRegistry.entities.some((e) => e.target === Greeting));
assert.equal(
  covers(['operator:greeting-operator'], 'test'),
  '[covers: operator:greeting-operator] test',
);
const root = process.cwd();
const modules = defineConfig({
  modules: [{ name: 'shop', path: 'src/shop' }],
}).modules;
const { ir, errors } = buildIR(defaultRegistry, { root, modules });
assert.deepEqual(errors, []);
for (const declaration of [...ir.entities, ...ir.useCases, ...ir.operators])
  assert.match(declaration.source, /^src\/shop\/domain\.ts:\d+$/);
const skill = readFileSync(
  '.agentic/runtime/greeting-operator/SKILL.md',
  'utf8',
);
assert(skill.includes(irHash(ir)));
const llm = new FakeLlm([
  {
    content: [
      {
        type: 'tool_call',
        id: 'greet',
        name: 'greet_person',
        input: { name: 'Joao' },
      },
    ],
    stopReason: 'tool_calls',
  },
  { content: [{ type: 'text', text: 'Greeting sent.' }], stopReason: 'end' },
]);
@Module({
  imports: [
    AgenticModule.forRoot({ root, modules, llm }),
    AgenticModule.forFeature({
      operators: [GreetingOperator],
      useCases: [GreetPerson],
      providers: [{ provide: PREFIX, useValue: 'DI: ' }],
    }),
  ],
})
class AppModule {}
const app = await NestFactory.createApplicationContext(AppModule, {
  logger: false,
});
try {
  assert.equal(app.get(LLM_PORT), llm);
  const result = await app
    .get(OperatorRuntime)
    .run('greeting-operator', { message: 'Greet Joao.' });
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.steps[0]?.tools[0]?.result?.content, {
    output: { greeting: 'DI: Hello Joao' },
    events: [],
  });
  assert(llm.requests[0]?.system.includes('Use greet_person'));
  console.log(
    JSON.stringify({
      hash: irHash(ir),
      source: ir.entities[0]?.source,
      status: result.status,
    }),
  );
} finally {
  await app.close();
}
// Type-check the compiler API too without mutating the registry during the run.
void analyzeProject;
