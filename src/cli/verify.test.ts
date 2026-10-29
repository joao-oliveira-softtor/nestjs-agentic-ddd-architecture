import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../..');
const insideVerify = process.env.AGENTIC_DDD_VERIFY === '1';
// Same project, nested collection limited to the domain tests; CI runs the
// root-scoped `agentic verify 0001` as its own step.
const ORDERS = ['--config', 'test/fixtures/orders-verify/agentic.config.ts'];

function run(...args: string[]) {
  const result = Bun.spawnSync(['bun', 'src/cli/main.ts', ...args], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe('agentic-ddd verify', () => {
  test('wrong usage exits 2', () => {
    expect(run('verify').code).toBe(2);
  });

  test('invalid change number exits 2; missing proposal exits 1 and explains', () => {
    const invalid = run('verify', 'abc');
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).toContain(
      'verify: invalid change number "abc" (expected NNNN) [state.change-format]',
    );
    const missing = run('verify', '9999');
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('[verify.proposal-not-found]');
  });

  test('domain that does not compile shows the cause instead of "not found"', () => {
    const result = run(
      'verify',
      '0001',
      '--config',
      'test/fixtures/broken/agentic.config.ts',
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('[state.domain-invalid]');
    expect(result.stderr).toContain('domain/thing.ts:5:');
    expect(result.stderr).not.toContain('[verify.proposal-not-found]');
  });

  test('invalid proposal shows the compile hint instead of "not found"', () => {
    const result = run(
      'verify',
      '0001',
      '--config',
      'test/fixtures/invalid-proposal/agentic.config.ts',
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('[state.proposals-invalid]');
    expect(result.stderr).toContain('quote the id: id:');
    expect(result.stderr).not.toContain('[verify.proposal-not-found]');
  });

  test.skipIf(insideVerify)(
    'verify 0001 of the example returns done',
    () => {
      const result = run('verify', '0001', ...ORDERS);
      const report = JSON.parse(result.stdout) as {
        status: string;
        gates: { id: string; status: string; findings: unknown[] }[];
      };
      expect(report.gates.filter((g) => g.status !== 'passed')).toEqual([]);
      expect(report.status).toBe('done');
      expect(result.code).toBe(0);
      expect(result.stderr).toContain('G4 Rules: passed');
    },
    300_000,
  );

  test.skipIf(insideVerify)(
    'verify 0002 of the example returns needs-human because of the manual criterion',
    () => {
      const result = run('verify', '0002', ...ORDERS);
      const report = JSON.parse(result.stdout) as {
        status: string;
        gates: {
          id: string;
          status: string;
          findings: { message: string }[];
          warnings: { message: string }[];
        }[];
      };
      expect(report.gates.filter((g) => g.status === 'failed')).toEqual([]);
      expect(report.status).toBe('needs-human');
      const g6 = report.gates.find((g) => g.id === 'G6')!;
      expect(g6.findings.map((f) => f.message)).toEqual([
        'manual criterion pending: criterion:0002/revisao-de-copy — a mensagem de erro do cancelamento sem motivo foi revisada pelo time de produto',
      ]);
      expect(
        report.gates.find((g) => g.id === 'G4')!.warnings.length,
      ).toBeGreaterThan(0);
      expect(result.code).toBe(0);
    },
    300_000,
  );
});
