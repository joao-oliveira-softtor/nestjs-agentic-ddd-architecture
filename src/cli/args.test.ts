import { describe, expect, test } from 'bun:test';
import { parseArgs } from './args';

const spec = { booleans: ['--check'], values: ['--config'], positionals: 1 };

describe('parseArgs', () => {
  test('separa flags, valores e posicionais', () => {
    const parsed = parseArgs(['0002', '--check', '--config', 'x.ts'], spec);
    expect(typeof parsed).toBe('object');
    if (typeof parsed === 'string') return;
    expect([...parsed.flags]).toEqual(['--check']);
    expect(parsed.values.get('--config')).toBe('x.ts');
    expect(parsed.positionals).toEqual(['0002']);
  });

  test('erros de uso viram mensagem', () => {
    expect(parseArgs(['0002', '--nada'], spec)).toBe(
      'opção desconhecida: --nada',
    );
    expect(parseArgs(['0002', '--config'], spec)).toBe(
      '--config exige um valor',
    );
    expect(parseArgs([], spec)).toBe('esperado 1 argumento(s), recebido 0');
    expect(parseArgs(['a', 'b'], spec)).toBe(
      'esperado 1 argumento(s), recebido 2',
    );
  });
});
