import { afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createRegistry } from '@agentic-ddd/decorators';
import { buildIR, irHash } from '../../src/contracts/ir';
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
export function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'runtime-'));
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
    uses: [],
    emits: [],
    source,
  });
  registry.useCases.push({
    ...registry.useCases[0]!,
    target: Outside,
    name: 'outside',
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
  const hash = irHash(buildIR(registry, { root, modules }).ir);
  const skill = `---\nname: agent\nmetadata:\n  agentic-ddd.ir-hash: "${hash}"\n---\n# Runtime skill\nUse tool with care.\n`;
  writeFileSync(join(skillDir, 'SKILL.md'), skill);
  return { root, registry, modules, Tool, Agent, skillDir, skill };
}
