import type { IR } from '../ir';
import type { ResolvedConventions } from '../config';
import { CORE_RULES, fillMarkers, ruleHash, type Rule } from '../rules';
import { code, table } from './markdown';

export const BLOCK_BEGIN = '<!-- agentic-ddd:begin -->';
export const BLOCK_END = '<!-- agentic-ddd:end -->';

export interface AgentsPaths {
  readonly devSkills: string;
  readonly runtimeSkills: string;
  readonly changesDir?: string;
}

export function renderAgentsBlock(
  ir: IR,
  paths: AgentsPaths,
  rules: readonly Rule[] = CORE_RULES,
  layers?: ResolvedConventions['layers'],
): string {
  const changes = paths.changesDir ?? 'changes';
  const lines: string[] = [
    BLOCK_BEGIN,
    '<!-- GERADO por agentic-ddd compile — não edite este bloco; o texto fora dele é seu. -->',
    '',
    '## Domínio (agentic-ddd)',
    '',
  ];
  if (ir.modules.length > 0) {
    const rows = ir.modules.map((m) => [
      m.name,
      code(m.path),
      code(`${paths.devSkills}/${m.name}-dev/SKILL.md`),
    ]);
    lines.push(table(['Módulo', 'Código', 'Skill de dev'], rows), '');
  }
  if (ir.operators.length > 0) {
    const rows = ir.operators.map((o) => [
      o.name,
      code(`${paths.runtimeSkills}/${o.name}/SKILL.md`),
    ]);
    lines.push(table(['Operator', 'Skill de runtime'], rows), '');
  }
  lines.push('### Convenções', '');
  const values = {
    changes,
    devSkills: paths.devSkills,
    runtimeSkills: paths.runtimeSkills,
    layers,
  };
  for (const rule of rules)
    if (rule.paths === null)
      lines.push(
        rule.file === null ? fillMarkers(rule.body, values) : rule.body,
      );
  const scoped = rules.filter((r) => r.paths !== null);
  if (scoped.length > 0) {
    const rows = scoped.map((r) => [
      r.paths!.map(code).join(', '),
      code(r.file!),
      code(ruleHash(r)),
    ]);
    lines.push(
      '',
      '### Regras por caminho',
      '',
      table(['Globs', 'Arquivo', 'sha256'], rows),
    );
  }
  lines.push(BLOCK_END);
  return lines.join('\n');
}
