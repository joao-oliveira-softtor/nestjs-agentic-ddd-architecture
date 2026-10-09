import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadDataset } from '../scripts/evals/dataset';
import {
  judge,
  parseAnswer,
  parseImplementationReply,
} from '../scripts/evals/judge';
import { manifestSchema, type JsonValue } from '../scripts/evals/contracts';

export const manifestFixture = {
  schemaVersion: 1,
  sourceRef: 'HEAD',
  skillDatasets: [
    {
      path: 'evals/skills/orders.yaml',
      contextRoots: {
        dev: ['AGENTS.md', '.agents/skills/orders-dev'],
        runtime: ['.agentic/runtime/order-operator'],
      },
    },
  ],
  benchmark: 'tasks',
  configurations: [
    {
      id: 'scripted-test',
      adapter: 'scripted',
      model: 'scripted',
      parameters: {},
    },
  ],
  budget: {
    maxInvocations: 30,
    skillTimeoutMs: 120000,
    implementationTimeoutMs: 600000,
    totalTimeoutMs: 5400000,
    maxCorrectionsPerItem: 1,
    repetitions: 1,
    concurrency: 1,
  },
};

describe('deterministic evaluation contracts', () => {
  test('exact preserves spaces, case and accents', () => {
    for (const value of ['sim ', 'Sim', ' sim', 'sím'])
      expect(
        judge({ type: 'exact', value: 'sim' }, { type: 'exact', value }),
      ).toBe('incorrect');
    expect(
      judge({ type: 'exact', value: 'não' }, { type: 'exact', value: 'não' }),
    ).toBe('correct');
  });
  test('tool calls ignore object ordering but preserve keys, types and array ordering', () => {
    const expected = {
      type: 'tool_call' as const,
      name: 'cancel_order',
      input: { order_id: '7f3c', reason: 'desistiu' },
    };
    expect(
      judge(expected, {
        type: 'tool_call',
        name: 'cancel_order',
        input: { reason: 'desistiu', order_id: '7f3c' },
      }),
    ).toBe('correct');
    const inputs: Record<string, JsonValue>[] = [
      { order_id: '7f3c' },
      { order_id: 7, reason: 'desistiu' },
      { ...expected.input, extra: true },
    ];
    for (const input of inputs)
      expect(
        judge(expected, { type: 'tool_call', name: 'cancel_order', input }),
      ).toBe('incorrect');
    expect(
      judge(
        { type: 'tool_call', name: 'x', input: { a: [1, 2] } },
        { type: 'tool_call', name: 'x', input: { a: [2, 1] } },
      ),
    ).toBe('incorrect');
    expect(judge(expected, { type: 'exact', value: 'cancel_order' })).toBe(
      'incorrect',
    );
  });
  test('only a single strict JSON response is accepted', () => {
    expect(parseAnswer(' \n{"type":"exact","value":"sim"}\n')).toEqual({
      type: 'exact',
      value: 'sim',
    });
    for (const text of [
      '',
      'sim',
      '```json\n{"type":"exact","value":"sim"}\n```',
      '{"type":"exact","value":"sim","extra":1}',
      '{"type":"tool_call","name":"x","input":null}',
      '{"type":"unknown"}',
    ])
      expect(() => parseAnswer(text)).toThrow();
    expect(
      parseImplementationReply(
        '{"status":"blocked","summary":"need dependency"}',
      ).status,
    ).toBe('blocked');
    expect(() =>
      parseImplementationReply(
        '{"status":"done","summary":"ok","accepted":true}',
      ),
    ).toThrow();
  });
  test('original dataset has five validated cases; duplicate IDs and bad audience fail', async () => {
    expect(
      await loadDataset(
        resolve(import.meta.dir, '../evals/skills/orders.yaml'),
      ),
    ).toHaveLength(5);
    const root = await mkdtemp(join(tmpdir(), 'eval-contracts-'));
    try {
      const path = join(root, 'data.yaml');
      for (const data of [
        [
          {
            id: 'x',
            audience: 'bad',
            question: 'q',
            expect: { type: 'exact', value: 'a' },
          },
        ],
        Array(2).fill({
          id: 'x',
          audience: 'dev',
          question: 'q',
          expect: { type: 'exact', value: 'a' },
        }),
        [
          {
            id: 'x',
            audience: 'dev',
            question: 'q',
            expect: { type: 'exact', value: '' },
          },
        ],
      ]) {
        await writeFile(path, JSON.stringify(data));
        let failure: unknown;
        try {
          await loadDataset(path);
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeInstanceOf(Error);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  test('manifest requires explicit bounded budget and unique configurations', () => {
    expect(manifestSchema.parse(manifestFixture).budget.maxInvocations).toBe(
      30,
    );
    expect(() =>
      manifestSchema.parse({ ...manifestFixture, budget: undefined }),
    ).toThrow();
    expect(() =>
      manifestSchema.parse({
        ...manifestFixture,
        budget: { ...manifestFixture.budget, concurrency: 2 },
      }),
    ).toThrow();
    expect(() =>
      manifestSchema.parse({
        ...manifestFixture,
        configurations: [
          ...manifestFixture.configurations,
          ...manifestFixture.configurations,
        ],
      }),
    ).toThrow();
    expect(() =>
      manifestSchema.parse({ ...manifestFixture, sourceRef: '--help' }),
    ).toThrow();
  });
});
