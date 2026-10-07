import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../..');
const insideVerify = process.env.AGENTIC_DDD_VERIFY === '1';

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
  test('uso incorreto sai com 2', () => {
    expect(run('verify').code).toBe(2);
  });

  test('número inválido ou proposta inexistente sai com 1 e explica', () => {
    const invalid = run('verify', 'abc');
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain(
      'verify: número de change inválido "abc" (esperado NNNN)',
    );
    const missing = run('verify', '9999');
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('verify: proposta 9999 não encontrada');
  });

  test('domínio que não compila mostra a causa em vez de "não encontrada"', () => {
    const result = run(
      'verify',
      '0001',
      '--config',
      'test/fixtures/broken/agentic.config.ts',
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('verify: o domínio não compila');
    expect(result.stderr).toContain('domain/thing.ts:5:');
    expect(result.stderr).not.toContain('não encontrada');
  });

  test('proposta inválida mostra a dica do compile em vez de "não encontrada"', () => {
    const result = run(
      'verify',
      '0001',
      '--config',
      'test/fixtures/invalid-proposal/agentic.config.ts',
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'verify: há propostas inválidas em changes/',
    );
    expect(result.stderr).toContain('escreva o id entre aspas');
    expect(result.stderr).not.toContain('não encontrada');
  });

  test.skipIf(insideVerify)(
    'verify 0001 do exemplo retorna done',
    () => {
      const result = run('verify', '0001');
      const report = JSON.parse(result.stdout) as {
        status: string;
        gates: { id: string; status: string; findings: unknown[] }[];
      };
      expect(report.gates.filter((g) => g.status !== 'passed')).toEqual([]);
      expect(report.status).toBe('done');
      expect(result.code).toBe(0);
      expect(result.stderr).toContain('G4 Regras: passed');
    },
    300_000,
  );

  test.skipIf(insideVerify)(
    'verify 0002 do exemplo retorna needs-human por causa do critério manual',
    () => {
      const result = run('verify', '0002');
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
        'critério manual pendente: criterion:0002/revisao-de-copy — a mensagem de erro do cancelamento sem motivo foi revisada pelo time de produto',
      ]);
      expect(
        report.gates.find((g) => g.id === 'G4')!.warnings.length,
      ).toBeGreaterThan(0);
      expect(result.code).toBe(0);
    },
    300_000,
  );
});
