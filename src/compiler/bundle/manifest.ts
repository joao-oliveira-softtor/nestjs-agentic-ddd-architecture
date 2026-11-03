import { canonicalize, sha256 } from '../canonical';
import type { RenderedExample } from '../delta/render';
import { shellQuote } from '../packet';

export const BUNDLE_VERSION = 1 as const;

export interface BundleFile {
  /** Bundle-relative, forward slashes. */
  readonly path: string;
  /** LF line endings. */
  readonly content: string;
}

export interface TargetItem {
  readonly id: string;
  readonly layer: string;
  readonly wave: number;
  readonly state: string;
  readonly specHash: string;
  readonly packet: string;
  readonly brief: string;
}

export interface TargetLayer {
  readonly name: 'nestjs-ts';
  /** Items of this change by wave, in the order to work them. */
  readonly waves: readonly (readonly string[])[];
  readonly items: readonly TargetItem[];
  /** Repository-relative paths of the skeleton files, as they appear under `target/skeleton/`. */
  readonly skeleton: readonly string[];
}

export interface BundleManifest {
  readonly version: typeof BUNDLE_VERSION;
  readonly baseRef: string;
  readonly baseLockHash: string;
  readonly layers: { readonly target: TargetLayer };
  /** The given/when/then examples of the new invariants, as the Delta renderer returned them. */
  readonly examples: readonly RenderedExample[];
  /** Every file of the bundle except `BUNDLE.md` and `bundle.json`, which are derived from these. */
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
  /** sha256 of the canonical JSON of this manifest without this field. */
  readonly hash: string;
}

const byPath = (a: { path: string }, b: { path: string }): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

export const toLf = (s: string): string => s.replaceAll('\r\n', '\n');

/** Hashes everything but the hash itself: sorted keys, no whitespace, files by path, LF content. */
export function buildManifest(
  input: Omit<BundleManifest, 'files' | 'hash' | 'version'>,
  files: readonly BundleFile[],
): BundleManifest {
  const body = {
    version: BUNDLE_VERSION,
    ...input,
    files: [...files]
      .sort(byPath)
      .map((f) => ({ path: f.path, sha256: sha256(f.content) })),
  };
  return { ...body, hash: sha256(JSON.stringify(canonicalize(body))) };
}

export function renderBundleMd(m: BundleManifest): string {
  const { waves, items } = m.layers.target;
  const byId = new Map(items.map((i) => [i.id, i]));
  return [
    '# Compiled bundle',
    '',
    "A skeleton, per-item packets and the module skill for one proposed change, compiled against a base commit. Reply to the user in the user's language; never translate identifiers, invariant ids or business text.",
    '',
    `- Bundle version: ${m.version}`,
    `- Base ref: \`${m.baseRef}\``,
    `- Base lock hash: \`${m.baseLockHash}\``,
    `- Bundle hash: \`${m.hash}\``,
    '',
    '## Apply the bundle',
    '',
    'Run from the base checkout, at the base ref above. It refuses on a base mismatch, writes the skeleton and runs `compile`.',
    '',
    '```bash',
    'bun run agentic apply <path-to-this-bundle>',
    '```',
    '',
    '## Items in wave order',
    '',
    'Finish every item of a wave before the next. A task is complete only when `verify` returns `done`. The reviewer brief is not bundled: it is generated at review time from the diff and the gate results (`bun run agent-briefs` or orchestrate).',
    ...waves.flatMap((wave, i) => [
      '',
      `### Wave ${i + 1}`,
      ...wave.flatMap((id) => {
        const item = byId.get(id)!;
        return [
          '',
          `- \`${id}\` (${item.layer}), executor brief: \`${item.brief}\``,
          '  ```bash',
          `  bun run agentic packet ${shellQuote(id)}`,
          `  bun run agentic verify --item ${shellQuote(id)} --spec-hash ${item.specHash}`,
          '  ```',
        ];
      }),
    ]),
    '',
  ].join('\n');
}
