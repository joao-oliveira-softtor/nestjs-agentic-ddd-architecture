import { describe, expect, test } from 'bun:test';
import { runCommand } from './run-command';

describe('runCommand', () => {
  test('o stdout também entra na cauda (tsc e oxlint escrevem lá)', async () => {
    const result = await runCommand(
      ['sh', '-c', 'echo TS2304 erro de tipo; exit 2'],
      process.cwd(),
    );
    expect(result.outputTail).toContain('TS2304');
  });

  test('um comando que falha devolve o código e o fim do stderr', async () => {
    const result = await runCommand(
      ['sh', '-c', 'echo primeira >&2; echo ultima >&2; exit 3'],
      process.cwd(),
    );
    expect(result.exitCode).toBe(3);
    expect(result.timedOut).toBe(false);
    expect(result.outputTail).toContain('ultima');
  });

  test('guarda só as últimas linhas do stderr', async () => {
    const result = await runCommand(
      ['sh', '-c', 'for i in $(seq 1 50); do echo linha$i >&2; done; exit 1'],
      process.cwd(),
    );
    expect(result.outputTail).toContain('linha50');
    expect(result.outputTail).not.toContain('linha30\n');
    expect(result.outputTail.split('\n').length).toBeLessThanOrEqual(20);
  });

  test('estourar o timeout mata o processo e marca timedOut', async () => {
    const started = Date.now();
    const result = await runCommand(['sleep', '5'], process.cwd(), 100);
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(-1);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  test('um filho que segura o pipe aberto não estende o timeout', async () => {
    const started = Date.now();
    const result = await runCommand(
      ['sh', '-c', 'sleep 8; true'],
      process.cwd(),
      200,
    );
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('um comando que passa não marca timeout', async () => {
    const result = await runCommand(['true'], process.cwd());
    expect(result).toEqual({ exitCode: 0, outputTail: '', timedOut: false });
  });
});
