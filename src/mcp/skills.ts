import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModuleAccess } from '../auth/scopes';
import {
  FRONTMATTER,
  parseFrontmatterData,
} from '../compiler/changes/proposal';
import type { ResolvedConventions } from '../compiler/conventions';
import { irHash } from '../compiler/ir';
import type { DomainLock } from '../compiler/lock';
import { renderDevSkill } from '../compiler/render/dev-skill';
import { AgenticError } from '../compiler/ir';
import type { Rule } from '../compiler/rules';
import { narrowRuleGlobs, scopeLock } from './scope';

export interface SkillDoc {
  readonly uri: string;
  readonly title: string;
  readonly purpose: string;
  readonly content: string;
}

export interface AuthoringDoc {
  readonly path: string;
  readonly content: string;
}

const AUTHORING = 'agentic-ddd';
export const LANGUAGE_RULE =
  "Reply to the user in the user's language. Never translate identifiers, invariant ids or business text.";
const PURPOSE_MAX = 160;

/** `SKILL.md` and `references/*.md` of the authoring skill directory (never `assets/`), sorted by path. */
export async function loadAuthoringDocs(dir: string): Promise<AuthoringDoc[]> {
  try {
    const paths = ['SKILL.md'];
    for (const name of await readdir(join(dir, 'references')))
      if (name.endsWith('.md')) paths.push(`references/${name}`);
    paths.sort();
    return await Promise.all(
      paths.map(async (path) => ({
        path,
        content: await Bun.file(join(dir, path)).text(),
      })),
    );
  } catch (error) {
    // A bundled app may not ship the skill. The message carries no path: it can reach a remote client.
    if ((error as { code?: string }).code === 'ENOENT')
      throw new AgenticError(
        'mcp.skills-unavailable',
        'the authoring skill is not available on this server',
      );
    throw error;
  }
}

/** `loadAuthoringDocs` once, on first use: the skill comes from the installed package and does not change. `null` when it is not shipped. */
export function authoringLoader(
  dir: string,
): () => Promise<AuthoringDoc[] | null> {
  let loaded: Promise<AuthoringDoc[] | null> | undefined;
  return () =>
    (loaded ??= loadAuthoringDocs(dir).catch((error) => {
      if (
        error instanceof AgenticError &&
        error.code === 'mcp.skills-unavailable'
      )
        return null;
      throw error;
    }));
}

function describeDoc(
  path: string,
  content: string,
): { title: string; purpose: string } {
  const text = content.replaceAll('\r\n', '\n');
  const match = FRONTMATTER.exec(text);
  let data: Record<string, unknown> = {};
  if (match)
    try {
      data = parseFrontmatterData(match[1]!);
    } catch {
      // Malformed frontmatter: fall back to the body.
    }
  const body = match ? match[2]! : text;
  const heading = /^#{1,6}\s+(.+)$/m.exec(body)?.[1]?.trim();
  const title = heading ?? (typeof data.name === 'string' ? data.name : path);
  const paragraph =
    body
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .find((p) => p !== '' && !p.startsWith('#') && !p.startsWith('<!--')) ??
    '';
  const purpose =
    path === 'SKILL.md' && typeof data.description === 'string'
      ? data.description
      : paragraph;
  return {
    title,
    purpose: purpose.replace(/\s+/g, ' ').trim().slice(0, PURPOSE_MAX),
  };
}

const doc = (uri: string, path: string, content: string): SkillDoc => ({
  uri,
  ...describeDoc(path, content),
  content,
});

/** The authoring skill's documents: they never depend on the domain, so a missing snapshot does not hide them. */
export function authoringCatalogue(
  authoring: readonly AuthoringDoc[],
): SkillDoc[] {
  return authoring.map((a) =>
    doc(`skill://${AUTHORING}/${a.path}`, a.path, a.content),
  );
}

/**
 * Every document `skillAccess` may read: the authoring skill, the dev skill of each readable module
 * (rendered from the scoped IR, so it equals the generated one for `'all'`) and the team rules.
 */
