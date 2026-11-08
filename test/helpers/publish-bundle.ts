import { buildManifest } from '../../src/compiler/bundle/manifest';
import { stableStringify } from '../../src/contracts/canonical';

/** The default branch head of `createFakeGitHost`: a bundle based on it has nothing to compare. */
export const BASE_REF = 'sha-base';

/** The change directory of `GOOD`, as `apply` and the sink name it. */
export const CHANGE = 'changes/0003-refund-order';

/** A bundle as `propose_change` returns it: hashed files plus bundle.json and BUNDLE.md. */
export function bundleOf(
  hashed: Record<string, string>,
  baseRef: string = BASE_REF,
) {
  const files = Object.entries(hashed).map(([path, content]) => ({
    path,
    content,
  }));
  const manifest = buildManifest(
    {
      baseRef,
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
  // The Delta's module, as the neutral model of a compiled bundle records it.
  'neutral/model.json': modelOf('shop'),
};

/** The hashed `neutral/model.json` of a bundle for `module` (only the field publish reads). */
export function modelOf(module: string): string {
  return JSON.stringify({ module });
}
