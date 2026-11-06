import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shopRepo } from '../../../test/helpers/shop-repo';
import { analyzeCandidate } from './analysis';

let repo: Awaited<ReturnType<typeof shopRepo>>;
let scratch: string;
beforeAll(async () => {
  repo = await shopRepo(undefined, 'analysis-');
  scratch = await mkdtemp(join(tmpdir(), 'analysis-base-'));
}, 60_000);
afterAll(async () => {
  await rm(repo.root, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
});

/** The committed shop lock minus the elements named, as the lock of an earlier commit. */
async function baseLockWithout(
  ...collections: ('entities' | 'useCases')[]
): Promise<string> {
  const lock = JSON.parse(
    await readFile(join(repo.root, '.agentic/domain.lock.json'), 'utf8'),
  );
  for (const collection of collections) lock.ir[collection] = [];
  const path = join(scratch, `base-${collections.join('-')}.json`);
  await writeFile(path, JSON.stringify(lock));
  return path;
}

describe('analyzeCandidate on the shop project', () => {
  test('lists nothing when the candidate equals the base', async () => {
    const analysis = await analyzeCandidate(
      join(repo.root, 'agentic.config.ts'),
      await baseLockWithout(),
      'shop',
    );
    expect(analysis).toEqual({ waves: [], items: [] });
  }, 60_000);

  test('lists each added element once, in wave order, with its own layer and packet', async () => {
    const analysis = await analyzeCandidate(
      join(repo.root, 'agentic.config.ts'),
      await baseLockWithout('entities', 'useCases'),
      'shop',
    );
    expect(analysis.items.map((i) => i.id)).toEqual(analysis.waves.flat());
    const byId = new Map(analysis.items.map((i) => [i.id, i]));
    expect([...byId.keys()].sort()).toEqual([
      'entity:Order',
      'method:Order.pay',
      'usecase:pay_order',
    ]);
    expect(new Set(analysis.items.map((i) => i.layer)).size).toBeGreaterThan(1);
    for (const item of analysis.items) {
      expect(item.packet).toContain(item.id);
      expect(item.specHash).toMatch(/^[0-9a-f]{64}$/);
    }
  }, 60_000);

  test('lists nothing of a module other than the one asked for, even when its lock drifted', async () => {
    const analysis = await analyzeCandidate(
      join(repo.root, 'agentic.config.ts'),
      await baseLockWithout('entities', 'useCases'),
      'billing',
    );
    expect(analysis).toEqual({ waves: [], items: [] });
  }, 60_000);
});
