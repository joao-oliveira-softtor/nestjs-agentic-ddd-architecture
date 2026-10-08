import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { analyzeProject } from '@agentic-ddd/compiler';

const ROOT = resolve(import.meta.dir, '..');

type Expectation =
  | { readonly type: 'tool_call'; readonly name: string; readonly input: Record<string, unknown> }
  | { readonly type: 'exact'; readonly value: string };

interface EvalCase {
  readonly id: string;
  readonly audience: 'runtime' | 'dev';
  readonly question: string;
  readonly expect: Expectation;
}

const cases = Bun.YAML.parse(await readFile(resolve(ROOT, 'evals/skills/orders.yaml'), 'utf8')) as EvalCase[];
const { ir, errors } = await analyzeProject({ configPath: resolve(ROOT, 'agentic.config.ts') });

describe('evals/skills/orders.yaml', () => {
  test('o domínio do exemplo compila', () => {
    expect(errors).toEqual([]);
  });

  test('tem de 3 a 5 casos com id kebab-case único, audience e pergunta', () => {
    expect(cases.length).toBeGreaterThanOrEqual(3);
    expect(cases.length).toBeLessThanOrEqual(5);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      expect(c.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(['runtime', 'dev']).toContain(c.audience);
      expect(c.question.trim().length).toBeGreaterThan(0);
    }
  });

  test('tool_call cita uma tool existente e só parâmetros do input dela', () => {
    for (const c of cases) {
      if (c.expect.type !== 'tool_call') continue;
      const tool = ir.useCases.find((u) => u.name === (c.expect as { name: string }).name);
      expect(tool, c.id).toBeDefined();
      const properties = Object.keys((tool!.inputSchema.properties ?? {}) as Record<string, unknown>);
      for (const key of Object.keys(c.expect.input)) expect(properties, c.id).toContain(key);
    }
  });

  test('respostas exatas não são vazias e só existem os tipos tool_call e exact', () => {
    for (const c of cases) {
      expect(['tool_call', 'exact']).toContain(c.expect.type);
      if (c.expect.type === 'exact') expect(c.expect.value.trim().length).toBeGreaterThan(0);
    }
  });
});
