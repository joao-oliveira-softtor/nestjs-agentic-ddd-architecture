import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Test-only completed bodies, expanded across lines within the slots prepared by the manager.
const SOLUTIONS: Record<
  string,
  { file?: string; body?: string; test: string }
> = {
  'entity:Task': {
    file: 'domain/task.ts',
    body: "const normalized = title.trim(); if (!normalized) throw new DomainError('TASK_TITLE_REQUIRED', 'Título obrigatório.'); const task = new Task(id, normalized); task.record(new TaskCreated({ taskId: id, title: normalized })); return task;",
    test: `import { expect, test } from 'bun:test';
import { covers } from '@agentic-ddd/testing';
import { Task } from '../domain/task';
test(covers(['method:Task.create', 'criterion:0001/criacao'], 'cria tarefa normalizada e registra evento'), () => {
  const task = Task.create('t1', '  Ler  ');
  expect({ id: task.id, title: task.title, status: task.status }).toEqual({ id: 't1', title: 'Ler', status: 'pending' });
  const events = task.pullEvents();
  expect(events.map(e => [e.name, e.payload])).toEqual([['TaskCreated', { taskId: 't1', title: 'Ler' }]]);
  expect(task.pullEvents()).toEqual([]);
});
test(covers(['invariant:Task/titulo-obrigatorio', 'criterion:0001/titulo-invalido'], 'rejeita título vazio ou só espaços'), () => {
  for (const title of ['', '   ']) expect(() => Task.create('t1', title)).toThrow('Título obrigatório.');
  try { Task.create('t1', ''); } catch (e) { expect((e as {code: string}).code).toBe('TASK_TITLE_REQUIRED'); }
});`,
  },
  'method:Task.complete': {
    file: 'domain/task.ts',
    body: "if (this.#status !== 'pending') throw new DomainError('TASK_ALREADY_COMPLETED', 'Tarefa já concluída.'); this.#status = 'completed'; this.record(new TaskCompleted({ taskId: this.id }));",
    test: `import { expect, test } from 'bun:test';
import { covers } from '@agentic-ddd/testing';
import { Task } from '../domain/task';
test(covers(['method:Task.complete', 'criterion:0001/conclusao'], 'conclui, emite e rejeita repetição'), () => {
  const task = Task.create('t1', 'Ler'); task.pullEvents(); task.complete();
  expect(task.status).toBe('completed');
  expect(task.pullEvents().map(e => [e.name, e.payload])).toEqual([['TaskCompleted', { taskId: 't1' }]]);
  expect(() => task.complete()).toThrow('Tarefa já concluída.');
  try { task.complete(); } catch (e) { expect((e as {code: string}).code).toBe('TASK_ALREADY_COMPLETED'); }
  expect(task.pullEvents()).toEqual([]);
});`,
  },
  'usecase:create_task': {
    file: 'application/create-task.ts',
    body: "if (await this.tasks.findById(input.task_id)) throw new DomainError('TASK_ALREADY_EXISTS', 'Tarefa já existe.'); const task = Task.create(input.task_id, input.title); await this.tasks.save(task); await ctx.publish(task.pullEvents()); return { task_id: task.id, title: task.title, status: 'pending' };",
    test: `import { expect, test } from 'bun:test';
import { covers, createTestContext } from '@agentic-ddd/testing';
import { CreateTask } from '../application/create-task';
import { InMemoryTaskRepository } from '../infrastructure/in-memory-task.repository';
test(covers(['usecase:create_task', 'criterion:0001/persistencia-criacao'], 'persiste, publica e rejeita duplicado'), async () => {
  const repo = new InMemoryTaskRepository(); const ctx = createTestContext(); const uc = new CreateTask(repo);
  expect(await uc.execute({task_id: 't1', title: ' Ler '}, ctx)).toEqual({task_id: 't1', title: 'Ler', status: 'pending'});
  expect((await repo.findById('t1'))?.title).toBe('Ler');
  expect(ctx.published.map(e => [e.name, e.payload])).toEqual([['TaskCreated', {taskId: 't1', title: 'Ler'}]]);
  expect(ctx.published[0]?.correlationId).toBe(ctx.correlationId);
  await expect(uc.execute({task_id: 't1', title: 'Outra'}, ctx)).rejects.toMatchObject({code: 'TASK_ALREADY_EXISTS'});
  expect(ctx.published).toHaveLength(1);
});`,
  },
  'usecase:complete_task': {
    file: 'application/complete-task.ts',
    body: "const task = await this.tasks.findById(input.task_id); if (!task) throw new DomainError('TASK_NOT_FOUND', 'Tarefa não encontrada.'); task.complete(); await this.tasks.save(task); await ctx.publish(task.pullEvents()); return { task_id: task.id, status: 'completed' };",
    test: `import { expect, test } from 'bun:test';
import { covers, createTestContext } from '@agentic-ddd/testing';
import { CompleteTask } from '../application/complete-task';
import { Task } from '../domain/task';
import { InMemoryTaskRepository } from '../infrastructure/in-memory-task.repository';
test(covers(['usecase:complete_task', 'criterion:0001/persistencia-conclusao'], 'conclui, persiste, publica e rejeita id ausente'), async () => {
  const repo = new InMemoryTaskRepository(); const task = Task.create('t1', 'Ler'); task.pullEvents(); await repo.save(task);
  const ctx = createTestContext(); const uc = new CompleteTask(repo);
  expect(await uc.execute({task_id: 't1'}, ctx)).toEqual({task_id: 't1', status: 'completed'});
  expect((await repo.findById('t1'))?.status).toBe('completed');
  expect(ctx.published.map(e => [e.name, e.payload])).toEqual([['TaskCompleted', {taskId: 't1'}]]);
  await expect(uc.execute({task_id: 'missing'}, ctx)).rejects.toMatchObject({code: 'TASK_NOT_FOUND'});
  expect(ctx.published).toHaveLength(1);
});`,
  },
  'operator:task-operator': {
    test: `import { expect, test } from 'bun:test';
import { covers, FakeLlm, InMemoryEventBus } from '@agentic-ddd/testing';
import type { UseCase } from '@agentic-ddd/core';
import type { ClassRef } from '@agentic-ddd/decorators';
import { OperatorRuntime, type LlmResponse } from '@agentic-ddd/runtime';
import { CreateTask } from '../application/create-task';
import { CompleteTask } from '../application/complete-task';
import { TaskOperator } from '../operators/task.operator';
import { InMemoryTaskRepository } from '../infrastructure/in-memory-task.repository';
test(covers(['operator:task-operator', 'criterion:0001/tools'], 'operator executa tools reais e publica eventos'), async () => {
  const tool = (id: string, name: string, input: unknown): LlmResponse => ({content: [{type: 'tool_call', id, name, input}], stopReason: 'tool_calls'});
  const llm = new FakeLlm([tool('c', 'create_task', {task_id: 't1', title: 'Ler'}), tool('f', 'complete_task', {task_id: 't1'}), {content: [{type: 'text', text: 'Concluída.'}], stopReason: 'end'}]);
  const repo = new InMemoryTaskRepository(); const bus = new InMemoryEventBus();
  const runtime = new OperatorRuntime({llm, eventBus: bus, root: process.cwd(), modules: [{name: 'tasks', path: 'app'}]});
  await runtime.register(TaskOperator, new Map<ClassRef, UseCase<unknown, unknown>>([[CreateTask, new CreateTask(repo)], [CompleteTask, new CompleteTask(repo)]]));
  const result = await runtime.run('task-operator', {message: 'Crie e conclua t1'});
  expect(result.status).toBe('completed'); expect(result.output).toBe('Concluída.');
  expect((await repo.findById('t1'))?.status).toBe('completed');
  expect(llm.requests[0]?.tools.map(t => t.name)).toEqual(['complete_task', 'create_task']);
  expect(result.events.map(e => e.name)).toEqual(['TaskCreated', 'TaskCompleted']);
  expect(bus.events).toEqual(result.events);
});`,
  },
};

export async function completeItem(root: string, id: string) {
  const solution = SOLUTIONS[id];
  if (!solution) throw new Error(`No test solution: ${id}`);
  if (solution.file) {
    const path = join(root, 'app', solution.file);
    const before = await readFile(path, 'utf8');
    const pending = /\{\s*return notImplemented\(\);\s*\}/.exec(before)?.[0];
    if (!pending) throw new Error(`No pending body for ${id}`);
    const expanded = `{\n${solution.body!.replaceAll('; ', ';\n')}\n}`;
    const available = (pending.match(/\n/g) ?? []).length;
    const needed = (expanded.match(/\n/g) ?? []).length;
    if (needed > available)
      throw new Error(
        `Manager must prepare body space for ${id}: ${needed} lines needed, ${available} available`,
      );
    await writeFile(
      path,
      before.replace(
        pending,
        expanded.slice(0, -1) + '\n'.repeat(available - needed) + '}',
      ),
    );
  }
  await mkdir(join(root, 'app/test'), { recursive: true });
  await writeFile(
    join(root, 'app/test', id.replaceAll(/[:.]/g, '-') + '.test.ts'),
    solution.test + '\n',
  );
}
