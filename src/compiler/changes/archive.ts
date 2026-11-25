import { access, mkdir, rename, writeFile } from 'node:fs/promises';
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
  // Already moved by an earlier, interrupted run: only the applied file may be missing.
  await rename(from, to).catch(async (error) => {
    if (
      (error as { code?: string }).code !== 'ENOENT' ||
      !(await access(to).then(
        () => true,
        () => false,
      ))
    )
      throw error;
  });
  await writeFile(
    join(config.outRoot, archivedPath),
    markApplied(proposal.raw),
  );
}
