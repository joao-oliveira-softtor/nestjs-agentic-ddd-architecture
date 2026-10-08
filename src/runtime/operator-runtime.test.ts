import { fixture } from '../../test/helpers/runtime';
import { expect, test } from 'bun:test';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FakeLlm } from '@agentic-ddd/testing';
import { OperatorRuntime } from './index';

test('registration loads matching skill; request uses instructions, allowlist, schema and model', async () => {
  const f = fixture();
  const llm = new FakeLlm([
    { content: [{ type: 'text', text: 'done' }], stopReason: 'end' },
  ]);
  const runtime = new OperatorRuntime({ ...f, llm });
  await runtime.register(
    f.Agent,
    new Map([[f.Tool, { execute: async (input: unknown) => input }]]),
  );
  const result = await runtime.run('agent', {
    message: 'work',
    context: { customer: '7' },
  });
  expect(result.status).toBe('completed');
  const req = llm.requests[0]!;
  expect(req.model).toBe('test-model');
  expect(req.system).toBe(
    'Follow instructions\n\n# Runtime skill\nUse tool with care.\n',
  );
  expect(req.messages).toEqual([
    { role: 'user', text: 'work' },
    { role: 'user', text: 'Context: {"customer":"7"}' },
  ]);
  expect(req.tools).toEqual([
    {
      name: 'tool',
      description:
        'Do work\nQuando usar: For work\nQuando não usar: For leisure',
      inputSchema: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
      },
    },
  ]);
  expect(req.toolChoice).toBe('auto');
});

for (const variant of [
  'missing',
  'stale',
  'no-hash',
  'changed-registry',
] as const) {
  test(`registration rejects ${variant} skill and recommends compile`, async () => {
    const f = fixture();
    if (variant === 'missing') rmSync(join(f.skillDir, 'SKILL.md'));
    if (variant === 'stale')
      writeFileSync(
        join(f.skillDir, 'SKILL.md'),
        f.skill.replace(/[a-f0-9]{64}/, '0'.repeat(64)),
      );
    if (variant === 'no-hash')
      writeFileSync(join(f.skillDir, 'SKILL.md'), '# no metadata');
    if (variant === 'changed-registry')
      f.registry.useCases[0] = {
        ...f.registry.useCases[0]!,
        description: 'changed',
      };
    const runtime = new OperatorRuntime({ ...f, llm: new FakeLlm([]) });
    expect(
      runtime.register(
        f.Agent,
        new Map([[f.Tool, { execute: async (input: unknown) => input }]]),
      ),
    ).rejects.toThrow('compile');
  });
}

test('registration fails without injected allowlisted instance or for unknown operator', async () => {
  const f = fixture();
  const runtime = new OperatorRuntime({ ...f, llm: new FakeLlm([]) });
  expect(runtime.register(f.Agent, new Map())).rejects.toThrow('instance');
  expect(runtime.run('missing', { message: 'x' })).rejects.toThrow(
    'Unknown operator',
  );
});
