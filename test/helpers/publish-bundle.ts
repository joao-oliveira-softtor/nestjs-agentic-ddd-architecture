import { buildManifest } from '../../src/compiler/bundle/manifest';
import { stableStringify } from '../../src/contracts/canonical';

/** The change directory of `GOOD`, as `apply` and the sink name it. */
export const CHANGE = 'changes/0003-refund-order';

/** A bundle as `propose_change` returns it: hashed files plus bundle.json and BUNDLE.md. */
export function bundleOf(hashed: Record<string, string>) {
  const files = Object.entries(hashed).map(([path, content]) => ({
    path,
    content,
  }));
  const manifest = buildManifest(
    {
      baseRef: 'abc123',
      baseLockHash: 'lock123',
      layers: {} as never,
      examples: [],
    },
    files,
  );
  return {
    manifest,
    hash: manifest.hash,
    files: [
      ...files,
      { path: 'bundle.json', content: stableStringify(manifest) },
      { path: 'BUNDLE.md', content: '# Compiled bundle\n' },
    ],
  };
}

export const GOOD = {
  'target/skeleton/src/shop/domain/refund.ts': 'export class Refund {}\n',
  [`target/${CHANGE}/proposal.md`]: '# proposal\n',
  // Never published: only what `apply` would write goes into the branch.
  'target/packets/refund.md': 'packet\n',
  'neutral/README.md': 'neutral\n',
};
