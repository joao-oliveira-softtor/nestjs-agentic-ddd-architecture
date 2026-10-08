import { expect, test } from 'bun:test';
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  readFile,
  readdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dir, '../..');
export async function queryFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'agentic-state-'));
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
    join(dir, 'app/thing.ts'),
    `import { AgentEntity, AgentMethod } from '@agentic-ddd/decorators';
@AgentEntity({ description: 'Thing.' })
export class Thing {
 @AgentMethod({ description: 'Creates Thing.' })
 static create() { return new Thing(); }
}`,
  );
  await writeFile(
    join(dir, 'app.test.ts'),
    `import { test, expect } from 'bun:test';
import { covers } from '@agentic-ddd/testing';
import { Thing } from './app/thing';
import { appendFileSync } from 'node:fs';
appendFileSync('runs', '1');
test(covers(['method:Thing.create'], 'creates'), () => expect(Thing.create()).toBeInstanceOf(Thing));`,
  );
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
  return { dir, run };
}

test('status static não executa testes; consultas dinâmicas coletam uma vez sem gerar arquivos', async () => {
  const { dir, run } = await queryFixture();
  try {
    const before = await readdir(dir);
    const staticResult = run('status', '--static', '--json');
    expect(staticResult.code).toBe(0);
    expect(JSON.parse(staticResult.stdout).items[0].state).toBe('covered');
    expect(await readdir(dir)).toEqual(before);
    const result = run('status', '--json');
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).items[0].state).toBe('done');
    expect(await readFile(join(dir, 'runs'), 'utf8')).toBe('1');
    const next = run('next', '--json');
    expect(next.code).toBe(0);
    expect(JSON.parse(next.stdout).waves).toEqual([]);
    expect(await readFile(join(dir, 'runs'), 'utf8')).toBe('11');
    expect((await readdir(dir)).sort()).toEqual([...before, 'runs'].sort());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('novos comandos rejeitam uso inválido com 2', async () => {
  const { dir, run } = await queryFixture();
  try {
    expect(run('status', '--change', 'abc').code).toBe(2);
    expect(run('next', '--static').code).toBe(2);
    expect(run('status', 'extra').code).toBe(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('packet e verify item: hash, corpo, cobertura e typecheck; falha não relacionada é ignorada', async () => {
  const { dir, run } = await queryFixture();
  try {
    const packet = run('packet', 'entity:Thing');
    expect(packet.code).toBe(0);
    const hash = /specHash: `([a-f0-9]{64})`/.exec(packet.stdout)![1]!;
    const passingTests = await readFile(join(dir, 'app.test.ts'), 'utf8');
    expect(
      run('verify', '--item', 'entity:Thing', '--spec-hash', hash, '--json')
        .code,
    ).toBe(0);
    const wrong = run(
      'verify',
      '--item',
      'entity:Thing',
      '--spec-hash',
      '0'.repeat(64),
      '--json',
    );
    expect(wrong.code).toBe(1);
    expect(
      JSON.parse(wrong.stdout).gates.find((g: { id: string }) => g.id === 'I3')
        .status,
    ).toBe('failed');
    await writeFile(
      join(dir, 'app.test.ts'),
      (await readFile(join(dir, 'app.test.ts'), 'utf8')) +
        `\ntest('unrelated failure', () => expect(1).toBe(2));`,
    );
    expect(
      run('verify', '--item', 'entity:Thing', '--spec-hash', hash, '--json')
        .code,
    ).toBe(0);
    const original = await readFile(join(dir, 'app/thing.ts'), 'utf8');
    await writeFile(
      join(dir, 'app/thing.ts'),
      `import { notImplemented } from '@agentic-ddd/core';\n` +
        original.replace('return new Thing();', 'return notImplemented();'),
    );
    expect(
      run('verify', '--item', 'entity:Thing', '--spec-hash', hash, '--json')
        .code,
    ).toBe(1);
    await writeFile(join(dir, 'app/thing.ts'), original);
    await writeFile(
      join(dir, 'app.test.ts'),
      `import { test } from 'bun:test'; test('no coverage', () => {});`,
    );
    expect(
      run('verify', '--item', 'entity:Thing', '--spec-hash', hash, '--json')
        .code,
    ).toBe(1);
    const config = await readFile(join(dir, 'agentic.config.ts'), 'utf8');
    await writeFile(join(dir, 'app.test.ts'), passingTests);
    await writeFile(
      join(dir, 'agentic.config.ts'),
      config.replace('process.exit(0)', 'process.exit(1)'),
    );
    const typecheck = run(
      'verify',
      '--item',
      'entity:Thing',
      '--spec-hash',
      hash,
      '--json',
    );
    expect(typecheck.code).toBe(1);
    const typecheckReport = JSON.parse(typecheck.stdout);
    expect(
      typecheckReport.gates
        .filter((g: { status: string }) => g.status === 'failed')
        .map((g: { id: string }) => g.id),
    ).toEqual(['I5']);
    expect(run('verify', '--item', 'entity:Thing').code).toBe(2);
    expect(
      run('verify', '--item', 'entity:Thing', '--spec-hash', 'no').code,
    ).toBe(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('status e verifyItem recusam JUnit parcial por erro de coleta', async () => {
  const { dir, run } = await queryFixture();
  try {
    const hash = /specHash: `([a-f0-9]{64})`/.exec(
      run('packet', 'entity:Thing').stdout,
    )![1]!;
    const config = await readFile(join(dir, 'agentic.config.ts'), 'utf8');
    await writeFile(
      join(dir, 'agentic.config.ts'),
      config.replace("'bun', 'test', 'app.test.ts'", "'bun', 'test'"),
    );
    await writeFile(
      join(dir, 'broken.test.ts'),
      `throw Error('collection failed');`,
    );
    for (const args of [
      ['status', '--json'],
      ['verify', '--item', 'entity:Thing', '--spec-hash', hash, '--json'],
    ]) {
      const result = run(...args);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('JUnit');
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
