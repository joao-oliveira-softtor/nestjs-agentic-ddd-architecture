import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EMPTY_IR } from '../../compiler/diff';
import { serializeLock } from '../../compiler/lock';
import { parsePublishedLock } from '../../compiler/published';
import { writeSnapshot } from '../../compiler/snapshot';
import { publishLockCommand } from './publishLock';
import { DEFAULT_CONVENTIONS } from '../../compiler/conventions';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agentic-publish-lock-'));
  await mkdir(join(dir, '.agentic'), { recursive: true });
  await writeFile(
    join(dir, '.agentic/domain.lock.json'),
    serializeLock({ lockVersion: 1, ir: EMPTY_IR, changes: [] }),
  );
  await writeFile(join(dir, 'agentic.config.ts'), 'config\n');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const snapshot = () =>
  writeSnapshot(dir, {
    root: '.',
    config: 'agentic.config.ts',
    lock: '.agentic/domain.lock.json',
    rulesDir: '.ai/rules',
    conventions: DEFAULT_CONVENTIONS,
    rules: [],
    modules: [],
  });

describe('publishLockCommand', () => {
  test('writes a verifiable published lock and prints its digest', async () => {
    await snapshot();
    const out = spyOn(console, 'log').mockImplementation(() => {});
    const target = join(dir, 'nested', 'out', 'lock.json');
    const code = await publishLockCommand([
      '--version',
      'v1',
      '--out',
      target,
      '--root',
      dir,
    ]);
    const printed = out.mock.calls.flat().join('\n');
    out.mockRestore();
    expect(code).toBe(0);
    const published = parsePublishedLock(
      await readFile(target, 'utf8'),
      'lock.json',
    );
    expect(published.version).toBe('v1');
    expect(printed).toBe(`published lock v1 digest ${published.digest}`);
  });

  test('a stale snapshot is refused and nothing is written', async () => {
    await snapshot();
    await writeFile(join(dir, 'agentic.config.ts'), 'edited\n');
    const err = spyOn(console, 'error').mockImplementation(() => {});
    const target = join(dir, 'out.json');
    const code = await publishLockCommand([
      '--version',
      'v1',
      '--out',
      target,
      '--root',
      dir,
    ]);
    const messages = err.mock.calls.flat().join('\n');
    err.mockRestore();
    expect(code).toBe(1);
    expect(messages).toContain('[snapshot.stale]');
    expect(await Bun.file(target).exists()).toBe(false);
  });

  test('a missing snapshot is refused', async () => {
    const err = spyOn(console, 'error').mockImplementation(() => {});
    const code = await publishLockCommand([
      '--version',
      'v1',
      '--out',
      join(dir, 'out.json'),
      '--root',
      dir,
    ]);
    const messages = err.mock.calls.flat().join('\n');
    err.mockRestore();
    expect(code).toBe(1);
    expect(messages).toContain('[snapshot.missing]');
  });

  test('--version and --out are required (exit 2)', async () => {
    const err = spyOn(console, 'error').mockImplementation(() => {});
    expect(await publishLockCommand(['--out', join(dir, 'o.json')])).toBe(2);
    expect(await publishLockCommand(['--version', 'v1'])).toBe(2);
    err.mockRestore();
  });
});
