import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EMPTY_IR } from './diff';
import { parseLock, readLock, serializeLock, type DomainLock } from './lock';

const lock: DomainLock = {
  lockVersion: 1,
  ir: EMPTY_IR,
  changes: [
    {
      id: '0001',
      title: 'estado inicial',
      path: 'changes/archive/0001-estado-inicial/proposal.md',
      summary: 'Base do histórico.',
      hash: 'abc',
      items: [
        {
          id: 'entity:Order',
          kind: 'added',
          classification: 'behavioral',
          module: 'orders',
        },
      ],
    },
  ],
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agentic-lock-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('lock', () => {
  test('serializa de forma estável e volta igual', () => {
    const text = serializeLock(lock);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.indexOf('"changes"')).toBeLessThan(text.indexOf('"ir"'));
    expect(parseLock(text, '.agentic/domain.lock.json')).toEqual(lock);
  });

  test('JSON malformado vira erro em pt-BR com o caminho', () => {
    expect(() => parseLock('{', '.agentic/domain.lock.json')).toThrow(
      '.agentic/domain.lock.json: lock inválido (JSON malformado); restaure-o pelo git',
    );
  });

  test('versão desconhecida e lock incompleto viram erro', () => {
    expect(() => parseLock('{"lockVersion":2}', 'l.json')).toThrow(
      'l.json: lockVersion 2 não suportada (esperado 1)',
    );
    expect(() => parseLock('{"lockVersion":1,"changes":[]}', 'l.json')).toThrow(
      'l.json: lock incompleto (faltam ir ou changes)',
    );
  });

  test('valueObjects no lock: array aceito, outro tipo recusado', () => {
    const withVo = (v: unknown): string =>
      JSON.stringify({ ...lock, ir: { ...lock.ir, valueObjects: v } });
    expect(() => parseLock(withVo([]), 'l.json')).not.toThrow();
    expect(() => parseLock(withVo('x'), 'l.json')).toThrow(
      'l.json: lock incompleto',
    );
  });

  test('ports no lock: array aceito, outro tipo recusado', () => {
    const withPorts = (v: unknown): string =>
      JSON.stringify({ ...lock, ir: { ...lock.ir, ports: v } });
    expect(() => parseLock(withPorts([]), 'l.json')).not.toThrow();
    expect(() => parseLock(withPorts('x'), 'l.json')).toThrow(
      'l.json: lock incompleto',
    );
  });

  test('adapters no lock: array aceito, outro tipo recusado', () => {
    const withAdapters = (v: unknown): string =>
      JSON.stringify({ ...lock, ir: { ...lock.ir, adapters: v } });
    expect(() => parseLock(withAdapters([]), 'l.json')).not.toThrow();
    expect(() => parseLock(withAdapters('x'), 'l.json')).toThrow(
      'l.json: lock incompleto',
    );
  });

  test('readLock devolve null quando o arquivo não existe', async () => {
    expect(await readLock(join(dir, 'nao-existe.json'), 'x')).toBeNull();
    await writeFile(join(dir, 'l.json'), serializeLock(lock));
    expect(await readLock(join(dir, 'l.json'), 'l.json')).toEqual(lock);
  });

  test('JSON válido que não é objeto vira lock incompleto', () => {
    expect(() => parseLock('[]', 'l.json')).toThrow(
      'l.json: lock incompleto (faltam ir ou changes); restaure-o pelo git',
    );
    expect(() => parseLock('null', 'l.json')).toThrow(
      'l.json: lock incompleto (faltam ir ou changes); restaure-o pelo git',
    );
    expect(() => parseLock('5', 'l.json')).toThrow(
      'l.json: lock incompleto (faltam ir ou changes); restaure-o pelo git',
    );
    expect(() => parseLock('"x"', 'l.json')).toThrow(
      'l.json: lock incompleto (faltam ir ou changes); restaure-o pelo git',
    );
  });

  test('lock com ir válido mas sem arrays vira incompleto', () => {
    expect(() =>
      parseLock(
        '{"lockVersion":1,"ir":{"irVersion":1},"changes":[]}',
        'l.json',
      ),
    ).toThrow(
      'l.json: lock incompleto (faltam ir ou changes); restaure-o pelo git',
    );
  });

  test('lock com change faltando hash vira incompleto', () => {
    const invalid = {
      lockVersion: 1,
      ir: EMPTY_IR,
      changes: [
        {
          id: '0001',
          title: 'test',
          path: 'changes/0001/proposal.md',
          summary: 'test',
          // hash ausente
          items: [],
        },
      ],
    };
    expect(() => parseLock(JSON.stringify(invalid), 'l.json')).toThrow(
      'l.json: lock incompleto (faltam ir ou changes); restaure-o pelo git',
    );
  });

  test('readLock propaga erro de JSON malformado', async () => {
    await writeFile(join(dir, 'broken.json'), '{');
    expect(readLock(join(dir, 'broken.json'), 'broken.json')).rejects.toThrow(
      'broken.json: lock inválido (JSON malformado); restaure-o pelo git',
    );
  });

  test('lock aceita chave nova da IR (ADR-0006 D2)', () => {
    const text = JSON.stringify({
      ...lock,
      ir: { ...EMPTY_IR, valueObjects: [{ id: 'valueobject:X' }] },
    });
    const parsed = parseLock(text, 'lock.json');
    expect(parsed.ir).toMatchObject({
      valueObjects: [{ id: 'valueobject:X' }],
    });
  });
});
