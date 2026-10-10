import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Ajv from 'ajv';
import { analyzeProject } from '@agentic-ddd/compiler';
import { loadDataset } from '../scripts/evals/dataset';
import { sha256 } from '../scripts/evals/isolation';
import { judge, parseAnswer } from '../scripts/evals/judge';
import { evaluateSkills } from '../scripts/evals/skills';
import { createScriptedAdapter } from '../scripts/evals/adapters/scripted';
import { evalManifest, frozenSource } from './helpers/evals';
const path = 'evals/skills/orders.extended.yaml';
const originalHash =
  '19c615ee4569427ff4ff8d3d40fe20a6702b79fa3fdb5c4a6f5386354efef6a6';
let fixture: Awaited<ReturnType<typeof frozenSource>>;
let out: string;
beforeAll(async () => {
  fixture = await frozenSource([path]);
  out = await mkdtemp(join(tmpdir(), 'eval-extended-'));
}, 60000);
afterAll(async () => {
  await fixture?.cleanup();
  if (out) await rm(out, { recursive: true, force: true });
});

test('20 literal cases agree with declarations, full nested schemas and documented rules', async () => {
  const cases = await loadDataset(join(fixture.source.snapshotRoot, path));
  expect(cases).toHaveLength(20);
  expect(cases.filter((c) => c.audience === 'dev')).toHaveLength(10);
  expect(cases.filter((c) => c.audience === 'runtime')).toHaveLength(10);
  for (const audience of ['dev', 'runtime']) {
    expect(
      cases.filter(
        (c) => c.audience === audience && c.id.includes('-positive-'),
      ),
    ).toHaveLength(5);
    expect(
      cases.filter(
        (c) => c.audience === audience && c.id.includes('-negative-'),
      ),
    ).toHaveLength(5);
  }
  const { ir, errors } = await analyzeProject({
    configPath: join(import.meta.dir, '../agentic.config.ts'),
  });
  expect(errors).toEqual([]);
  const schemas = await Bun.file(
    join(
      import.meta.dir,
      '../.agentic/runtime/order-operator/references/tools.schema.json',
    ),
  ).json();
  const ajv = new Ajv({ strict: false });
  for (const c of cases) {
    expect(judge(c.expect, parseAnswer(JSON.stringify(c.expect)))).toBe(
      'correct',
    );
    expect(judge(c.expect, { type: 'exact', value: 'wrong' })).toBe(
      'incorrect',
    );
    expect(() =>
      parseAnswer(JSON.stringify({ ...c.expect, extra: true })),
    ).toThrow();
    if (c.expect.type !== 'tool_call') continue;
    const tool = ir.useCases.find(
      (u) => u.name === (c.expect as { name: string }).name,
    )!;
    expect(tool).toBeDefined();
    expect(ajv.validate(tool.inputSchema, c.expect.input), c.id).toBe(true);
    expect(
      ajv.validate(schemas[c.expect.name].input, c.expect.input),
      c.id,
    ).toBe(true);
  }
  const create = schemas.create_order.input;
  const valid = {
    order_id: 'o1',
    customer_id: 'c1',
    items: [{ sku: 's1', quantity: 2, unit_price: 3 }],
  };
  for (const input of [
    { ...valid, items: [] },
    { ...valid, items: [{ sku: '', quantity: 2, unit_price: 3 }] },
    { ...valid, items: [{ sku: 's1', quantity: 0, unit_price: 3 }] },
    { ...valid, items: [{ sku: 's1', quantity: 1.5, unit_price: 3 }] },
    { ...valid, items: [{ sku: 's1', quantity: 2, unit_price: -1 }] },
    { ...valid, items: [{ sku: 's1', quantity: 2 }] },
  ])
    expect(ajv.validate(create, input)).toBe(false);
  const byId = new Map(cases.map((c) => [c.id, c.expect]));
  const values: Record<string, string> = {
    'dev-positive-entity': 'examples/orders/domain/invoice.ts @AgentEntity',
    'dev-positive-usecase':
      'examples/orders/application/refund-order.ts @AgentUseCase',
    'dev-positive-uses': 'method:Order.confirm',
    'dev-positive-public-method': '@AgentMethod',
    'dev-positive-proposal': 'sim',
    'dev-negative-static-done': 'não',
    'dev-negative-old-hash': 'não',
    'dev-negative-unexecuted-coverage': 'não',
    'dev-negative-empty-skeleton': 'não',
    'dev-negative-generated-edit': 'não',
    'runtime-positive-approval': 'sim',
    'runtime-positive-transition': 'pending confirmed',
    'runtime-negative-cancelled': 'não',
    'runtime-negative-confirmed': 'não',
    'runtime-negative-denied': 'não',
    'runtime-negative-no-reason': 'não',
    'runtime-negative-no-items': 'não',
  };
  for (const [id, value] of Object.entries(values))
    expect(byId.get(id)).toEqual({ type: 'exact', value });
  const dev = await readFile(
    join(fixture.source.snapshotRoot, '.agents/skills/orders-dev/SKILL.md'),
    'utf8',
  );
  const agents = await readFile(
    join(fixture.source.snapshotRoot, 'AGENTS.md'),
    'utf8',
  );
  const runtime = await readFile(
    join(
      fixture.source.snapshotRoot,
      '.agentic/runtime/order-operator/SKILL.md',
    ),
    'utf8',
  );
  expect(dev).toContain("uses: ['method:<Entidade>.<método>']");
  expect(agents).toContain('hash');
  expect(agents).toContain('corpo vazio conta como implementado');
  expect(agents).toContain('escreva antes a proposta');
  expect(agents).toContain('nunca certifica `done`');
  expect(agents).toContain('Gerados (não edite)');
  expect(runtime).toContain('approval_denied');
  expect(runtime).toContain('motivo não vazio');
  const confirm = ir.entities
    .flatMap((e) => e.methods)
    .find((m) => m.name === 'confirm')!;
  expect(confirm.transition).toEqual({ from: ['pending'], to: 'confirmed' });
  expect(
    sha256(
      await readFile(
        join(fixture.source.snapshotRoot, 'evals/skills/orders.yaml'),
      ),
    ),
  ).toBe(originalHash);
});

