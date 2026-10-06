import { irHash, type IR } from '../ir.js';
import { renderAgentsBlock } from './agents-md.js';
import { renderDevSkill } from './dev-skill.js';
import { renderRuntimeSkill } from './runtime-skill.js';

export interface OutputPaths {
  readonly agentsMd: string;
  readonly claudeMd: string;
  readonly devSkills: string;
  readonly runtimeSkills: string;
}

export const DEFAULT_OUT: OutputPaths = {
  agentsMd: 'AGENTS.md',
  claudeMd: 'CLAUDE.md',
  devSkills: '.agents/skills',
  runtimeSkills: '.agentic/runtime',
};

export interface Rendered {
  readonly files: ReadonlyMap<string, string>;
  readonly agentsBlock: string;
  readonly devSkillDirs: readonly string[];
  readonly runtimeSkillDirs: readonly string[];
}

export function renderAll(ir: IR, out: OutputPaths): Rendered {
  const hash = irHash(ir);
  const entries: [string, string][] = [];
  for (const module of ir.modules) {
    for (const [rel, content] of renderDevSkill(ir, module, hash))
      entries.push([`${out.devSkills}/${module.name}-dev/${rel}`, content]);
  }
  for (const operator of ir.operators) {
    for (const [rel, content] of renderRuntimeSkill(ir, operator, hash))
      entries.push([`${out.runtimeSkills}/${operator.name}/${rel}`, content]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    files: new Map(entries),
    agentsBlock: renderAgentsBlock(ir, out),
    devSkillDirs: ir.modules.map((m) => `${m.name}-dev`),
    runtimeSkillDirs: ir.operators.map((o) => o.name),
  };
}
