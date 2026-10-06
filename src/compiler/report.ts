import type { LintFinding } from './lint';
import { approxTokens } from './lint';
import { code, table } from './render/markdown';
import type { Rendered } from './render/index';

export function formatReport(
  rendered: Rendered,
  findings: readonly LintFinding[],
): string {
  const rows = [...rendered.files].map(([path, content]) => {
    const lines = content.endsWith('\n')
      ? content.split('\n').length - 1
      : content.split('\n').length;
    return [code(path), String(lines), String(approxTokens(content))];
  });
  const lines = [
    '# agentic-ddd — relatório',
    '',
    table(['Arquivo', 'Linhas', '≈tokens'], rows),
    '',
  ];
  if (findings.length === 0) lines.push('Lint: nenhum problema.');
  else
    for (const f of findings)
      lines.push(
        `- [${f.severity === 'error' ? 'erro' : 'aviso'}] ${f.path}: ${f.message}`,
      );
  return `${lines.join('\n')}\n`;
}
