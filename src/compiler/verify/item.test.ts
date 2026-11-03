import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { verifyItem } from './item';

const ROOT = resolve(import.meta.dir, '../../..');

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('verifyItem kills the concurrent typecheck child when the item is not found', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentic-item-'));
  try {
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
    // The fake typecheck records its pid, then hangs until it is killed.
    const pidFile = join(dir, 'typecheck.pid');
    await writeFile(
      join(dir, 'hang.ts'),
      `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setInterval(() => {}, 1000);`,
    );
    await writeFile(
      join(dir, 'agentic.config.ts'),
      `export default { modules: [{ name: 'app', path: 'app' }], verify: { test: ['bun', 'test', 'app.test.ts'], commands: { typecheck: ['bun', 'hang.ts'] } } };`,
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
      `import { test } from 'bun:test';
test('noop', () => {});`,
    );
    const failure = await verifyItem({
      configPath: join(dir, 'agentic.config.ts'),
      item: 'entity:Missing',
      specHash: 'x',
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'state.item-not-found' });
    const pid = Number(await Bun.file(pidFile).text());
    // exit is asynchronous after kill
    for (let i = 0; i < 50 && alive(pid); i++) await Bun.sleep(100);
    expect(alive(pid)).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
