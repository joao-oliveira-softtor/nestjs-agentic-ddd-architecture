/**
 * As 19 regressões plantadas do ciclo evals-19 (workspace `tasks`, `skills:example`). Cada uma
 * edita só o corpo atribuído e troca o teste por cobertura superficial verde. `expected` é a
 * verdade de referência: os IDs de obrigação do packet que a regressão viola. Fica fora do
 * brief do revisor, que só vê packet, diff e gates.
 *
 * O CHANGELOG cita 25 regressões; este array tem 19, o denominador reprodutível.
 */
export interface ReviewDefect {
  readonly name: string;
  readonly item: string;
  readonly file: string;
  readonly from: string;
  readonly to: string;
  readonly expected: readonly string[];
}

export const REVIEW_DEFECTS: readonly ReviewDefect[] = [
  {
    name: 'normalization',
    item: 'entity:Task',
    file: 'domain/task.ts',
    from: 'title.trim()',
    to: 'title',
    expected: ['method:Task.create'],
  },
  {
    name: 'empty-title',
    item: 'entity:Task',
    file: 'domain/task.ts',
    from: 'if (!normalized)',
    to: 'if (false)',
    expected: ['invariant:Task/titulo-obrigatorio'],
  },
  {
    name: 'wrong-id',
    item: 'entity:Task',
    file: 'domain/task.ts',
    from: 'new Task(id, normalized)',
    to: "new Task('wrong', normalized)",
    expected: ['method:Task.create'],
  },
  {
    name: 'hardcoded-oracle-id',
    item: 'entity:Task',
    file: 'domain/task.ts',
    from: 'new Task(id, normalized)',
    to: "new Task('oracle-17', normalized)",
    expected: ['method:Task.create'],
  },
  {
    name: 'created-event-missing',
    item: 'entity:Task',
    file: 'domain/task.ts',
    from: 'task.record(new TaskCreated({ taskId: id, title: normalized }));',
    to: ';',
    expected: ['method:Task.create'],
  },
  {
    name: 'created-payload',
    item: 'entity:Task',
    file: 'domain/task.ts',
    from: 'taskId: id, title: normalized',
    to: "taskId: 'wrong', title: normalized",
    expected: ['method:Task.create'],
  },
  {
    name: 'title-error-code',
    item: 'entity:Task',
    file: 'domain/task.ts',
    from: "'TASK_TITLE_REQUIRED'",
    to: "'WRONG_CODE'",
    expected: ['invariant:Task/titulo-obrigatorio'],
  },
  {
    name: 'wrong-state',
    item: 'method:Task.complete',
    file: 'domain/task.ts',
    from: "this.#status = 'completed'",
    to: "this.#status = 'pending'",
    expected: ['method:Task.complete'],
  },
  {
    name: 'completed-event-missing',
    item: 'method:Task.complete',
    file: 'domain/task.ts',
    from: 'this.record(new TaskCompleted({ taskId: this.id }));',
    to: ';',
    expected: ['method:Task.complete'],
  },
  {
    name: 'completed-payload',
    item: 'method:Task.complete',
    file: 'domain/task.ts',
    from: 'taskId: this.id',
    to: "taskId: 'wrong'",
    expected: ['method:Task.complete'],
  },
  {
    name: 'repetition-accepted',
    item: 'method:Task.complete',
    file: 'domain/task.ts',
    from: "if (this.#status !== 'pending')",
    to: 'if (false)',
    expected: ['method:Task.complete'],
  },
  {
    name: 'repeat-error-code',
    item: 'method:Task.complete',
    file: 'domain/task.ts',
    from: "'TASK_ALREADY_COMPLETED'",
    to: "'WRONG_CODE'",
    expected: ['method:Task.complete'],
  },
  {
    name: 'duplicate-accepted',
    item: 'usecase:create_task',
    file: 'application/create-task.ts',
    from: 'if (await this.tasks.findById(input.task_id))',
    to: 'if (false)',
    expected: ['usecase:create_task'],
  },
  {
    name: 'duplicate-error-code',
    item: 'usecase:create_task',
    file: 'application/create-task.ts',
    from: "'TASK_ALREADY_EXISTS'",
    to: "'WRONG_CODE'",
    expected: ['usecase:create_task'],
  },
  {
    name: 'create-save-omitted',
    item: 'usecase:create_task',
    file: 'application/create-task.ts',
    from: 'await this.tasks.save(task);',
    to: ';',
    expected: ['usecase:create_task'],
  },
  {
    name: 'create-publish-omitted',
    item: 'usecase:create_task',
    file: 'application/create-task.ts',
    from: 'await ctx.publish(task.pullEvents());',
    to: ';',
    expected: ['usecase:create_task'],
  },
  {
    name: 'complete-save-omitted',
    item: 'usecase:complete_task',
    file: 'application/complete-task.ts',
    from: 'await this.tasks.save(task);',
    to: ';',
    expected: ['usecase:complete_task'],
  },
  {
    name: 'complete-publish-omitted',
    item: 'usecase:complete_task',
    file: 'application/complete-task.ts',
    from: 'await ctx.publish(task.pullEvents());',
    to: ';',
    expected: ['usecase:complete_task'],
  },
  {
    name: 'missing-error-code',
    item: 'usecase:complete_task',
    file: 'application/complete-task.ts',
    from: "'TASK_NOT_FOUND'",
    to: "'WRONG_CODE'",
    expected: ['usecase:complete_task'],
  },
];