export function catalogue(input: {
  authoring: readonly AuthoringDoc[];
  fullLock: DomainLock;
  rules: readonly Rule[];
  skillAccess: ModuleAccess;
  conventions: ResolvedConventions;
}): SkillDoc[] {
  const { authoring, fullLock, rules, skillAccess, conventions } = input;
  if (skillAccess !== 'all' && skillAccess.size === 0) return [];
  const scoped = scopeLock(fullLock, skillAccess);
  const docs = authoringCatalogue(authoring);

  // Only rules with a file are team rules; a scoped token sees their globs cut to those naming no hidden module.
  const visible = narrowRuleGlobs(
    rules.filter((r) => r.file !== null),
    fullLock,
    skillAccess,
  );

  const hash = irHash(fullLock.ir);
  for (const module of scoped.ir.modules) {
    const files = renderDevSkill(scoped.ir, module, hash, {
      history: scoped.changes,
      rules: visible,
      conventions,
    });
    for (const [path, content] of files)
      if (path.endsWith('.md'))
        docs.push(doc(`skill://${module.name}-dev/${path}`, path, content));
  }

  // The key is a file path (spaces, accents): encode it so the URI equals the `href` the SDK hands the resource callback.
  for (const rule of visible)
    docs.push(
      doc(
        `skill://${AUTHORING}/rules/${rule.key.split('/').map(encodeURIComponent).join('/')}.md`,
        `rules/${rule.key}.md`,
        `# Rule ${rule.key}

Applies to: ${rule.paths === null ? 'all files' : rule.paths.join(', ')}

${rule.body}
`,
      ),
    );
  return docs;
}

/** A full URI or a short name (`SKILL.md`, `authoring`, `orders-dev`); undefined when unknown or ambiguous. */
export function findDoc(
  docs: readonly SkillDoc[],
  ref: string,
): SkillDoc | undefined {
  // The bare `SKILL.md` would match every dev skill too: it means the authoring skill.
  const exact = docs.find(
    (d) =>
      d.uri === (ref === 'SKILL.md' ? `skill://${AUTHORING}/SKILL.md` : ref),
  );
  if (exact) return exact;
  // Bare `SKILL.md` is the authoring skill only: never a lone dev skill when that one is absent.
  if (ref === 'SKILL.md') return undefined;
  const matches = docs.filter((d) => {
    const [skill, ...rest] = d.uri.slice('skill://'.length).split('/');
    const path = rest.join('/');
    return (
      (rest.join('/') === 'SKILL.md' && skill === ref) ||
      path === ref ||
      path === `${ref}.md` ||
      path === `references/${ref}` ||
      path === `references/${ref}.md`
    );
  });
  return matches.length === 1 ? matches[0] : undefined;
}

const cell = (text: string) => text.replace(/\s+/g, ' ').replaceAll('|', '\\|');

/** Markdown index of `docs`: what to read and in which order. */
export function index(
  docs: readonly SkillDoc[],
  authoringAvailable = true,
  notice?: string,
): string {
  const rows = docs.map(
    (d) =>
      `| ${d.uri} | ${cell(d.title)} | ${cell(d.purpose)} | ${Buffer.byteLength(d.content)} |`,
  );
  return [
    '# agentic-ddd authoring guide',
    '',
    authoringAvailable
      ? 'This is the authoring skill of the agentic-ddd framework: how to declare a domain and write a change proposal. Read it before any proposal.'
      : 'The authoring skill is unavailable on this server: only the dev skills and team rules below are served.',
    '',
    LANGUAGE_RULE,
    '',
    ...(notice ? [notice, ''] : []),
    authoringAvailable
      ? 'Read order: `SKILL.md` (the authoring skill; a dev skill is its `<module>-dev` name), then `references/authoring.md`, then the dev skill (`<module>-dev`) of the module being changed.'
      : 'Read the dev skill (`<module>-dev`) of the module being changed.',
    '',
    '| uri | title | purpose | bytes |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}
