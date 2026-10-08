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
