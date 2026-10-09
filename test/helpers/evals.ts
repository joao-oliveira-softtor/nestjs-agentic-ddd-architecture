import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareSource, disposeSource } from '../../scripts/evals/isolation';
import type {
  PreparedSource,
  RunManifest,
} from '../../scripts/evals/contracts';

export const evalManifest: RunManifest = {
  schemaVersion: 1,
  sourceRef: 'HEAD',
  skillDatasets: [
    {
      path: 'evals/skills/orders.yaml',
      contextRoots: {
        dev: ['AGENTS.md', '.agents/skills/orders-dev'],
        runtime: ['.agentic/runtime/order-operator'],
      },
    },
  ],
  benchmark: 'tasks',
  configurations: [
    {
      id: 'scripted',
      adapter: 'scripted',
      model: 'offline-fixture',
      parameters: {},
    },
  ],
  budget: {
    maxInvocations: 30,
    skillTimeoutMs: 2000,
    implementationTimeoutMs: 10000,
    totalTimeoutMs: 60000,
    maxCorrectionsPerItem: 1,
    repetitions: 1,
    concurrency: 1,
  },
};
export async function frozenSource(): Promise<{
  source: PreparedSource;
  cleanup(): Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), 'eval-fixture-'));
  const repository = resolve(import.meta.dir, '../..');
  const cloned = Bun.spawnSync([
    'git',
    'clone',
    '--quiet',
    '--shared',
    repository,
    join(root, 'origin'),
  ]);
  if (cloned.exitCode !== 0) throw Error(cloned.stderr.toString());
  await symlink(
    join(repository, 'node_modules'),
    join(root, 'origin/node_modules'),
    'dir',
  );
  const source = await prepareSource(join(root, 'origin'), 'HEAD');
  return {
    source,
    async cleanup() {
      await disposeSource(source);
      await rm(root, { recursive: true, force: true });
    },
  };
}
