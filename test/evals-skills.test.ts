import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSkillContext, evaluateSkills } from '../scripts/evals/skills';
import { createScriptedAdapter } from '../scripts/evals/adapters/scripted';
import { loadDataset } from '../scripts/evals/dataset';
import { evalManifest, frozenSource } from './helpers/evals';
let fixture: Awaited<ReturnType<typeof frozenSource>>;
let out: string;
beforeAll(async () => {
  fixture = await frozenSource();
  out = await mkdtemp(join(tmpdir(), 'eval-skills-report-'));
}, 60000);
afterAll(async () => {
  await fixture?.cleanup();
  if (out) await rm(out, { recursive: true, force: true });
}, 60000);
test('all five original cases judged correctly in fresh readonly sessions without expectations', async () => {
  const dataset = await loadDataset(
    join(fixture.source.snapshotRoot, 'evals/skills/orders.yaml'),
  );
  const prompts: string[] = [];
  const cwd = new Set<string>();
  const adapter = createScriptedAdapter(
    dataset.map((c) => ({
      finalText: JSON.stringify(c.expect),
      before: async (req) => {
        prompts.push(req.prompt);
        cwd.add(req.cwd);
        expect(
          await Bun.file(join(req.cwd, 'evals/skills/orders.yaml')).exists(),
        ).toBe(false);
      },
    })),
  );
  const result = await evaluateSkills(
    evalManifest,
    fixture.source,
    new Map([['scripted', adapter]]),
    { outDir: out, real: false, signal: new AbortController().signal },
  );
  expect(result.map((c) => c.verdict)).toEqual(Array(5).fill('correct'));
  expect(cwd.size).toBe(5);
  for (let i = 0; i < 5; i++) {
    expect(prompts[i]).not.toContain(JSON.stringify(dataset[i]!.expect));
    expect(result[i]!.datasetSha256).toHaveLength(64);
    expect(result[i]!.contextHash).toHaveLength(64);
  }
  expect(
    await readFile(
      join(fixture.source.originRoot, 'evals/skills/orders.yaml'),
      'utf8',
    ),
  ).toBe(
    await readFile(
      join(fixture.source.snapshotRoot, 'evals/skills/orders.yaml'),
      'utf8',
    ),
  );
});
test('wrong, malformed, timeout, infrastructure remain distinct and do not stop independent questions', async () => {
  const directory = join(out, 'failures');
  await mkdir(directory);
  const adapter = createScriptedAdapter([
    { finalText: '{"type":"exact","value":"wrong"}' },
    { finalText: '```json\n{}\n```' },
    { delayMs: 500 },
    { argv: ['/absent-adapter'] },
    {
      finalText:
        '{"type":"exact","value":"examples/orders/application/refund-order.ts @AgentUseCase"}',
    },
  ]);
  const manifest = {
    ...evalManifest,
    budget: { ...evalManifest.budget, skillTimeoutMs: 150 },
  };
  const result = await evaluateSkills(
    manifest,
    fixture.source,
    new Map([['scripted', adapter]]),
    { outDir: directory, real: false, signal: new AbortController().signal },
  );
  expect(result.map((c) => c.verdict)).toEqual([
    'incorrect',
    'malformed',
    'timeout',
    'infra_error',
    'correct',
  ]);
});
test('bundle hashes independent of temporary paths; dangerous context roots rejected', async () => {
  const a = await buildSkillContext(fixture.source, [
    'AGENTS.md',
    '.agents/skills/orders-dev',
  ]);
  const b = await buildSkillContext(fixture.source, [
    '.agents/skills/orders-dev',
    'AGENTS.md',
  ]);
  expect(a.bundleSha256).toBe(b.bundleSha256);
  expect(a.files.some((f) => f.path.endsWith('references/history.md'))).toBe(
    true,
  );
  for (const roots of [['.'], ['evals'], ['test/helpers'], ['src']]) {
    let failure: unknown;
    try {
      await buildSkillContext(fixture.source, roots);
    } catch (e) {
      failure = e;
    }
    expect(failure).toBeInstanceOf(Error);
  }
});
