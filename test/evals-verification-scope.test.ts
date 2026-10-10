import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { runTests } from '../src/compiler/verify/test-run';

// The outer framework suite exercises every benchmark. A domain's nested
// quality collection must execute its business tests without launching those
// independent benchmark campaigns again.
test.skipIf(process.env.AGENTIC_DDD_VERIFY === '1')(
  'nested quality collection skips benchmark orchestration and executes domain coverage',
  async () => {
    const result = await runTests(
      [
        'bun',
        'test',
        './test/evals-implementation.test.ts',
        './test/evals-run.test.ts',
        './test/evals-extended.test.ts',
        './test/evals-aggregate.test.ts',
        './examples/orders',
      ],
      resolve(import.meta.dir, '..'),
    );
    expect(result.exitCode).toBe(0);
    expect(result.collectionError).toBeUndefined();
    const benchmark = result.cases.filter((c) => c.covers.length === 0);
    expect(benchmark.length).toBeGreaterThan(30);
    expect(benchmark.every((c) => c.status === 'skipped')).toBe(true);
    const domain = result.cases.filter((c) => c.covers.length > 0);
    expect(
      domain.some((c) =>
        c.covers.some((id) => id.startsWith('method:Order.')),
      ),
    ).toBe(true);
    expect(domain.every((c) => c.status === 'passed')).toBe(true);
  },
  300000,
);
