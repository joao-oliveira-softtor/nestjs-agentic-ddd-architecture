import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dir, '../..');

const DINHEIRO = (
  body: string,
) => `import { ValueObject, notImplemented } from '@agentic-ddd/core';
import { AgentValueObject, Invariant } from '@agentic-ddd/decorators';
@AgentValueObject({ description: 'Valor monetário em centavos.' })
@Invariant({ id: 'nao-negativo', text: 'Dinheiro não é negativo.' })
export class Dinheiro extends ValueObject<{ valor: number }> {
  static de(centavos: number): Dinheiro { ${body} }
}`;

const QUANTIDADE = `import { ValueObject } from '@agentic-ddd/core';
import { AgentValueObject } from '@agentic-ddd/decorators';
@AgentValueObject({ description: 'Quantidade de itens.' })
export class Quantidade extends ValueObject<{ valor: number }> {
  static de(n: number): Quantidade { return new Quantidade({ valor: n }); }
}`;

const TESTS = (invariant: boolean) => `import { test, expect } from 'bun:test';
import { covers } from '@agentic-ddd/testing';
import { Dinheiro } from './app/dinheiro';
import { Quantidade } from './app/quantidade';
test(covers([${invariant ? "'valueobject:Dinheiro', 'invariant:Dinheiro/nao-negativo'" : "'valueobject:Dinheiro'"}], 'dinheiro'), () => expect(Dinheiro.de(1)).toBeInstanceOf(Dinheiro));
test(covers(['valueobject:Quantidade'], 'quantidade'), () => expect(Quantidade.de(1)).toBeInstanceOf(Quantidade));`;

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'agentic-vo-'));
  await mkdir(join(dir, 'app'));
  await writeFile(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        paths: {
          '@agentic-ddd/*': [join(ROOT, 'src/*/index.ts')],
          zod: [join(ROOT, 'node_modules/zod')],
        },
      },
    }),
  );
  await writeFile(
    join(dir, 'agentic.config.ts'),
    `export default { modules: [{ name: 'app', path: 'app' }], verify: { test: ['bun', 'test', 'app.test.ts'], commands: { typecheck: ['bun', '-e', 'process.exit(0)'] } } };`,
  );
  await writeFile(
    join(dir, 'app/dinheiro.ts'),
    DINHEIRO('return new Dinheiro({ valor: centavos });'),
  );
  await writeFile(join(dir, 'app/quantidade.ts'), QUANTIDADE);
  await writeFile(join(dir, 'app.test.ts'), TESTS(true));
  const run = (...args: string[]) => {
    const result = Bun.spawnSync(
      [
        'bun',
        join(ROOT, 'src/cli/main.ts'),
        ...args,
        '--config',
        join(dir, 'agentic.config.ts'),
      ],
      { cwd: dir, stdout: 'pipe', stderr: 'pipe' },
    );
    return {
      code: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  };
  const hashOf = (item: string) =>
    /specHash: `([a-f0-9]{64})`/.exec(run('packet', item).stdout)![1]!;
  return { dir, run, hashOf };
}

test('value objects: packet, verify done with covers, missing covers and skeleton', async () => {
  const { dir, run, hashOf } = await fixture();
  try {
    const packet = run('packet', 'valueobject:Dinheiro');
    expect(packet.code).toBe(0);
    expect(packet.stdout).toContain('valueobject:Dinheiro');
    expect(packet.stdout).toContain('invariant:Dinheiro/nao-negativo');
    expect(packet.stdout).toContain('Dinheiro não é negativo.');

    const hash = hashOf('valueobject:Dinheiro');
    const ok = run(
      'verify',
      '--item',
      'valueobject:Dinheiro',
      '--spec-hash',
      hash,
      '--json',
    );

    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.stdout).status).toBe('done');

    const qHash = hashOf('valueobject:Quantidade');
    const q = run(
      'verify',
      '--item',
      'valueobject:Quantidade',
      '--spec-hash',
      qHash,
      '--json',
    );
    expect(q.code).toBe(0);
    expect(JSON.parse(q.stdout).status).toBe('done');

    await writeFile(join(dir, 'app.test.ts'), TESTS(false));
    const missing = run(
      'verify',
      '--item',
      'valueobject:Dinheiro',
      '--spec-hash',
      hash,
      '--json',
    );
    expect(missing.code).not.toBe(0);
    expect(missing.stdout).toContain('invariant:Dinheiro/nao-negativo');

    await writeFile(
      join(dir, 'app/dinheiro.ts'),
      DINHEIRO('return notImplemented();'),
    );
    const status = run('status', '--static', '--json');
    expect(status.code).toBe(0);
    const item = JSON.parse(status.stdout).items.find(
      (i: { id: string }) => i.id === 'valueobject:Dinheiro',
    );
    expect(item.state).toBe('declared');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
