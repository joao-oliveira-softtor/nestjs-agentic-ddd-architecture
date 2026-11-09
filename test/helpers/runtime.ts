import { afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { DomainEvent } from '@agentic-ddd/core';
import { canonicalPath, createRegistry } from '@agentic-ddd/decorators';
import { buildIR, irHash } from '../../src/contracts/ir';
export class Changed extends DomainEvent {}
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
export function fixture() {
  // SourceLoc à mão não passa pelo captureSource: a raiz já vem na forma canônica.
  const root = canonicalPath(mkdtempSync(join(tmpdir(), 'runtime-')));
  dirs.push(root);
  const registry = createRegistry();
  class Tool {}
  class Outside {}
  class Agent {}
  const source = { file: join(root, 'app/decl.ts'), line: 1, column: 1 };
  registry.useCases.push({
    target: Tool,
    name: 'tool',
    description: 'Do work',
    whenToUse: 'For work',
    whenNotToUse: 'For leisure',
    input: z.object({ value: z.string() }),
    output: z.object({ value: z.string() }),
    // emits without a method in uses that emits it fails validate; the runtime only calls buildIR.
    uses: [],
    emits: [Changed],
    source,
  });
  registry.events.push({
    target: Changed,
    description: 'Changed',
    payload: z.unknown(),
    source,
  });
  // A schema of its own, so a tool that took the wrong use-case's schema shows.
  registry.useCases.push({
    ...registry.useCases[0]!,
    target: Outside,
    name: 'outside',
    input: z.object({ other: z.number() }),
  });
  registry.operators.push({
    target: Agent,
    name: 'agent',
    description: 'Agent',
    instructions: 'Follow instructions',
    useCases: [Tool],
    requiresApproval: [],
    limits: { maxSteps: 3, timeoutMs: 1000 },
    model: 'test-model',
    source,
  });
  const modules = [{ name: 'app', path: 'app' }];
  const skillDir = join(root, '.agentic/runtime/agent');
  mkdirSync(skillDir, { recursive: true });
  /** Stamps the skill with the registry's current IR hash, as compile would. */
  const compileSkill = () => {
    const hash = irHash(buildIR(registry, { root, modules }).ir);
    const skill = `---\nname: agent\nmetadata:\n  agentic-ddd.ir-hash: "${hash}"\n---\n# Runtime skill\nUse tool with care.\n`;
    writeFileSync(join(skillDir, 'SKILL.md'), skill);
    return skill;
  };
  const skill = compileSkill();
  return {
    root,
    registry,
    modules,
    Tool,
    Outside,
    Agent,
    skillDir,
    skill,
    compileSkill,
  };
}
