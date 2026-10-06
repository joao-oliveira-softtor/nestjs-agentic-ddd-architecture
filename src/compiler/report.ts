import type { LintFinding } from './lint.js';
import { approxTokens } from './lint.js';
import { code, table } from './render/markdown.js';
import type { Rendered } from './render/index.js';

export function formatReport(
  rendered: Rendered,
  findings: readonly LintFinding[],
): string {
  const rows = [...rendered.files].map(([path, content]) => [
    code(path),
    String(content.split('\n').length),
    String(approxTokens(content)),
  ]);
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
