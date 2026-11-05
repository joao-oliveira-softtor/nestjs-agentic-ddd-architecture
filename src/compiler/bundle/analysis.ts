import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { semanticDiff } from '../diff';
import { itemSpecification } from '../item-spec';
import { parseLock } from '../lock';
import { renderPacket } from '../packet';
import { collectStatus, stateContext } from '../project-state';
import { selectChange, waves } from '../state';

/**
 * What the bundle needs from the compiled candidate. It is produced by a child process (the only
 * place candidate modules are imported) and is plain data on the wire.
 */
export const analysisSchema = z.strictObject({
  waves: z.array(z.array(z.string())),
  items: z.array(
    z.strictObject({
      id: z.string(),
      layer: z.string(),
      state: z.string(),
      specHash: z.string(),
      packet: z.string(),
    }),
  ),
});
export type CandidateAnalysis = z.infer<typeof analysisSchema>;

/**
 * Items touched in `module` (the semantic diff from the base lock), plus the pending items they
 * depend on, in wave order, with packets. Other modules are out of the caller's scope: never listed.
 */
export async function analyzeCandidate(
  configPath: string,
  baseLockPath: string,
  module: string,
): Promise<CandidateAnalysis> {
  const base = parseLock(await readFile(baseLockPath, 'utf8'), baseLockPath);
  const context = await stateContext(configPath);
  const report = await collectStatus(context, true);
  const { ir } = context.project;
  const diff = semanticDiff(base.ir, ir).filter((d) => d.module === module);
  const ids = (added: boolean) =>
    diff.filter((d) => (d.kind === 'added') === added).map((d) => d.id);
  const { items: selected } = selectChange(report, ir, {
    id: 'bundle',
    delta: { added: ids(true), modified: ids(false), removed: [] },
  });
  const order = waves({ ...report, items: selected }).waves;
  return {
    waves: order,
    items: order.flat().map((id) => {
      const item = selected.find((i) => i.id === id)!;
      return {
        id,
        layer: item.layer,
        state: item.baseState,
        specHash: item.specHash,
        packet: renderPacket(
          item,
          itemSpecification(ir, item, context.proposals),
          configPath,
          'static',
        ),
      };
    }),
  };
}
