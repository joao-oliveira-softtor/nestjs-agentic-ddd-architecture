import type { Rendered } from './render/index.js';

export interface LintFinding {
  readonly path: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;

export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function lintSkill(path: string, content: string): LintFinding[] {
  const findings: LintFinding[] = [];
  const add = (severity: LintFinding['severity'], message: string): void => {
    findings.push({ path, severity, message });
  };

  const match = FRONTMATTER.exec(content);
  if (!match) {
    add('error', 'frontmatter YAML ausente');
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
    add('error', 'description não é uma string válida');
  }
  const dirName = path.split('/').at(-2) ?? '';

  if (!NAME.test(name) || name.length > 64)
    add(
      'error',
      `name "${name}" fora do padrão (a-z, 0-9 e hífens simples; até 64)`,
    );
  else if (name !== dirName)
    add('error', `name "${name}" difere da pasta "${dirName}"`);
  if (description.length === 0 || description.length > 1024) {
    add(
      'error',
      `description com ${description.length} caracteres (precisa de 1 a 1024)`,
    );
  }
  const lines = content.split('\n').length;
  if (lines > 500) add('error', `SKILL.md com ${lines} linhas (máximo 500)`);
  for (const link of content.matchAll(/\]\((references\/[^)]+)\)/g)) {
    if (link[1]!.split('/').length > 2)
      add('error', `referência ${link[1]} passa de um nível de profundidade`);
  }
  const metaTokens = approxTokens(`${name} ${description}`);
  if (metaTokens > 100)
    add('warning', `metadados com ~${metaTokens} tokens (orçamento ~100)`);
  const bodyTokens = approxTokens(body);
  if (bodyTokens > 5000)
    add('warning', `corpo com ~${bodyTokens} tokens (orçamento < 5000)`);
  return findings;
}

export function lintRendered(rendered: Rendered): LintFinding[] {
  return [...rendered.files]
    .filter(([path]) => path.endsWith('/SKILL.md'))
    .flatMap(([path, content]) => lintSkill(path, content));
}
