import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ResolvedConfig } from '../config';
import { markApplied, type Proposal } from './proposal';

export async function archiveProposal(
  config: ResolvedConfig,
  proposal: Proposal,
  archivedPath: string,
): Promise<void> {
  const from = join(config.outRoot, dirname(proposal.path));
  const to = join(config.outRoot, dirname(archivedPath));
  await mkdir(dirname(to), { recursive: true });
  await rename(from, to);
  await writeFile(
    join(config.outRoot, archivedPath),
    markApplied(proposal.raw),
  );
}
