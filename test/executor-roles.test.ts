import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { lintSkill } from '@agentic-ddd/compiler';
import { ROLE_CORES } from '../scripts/agent-briefs';
import { installSkills } from '../scripts/install-skills';

const SKILL = resolve(import.meta.dir, '../skills/agentic-ddd');
const read = (file: string) => readFile(join(SKILL, file), 'utf8');
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

// Obrigações que o executor de domínio herda do executor geral. Se uma delas sumir de
// um dos dois textos, os papéis divergiram em silêncio.
const SHARED = [
  'line count',
  'covers([...ids], title)',
  'verify --item',
  'original hash',
  'compile',
  'corrections without progress',
  'return the item',
] as const;

test('executor de domínio e executor geral compartilham as obrigações de contrato', async () => {
  const [general, domain] = await Promise.all([
    read('references/executor.md'),
    read('references/executor-domain.md'),
  ]);
  for (const clause of SHARED) {
    expect(general).toContain(clause);
    expect(domain).toContain(clause);
  }
});

test('o executor de domínio dispensa a skill do módulo e o executor geral aponta para ele', async () => {
  const [general, domain, skill] = await Promise.all([
    read('references/executor.md'),
    read('references/executor-domain.md'),
    read('SKILL.md'),
  ]);
  expect(domain).toContain('Do not read');
  expect(domain).not.toMatch(/Read the module/);
  expect(general).toContain('(executor-domain.md)');
  expect(skill).toContain('(references/executor-domain.md)');
  expect(ROLE_CORES.domain).toBe(domain.trimEnd());
});

test('metadados de SKILL.md seguem o limite do lint', async () => {
  const findings = lintSkill(
    'skills/agentic-ddd/SKILL.md',
    await read('SKILL.md'),
  );
  expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
});

test('Cursor, Codex e Claude leem o mesmo texto do executor de domínio', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentic-roles-'));
  dirs.push(root);
  await installSkills({ root, scope: 'project', target: 'all' });
  const expected = await read('references/executor-domain.md');
  for (const base of [
    '.agents/skills/agentic-ddd',
    '.claude/skills/agentic-ddd',
  ])
    expect(
      await readFile(join(root, base, 'references/executor-domain.md'), 'utf8'),
    ).toBe(expected);
});

test('o revisor lê só o diff, os packets e os gates, não edita e cita ID ou gate', async () => {
  const [reviewer, skill] = await Promise.all([
    read('references/reviewer.md'),
    read('SKILL.md'),
  ]);
  expect(reviewer).toContain('Do not edit files');
  expect(reviewer).toContain(
    "Do not read the conversation or the executor's report",
  );
  expect(reviewer).toContain('Without an ID or gate, it is not a finding');
  // Os packets só listam obrigações (método, caso de uso, invariante); o revisor pode citá-las.
  expect(reviewer).toContain('Obrigações de teste');
  expect(reviewer).toContain('expect(true)');
  expect(skill).toContain('(references/reviewer.md)');
  expect(ROLE_CORES.reviewer).toBe(reviewer.trimEnd());
});

test('os adaptadores do revisor não mandam consultar a skill do módulo', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentic-roles-'));
  dirs.push(root);
  await installSkills({ root, scope: 'project', target: 'all' });
  for (const file of [
    '.claude/agents/agentic-ddd-reviewer.md',
    '.cursor/agents/agentic-ddd-reviewer.md',
    '.codex/agents/agentic-ddd-reviewer.toml',
  ]) {
    const text = await readFile(join(root, file), 'utf8');
    expect(text).toContain('You are the agentic-ddd reviewer');
    expect(text).not.toContain('generated skill of the module');
  }
  expect(
    await readFile(
      join(root, '.claude/agents/agentic-ddd-executor.md'),
      'utf8',
    ),
  ).toContain('generated skill of the module');
});
