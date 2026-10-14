import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { renderBrief } from '../scripts/agent-briefs';
import {
  buildImplementationPrompt,
  type ImplementationPromptInput,
} from '../scripts/evals/implementation-prompt';

const ROOT = resolve(import.meta.dir, '..');
const run = Bun.spawnSync(
  ['bun', 'src/cli/main.ts', 'packet', 'entity:Order', '--static'],
  { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
);
const packet = run.stdout.toString();
const specHash = /specHash: `?([a-f0-9]{64})/.exec(packet)![1]!;

const base = {
  packet,
  root: '/tmp/work/tasks',
  configPath: '/tmp/work/tasks/agentic.config.ts',
  specHash,
  file: 'app/domain/task.ts',
  className: 'Task',
  method: 'create',
  test: 'app/test/entity-Task.test.ts',
  criteria: [{ id: 'titulo-invalido' }, { id: 'criacao' }],
} satisfies Omit<ImplementationPromptInput, 'mode'>;

const EDIT =
  'Edite somente app/domain/task.ts Task.create (somente interior do corpo, mesma quantidade de linhas) e o novo teste app/test/entity-Task.test.ts. Preserve imports, contratos, decorators, outros corpos, testes existentes, configurações, propostas e gerados.';
const CRITERIA =
  'Critérios adicionais arquivados: [{"id":"criterion:0001/titulo-invalido"},{"id":"criterion:0001/criacao"}]. Cubra-os com covers do executor.';
const FORMAT =
  'Resposta final: objeto JSON com exatamente duas propriedades, status e summary; sem propriedades adicionais. Exemplo {"status":"done","summary":"texto"}; status deve ser done, blocked ou failed, sem prosa ou cercas.';

test('modo legacy preserva o prompt original byte a byte', () => {
  const prompt = buildImplementationPrompt({ ...base, mode: 'legacy' });
  expect(prompt).toBe(
    `Packet:\n${packet}\nEnd packet\nRoot atual: /tmp/work/tasks; configuração atual: /tmp/work/tasks/agentic.config.ts. Use esses paths no lugar de paths temporários do packet; conserve o specHash original ${specHash}.\n${EDIT}\n${CRITERIA}\nLeia .agents/skills/agentic-ddd/SKILL.md e referências de executor pertinentes. Use só a sessão principal, sem delegação ou subagentes. Neste benchmark, este protocolo de resposta final substitui o handoff normal da skill/referência de executor. ${FORMAT}`,
  );
});

test('modo brief usa o brief D5 no lugar de "Leia SKILL.md" e preserva root, teste, critérios e hash', () => {
  const prompt = buildImplementationPrompt({ ...base, mode: 'brief' });
  expect(
    prompt.startsWith(renderBrief({ packet, expectedSpecHash: specHash })),
  ).toBe(true);
  expect(prompt).not.toContain('Leia .agents/skills');
  expect(prompt).not.toContain('Packet:\n');
  for (const part of [
    'Root atual: /tmp/work/tasks; configuração atual: /tmp/work/tasks/agentic.config.ts.',
    `conserve o specHash original ${specHash}`,
    EDIT,
    CRITERIA,
  ])
    expect(prompt).toContain(part);
});

test('os dois modos usam o mesmo formato de resposta, e o brief o sobrescreve de forma explícita', () => {
  const legacy = buildImplementationPrompt({ ...base, mode: 'legacy' });
  const brief = buildImplementationPrompt({ ...base, mode: 'brief' });
  expect(legacy).toContain(FORMAT);
  expect(brief).toContain(FORMAT);
  // o formato rico do brief (D5) continua no texto do brief, mas o protocolo o substitui
  expect(brief).toContain('"verifyExitCode"');
  expect(brief).toMatch(/substitui o formato de resposta final do brief/);
  expect(brief.indexOf(FORMAT)).toBeGreaterThan(
    brief.indexOf('"verifyExitCode"'),
  );
});

test('correção entra igual nos dois modos', () => {
  const correction =
    '\nCorrection: aplique uma nova submissão a partir deste baseline; nenhuma edição anterior foi reaplicada. Patch anterior: unavailable. Findings: []';
  for (const mode of ['legacy', 'brief'] as const)
    expect(buildImplementationPrompt({ ...base, mode, correction })).toEndWith(
      correction,
    );
});

test('item sem corpo (operator) não pede edição de método nos dois modos', () => {
  const noBody = { ...base, file: null, className: null, method: null };
  for (const mode of ['legacy', 'brief'] as const)
    expect(buildImplementationPrompt({ ...noBody, mode })).toContain(
      'Edite somente nenhum corpo e o novo teste app/test/entity-Task.test.ts.',
    );
});

test('brief com specHash divergente do packet falha em vez de medir o item errado', () => {
  expect(() =>
    buildImplementationPrompt({
      ...base,
      mode: 'brief',
      specHash: 'f'.repeat(64),
    }),
  ).toThrow(/specHash divergente/);
});
