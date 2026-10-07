import type { IR } from '../ir';
import { code, table } from './markdown';

export const BLOCK_BEGIN = '<!-- agentic-ddd:begin -->';
export const BLOCK_END = '<!-- agentic-ddd:end -->';

export interface AgentsPaths {
  readonly devSkills: string;
  readonly runtimeSkills: string;
  readonly changesDir?: string;
}

export function renderAgentsBlock(ir: IR, paths: AgentsPaths): string {
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
  lines.push(
    '### Convenções',
    '',
    '- Entidades, métodos, eventos, use-cases e operators são declarados com `@AgentEntity`, `@AgentMethod`, `@AgentEvent`, `@AgentUseCase` e `@Operator` de `@agentic-ddd/decorators`; cada regra de negócio é um `@Invariant({ id, text })` com ID estável.',
    '- Onde criar: `<caminho do módulo>/domain` (entidades, eventos, ports), `<caminho do módulo>/application` (use-cases, sempre com `uses`), `<caminho do módulo>/operators` (operators). A skill de dev do módulo tem os caminhos exatos.',
    '- Todo método público de entidade tem `@AgentMethod`; métodos auxiliares usam `#privado`.',
    '- Corpo declarado e ainda não implementado usa `notImplemented()` de `@agentic-ddd/core`.',
    '- Testes declaram o que cobrem com `covers([...ids], título)` de `@agentic-ddd/testing`.',
    `- Gerados (não edite): ${code(paths.devSkills)}, ${code(paths.runtimeSkills)}, os espelhos de skills e este bloco. Altere o código decorado e rode \`bun run agentic compile\`; o CI roda \`bun run agentic compile --check\`.`,
    BLOCK_END,
  );
  return lines.join('\n');
}
