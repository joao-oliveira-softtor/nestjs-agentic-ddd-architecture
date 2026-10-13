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
  'contagem de linhas',
  'covers([...ids], título)',
  'verify --item',
  'hash original',
  'compile',
  'duas correções',
  'devolva',
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
  expect(domain).toContain('Não leia');
  expect(domain).not.toMatch(/Leia a skill/);
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
