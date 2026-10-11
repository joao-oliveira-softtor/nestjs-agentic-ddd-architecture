import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const ALLOWED =
  /^(?:package\.json|README\.md|LICENSE|CHANGELOG\.md|docs\/distribution\.md|bin\/agentic-ddd\.js|dist\/(?:core|decorators|compiler|contracts|runtime|nestjs|testing|cli)\/[a-zA-Z0-9_./-]+\.(?:js|d\.ts)(?:\.map)?)$/;
const INTERNAL =
  /(?:^|\/)(?:node_modules|__fixtures__|__snapshots__|test|tests)(?:\/|$)|\.(?:test|spec)\./;
const SECRETS =
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|npm_[A-Za-z0-9]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,})\b/;
const LOCAL_PATH =
  /(?:\/|\\)(?:workspace|Users|home|root|tmp)(?:\/|\\)|[A-Za-z]:\\(?:Users|workspace)\\/;

export function auditFile(path: string, content: string): string[] {
  const problems: string[] = [];
  if (!ALLOWED.test(path) || INTERNAL.test(path) || path.includes('..'))
    problems.push(`Unexpected distributed file: ${path}`);
  if (SECRETS.test(content)) problems.push(`Possible credential in ${path}`);
  if (LOCAL_PATH.test(content)) problems.push(`Absolute local path in ${path}`);
  if (path.endsWith('.map')) {
    try {
      const map = JSON.parse(content) as {
        sources?: string[];
        sourceRoot?: string;
      };
      if (
        map.sourceRoot ||
        map.sources?.some(
          (s) => isAbsolute(s) || /^[A-Za-z]:[\\/]|^file:/.test(s),
        )
      )
        problems.push(`Non-relative source map in ${path}`);
    } catch {
      problems.push(`Invalid source map in ${path}`);
    }
  }
  return problems;
}

export async function auditDirectory(
  root: string,
  paths: readonly string[],
): Promise<void> {
  const problems: string[] = [];
  for (const path of paths)
    problems.push(
      ...auditFile(path, await readFile(resolve(root, path), 'utf8')),
    );
  if (problems.length) throw new Error(problems.join('\n'));
}