for (const verdict of ['correct', 'incorrect', 'malformed'] as const)
  test(`all 20 cases judged ${verdict} in isolated sessions without dataset or expectations`, async () => {
    const cases = await loadDataset(join(fixture.source.snapshotRoot, path));
    const workspaces = new Set<string>();
    const adapter = createScriptedAdapter(
      cases.map((c) => ({
        finalText:
          verdict === 'correct'
            ? JSON.stringify(c.expect)
            : verdict === 'incorrect'
              ? '{"type":"exact","value":"wrong"}'
              : '{"type":"exact","value":"sim","extra":true}',
        before: async (req) => {
          workspaces.add(req.cwd);
          expect(await Bun.file(join(req.cwd, path)).exists()).toBe(false);
          expect(
            await Bun.file(join(req.cwd, 'evals/skills/orders.yaml')).exists(),
          ).toBe(false);
          expect(req.prompt).not.toContain(JSON.stringify(c.expect));
          expect(req.prompt).not.toContain('expect:');
        },
      })),
    );
    const manifest = {
      ...evalManifest,
      skillDatasets: [{ ...evalManifest.skillDatasets[0]!, path }],
    };
    const results = await evaluateSkills(
      manifest,
      fixture.source,
      new Map([['scripted', adapter]]),
      {
        outDir: join(out, verdict),
        real: false,
        signal: new AbortController().signal,
      },
    );
    expect(results.map((c) => c.verdict)).toEqual(Array(20).fill(verdict));
    expect(workspaces.size).toBe(20);
    expect(new Set(results.map((c) => c.datasetSha256))).toEqual(
      new Set([
        sha256(await readFile(join(fixture.source.snapshotRoot, path))),
      ]),
    );
  }, 60000);
