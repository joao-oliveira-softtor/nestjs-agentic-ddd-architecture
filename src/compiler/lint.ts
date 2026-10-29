import type { ErrorCode } from './ir';
import type { Rendered } from './render/index';

export interface LintFinding {
  readonly path: string;
  readonly severity: 'error' | 'warning';
  readonly code: ErrorCode;
  readonly message: string;
}

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;

export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function lintSkill(path: string, content: string): LintFinding[] {
  const findings: LintFinding[] = [];
  const add = (
    severity: LintFinding['severity'],
    code: ErrorCode,
    message: string,
  ): void => {
    findings.push({ path, severity, code, message });
  };

  const match = FRONTMATTER.exec(content);
  if (!match) {
    add('error', 'lint.frontmatter-missing', 'YAML frontmatter missing');
    return findings;
  }
  const header = match[1]!;
  const body = content.slice(match[0].length);
  const name = /^name: (.*)$/m.exec(header)?.[1] ?? '';
  const rawDescription = /^description: (.*)$/m.exec(header)?.[1] ?? '""';
  let description = '';
  try {
    description = String(JSON.parse(rawDescription));
  } catch {
    add(
      'error',
      'lint.description-invalid',
      'description is not a valid string',
    );
  }
  const dirName = path.split('/').at(-2) ?? '';

  if (!NAME.test(name) || name.length > 64)
    add(
      'error',
      'lint.name-invalid',
      `name "${name}" does not match the pattern (a-z, 0-9 and single hyphens; up to 64)`,
    );
  else if (name !== dirName)
    add(
      'error',
      'lint.name-mismatch',
      `name "${name}" differs from the folder "${dirName}"`,
    );
  if (description.length === 0 || description.length > 1024) {
    add(
      'error',
      'lint.description-length',
      `description has ${description.length} characters (needs 1 to 1024)`,
    );
  }
  const lines = content.endsWith('\n')
    ? content.split('\n').length - 1
    : content.split('\n').length;
  if (lines > 500)
    add(
      'error',
      'lint.skill-too-long',
      `SKILL.md has ${lines} lines (maximum 500)`,
    );
  for (const link of content.matchAll(/\]\((references\/[^)]+)\)/g)) {
    if (link[1]!.split('/').length > 2)
      add(
        'error',
        'lint.reference-too-deep',
        `reference ${link[1]} goes deeper than one level`,
      );
  }
  const metaTokens = approxTokens(`${name} ${description}`);
  if (metaTokens > 100)
    add(
      'warning',
      'lint.metadata-tokens',
      `metadata is ~${metaTokens} tokens (budget ~100)`,
    );
  const bodyTokens = approxTokens(body);
  if (bodyTokens > 5000)
    add(
      'warning',
      'lint.body-tokens',
      `body is ~${bodyTokens} tokens (budget < 5000)`,
    );
  return findings;
}

export function lintRendered(rendered: Rendered): LintFinding[] {
  return [...rendered.files]
    .filter(([path]) => path.endsWith('/SKILL.md'))
    .flatMap(([path, content]) => lintSkill(path, content));
}
