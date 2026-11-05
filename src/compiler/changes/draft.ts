import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResolvedConfig } from '../config';
import { EMPTY_IR, semanticDiff } from '../diff';
import { AgenticError, type IR } from '../ir';
import type { DomainLock } from '../lock';
import {
  nextChangeId,
  parseProposal,
  renderDraft,
  type Proposal,
} from './proposal';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function writeDraft(
  config: ResolvedConfig,
  ir: IR,
  lock: DomainLock | null,
  proposals: readonly Proposal[],
  slug: string,
): Promise<{ path: string; proposal: Proposal }> {
  if (!SLUG.test(slug))
    throw new AgenticError(
      'proposal.slug-invalid',
      `--draft-change: the slug "${slug}" must be kebab-case`,
    );
  if (proposals.some((p) => !p.archived)) {
    throw new AgenticError(
      'proposal.open-exists',
      `an open proposal already exists in ${config.changesDir}/; apply or remove it before creating another`,
    );
  }
  const required = semanticDiff(lock?.ir ?? EMPTY_IR, ir).filter(
    (item) => item.classification !== 'docs',
  );
  if (required.length === 0)
    throw new AgenticError(
      'proposal.draft-no-change',
      'there is no domain change to propose',
    );
  const id = nextChangeId(proposals);
  const pick = (kind: string): string[] =>
    required.filter((item) => item.kind === kind).map((item) => item.id);
  const raw = renderDraft({
    id,
    slug,
    delta: {
      added: pick('added'),
      modified: pick('modified'),
      removed: pick('removed'),
    },
  });
  const dirName = `${id}-${slug}`;
  const path = `${config.changesDir}/${dirName}/proposal.md`;
  await mkdir(join(config.outRoot, config.changesDir, dirName), {
    recursive: true,
  });
  await writeFile(join(config.outRoot, path), raw);
  return { path, proposal: parseProposal(raw, dirName, path, false).proposal! };
}
