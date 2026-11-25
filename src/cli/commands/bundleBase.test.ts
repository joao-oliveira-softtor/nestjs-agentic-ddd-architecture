import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shopRepo } from '../../../test/helpers/shop-repo';
import { loadConfig } from '../../compiler/config';
import { bundleBaseCommand } from './bundleBase';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

describe('bundleBaseCommand', () => {
  test('writes the base config, module, rules and lock as JSON, or a coded refusal', async () => {
    const repo = await shopRepo(undefined, 'base-cmd-');
    dirs.push(repo.root);
    const scratch = await mkdtemp(join(tmpdir(), 'base-cmd-out-'));
    dirs.push(scratch);
    const config = join(repo.root, 'agentic.config.ts');
    const out = join(scratch, 'base.json');
    const run = (module: string) =>
      bundleBaseCommand(['--config', config, '--module', module, '--out', out]);

    expect(await run('shop')).toBe(0);
    const base = JSON.parse(await readFile(out, 'utf8'));
    // ResolvedConfig survives JSON: the server rebuilds the same value from the file.
    const loaded = await loadConfig(config);
    expect(JSON.parse(JSON.stringify(loaded))).toEqual(loaded);
    expect(base.config).toEqual(loaded);
    expect(base.module.name).toBe('shop');
    expect(base.lockText).toBe(
      await readFile(join(repo.root, '.agentic/domain.lock.json'), 'utf8'),
    );
    expect(Array.isArray(base.rules)).toBe(true);

    expect(await run('nope')).toBe(0);
    expect(JSON.parse(await readFile(out, 'utf8')).error.code).toBe(
      'bundle.module-unknown',
    );
  }, 60_000);

  test('exits 2 with the message and usage when an argument is missing', async () => {
    const error = spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await bundleBaseCommand(['--config', 'a.ts'])).toBe(2);
      expect(String(error.mock.calls[0]?.[0])).toStartWith(
        'missing --module\n',
      );
    } finally {
      error.mockRestore();
    }
  });
});
