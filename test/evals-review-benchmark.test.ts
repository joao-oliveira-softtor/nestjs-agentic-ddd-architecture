import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Reviewer, ReviewerResult } from '../scripts/orchestrate';
import { claudeRunArgv } from '../scripts/orchestrate-ports';
import { REVIEW_DEFECTS } from '../scripts/evals/review-defects';
import {
  TASK_ITEM_ORDER,
  buildReviewBrief,
  buildReviewCases,
  listCaseIds,
  main,
  runReviewBenchmark,
  scoreReview,
  summarize,
  type Arm,
  type CaseScore,
  type ReviewCase,
} from '../scripts/evals/review-benchmark';

const hash = (id: string) =>
  Bun.CryptoHasher.hash('sha256', id, 'hex') as string;
function packetOf(id: string): string {
  return [
    '# Identificação',
    '',
    `- ID: \`${id}\``,
    '- Camada: domain',
    '- Módulo: tasks',
    `- source: \`app/${id.replace(/\W+/g, '-')}.ts:3\``,
    `- specHash: \`${hash(id)}\``,
    '',
    `bun run agentic verify --item ${id} --spec-hash ${hash(id)} --config agentic.config.ts --json`,
    '',
  ].join('\n');
}
function reviewCase(
  id: string,
  kind: 'defect' | 'clean',
  expected: string[] = [],
): ReviewCase {
  const item = `entity:${id}`;
  return {
    id: `${kind}:${id}`,
    kind,
    item,
    defect: kind === 'defect' ? `secret-defect-${id}` : null,
    expected,
    packet: packetOf(item),
    diff: `diff --git a/app/${id}.ts b/app/${id}.ts\n+changed ${id}`,
    gates: 'I1 Dependências: passed\nI4 Obrigações: passed',
    changedFiles: [`app/${id}.ts`],
  };
}
const A = reviewCase('A', 'defect', ['method:A.create']);
const B = reviewCase('B', 'defect', ['invariant:B/regra']);
const C = reviewCase('C', 'clean');

const json = (value: unknown) => JSON.stringify(value);
const approved = json({ status: 'approved', findings: [] });
const requested = (...refs: string[]) =>
  json({
    status: 'changes_requested',
    findings: refs.map((ref) => ({ ref, message: `achado ${ref}` })),
  });
function scripted(
  respond: (brief: string, call: number) => string | null,
  usage: [number | null, number | null] = [100, 10],
) {
  const briefs: string[] = [];
  const reviewer: Reviewer = {
    async run(brief): Promise<ReviewerResult> {
      briefs.push(brief);
      const text = respond(brief, briefs.length);
      return {
        text,
        inputTokens: usage[0],
        outputTokens: usage[1],
        durationMs: 1,
        diagnostic: text === null ? 'sem resposta' : null,
      };
    },
  };
  return { briefs, reviewer };
}
const arm = (
  id: string,
  reviewer: Reviewer,
  context: 'clean' | 'authored' = 'clean',
): Arm => ({ id, model: 'modelo-x', context, reviewer: () => reviewer });
const budget = { maxInvocations: 100 };

test('o catálogo tem as 19 regressões, cada uma com IDs de obrigação esperados', () => {
  expect(REVIEW_DEFECTS).toHaveLength(19);
  expect(new Set(REVIEW_DEFECTS.map((d) => d.name)).size).toBe(19);
  for (const defect of REVIEW_DEFECTS) {
    expect(TASK_ITEM_ORDER).toContain(defect.item as never);
    expect(defect.expected.length).toBeGreaterThan(0);
    expect(defect.from).not.toBe(defect.to);
    // Cada ID esperado pertence ao item da regressão (obrigação do próprio packet).
    for (const id of defect.expected)
      expect(
        id === defect.item ||
          (defect.item === 'entity:Task' &&
            [
              'method:Task.create',
              'invariant:Task/titulo-obrigatorio',
            ].includes(id)),
      ).toBe(true);
  }
  expect(listCaseIds()).toHaveLength(19 + TASK_ITEM_ORDER.length);
});

test('pontuação: acerto exige o ID esperado; I4 é tolerado só como acerto fraco', () => {
  const hit = scoreReview(A, {
    report: JSON.parse(requested('method:A.create')),
  });
  expect(hit).toMatchObject({
    verdict: 'changes_requested',
    hit: true,
    weakHit: true,
    spurious: 0,
  });
  const weak = scoreReview(A, { report: JSON.parse(requested('I4')) });
  expect(weak).toMatchObject({ hit: false, weakHit: true, spurious: 0 });
  const wrong = scoreReview(A, {
    report: JSON.parse(requested('method:Outro', 'method:A.create')),
  });
  expect(wrong).toMatchObject({ hit: true, spurious: 1 });
  const miss = scoreReview(A, { report: JSON.parse(requested('method:X')) });
  expect(miss).toMatchObject({ hit: false, weakHit: false, spurious: 1 });
  const approvedDefect = scoreReview(A, {
    report: JSON.parse(approved),
  });
  expect(approvedDefect).toMatchObject({
    verdict: 'approved',
    hit: false,
    spurious: 0,
  });
  // Controle limpo: qualquer achado é espúrio, inclusive I4.
  const clean = scoreReview(C, { report: JSON.parse(requested('I4', 'x')) });
  expect(clean).toMatchObject({ hit: false, weakHit: false, spurious: 2 });
  expect(scoreReview(A, { invalid: 'não é JSON' })).toMatchObject({
    verdict: 'invalid',
    diagnostic: 'não é JSON',
  });
  expect(scoreReview(A, { notRun: true }).verdict).toBe('not_run');
});

test('o brief só leva packet, diff, gates e (se o braço pedir) o relato do autor, nunca o oráculo', () => {
  const clean = buildReviewBrief(A, 'clean');
  const authored = buildReviewBrief(A, 'authored');
  for (const brief of [clean, authored]) {
    expect(brief).toContain(A.packet.trimEnd());
    expect(brief).toContain(A.diff);
    expect(brief).toContain('I4 Obrigações: passed');
    expect(brief).not.toContain(A.defect!);
    expect(brief).not.toContain('method:A.create');
    expect(brief).not.toContain('expected');
  }
  expect(clean).not.toContain('Relato do executor');
  expect(authored).toContain('Relato do executor');
  expect(authored).toContain('"status":"done"');
  expect(authored).toContain('"verifyExitCode":0');
});

test('revisor perfeito: recall e precisão 1, nenhum achado espúrio; preguiçoso: falso verde em todos os defeitos', async () => {
  const perfect = scripted((brief) =>
    brief.includes('changed A')
      ? requested('method:A.create')
      : brief.includes('changed B')
        ? requested('invariant:B/regra', 'I4')
        : approved,
  );
  const lazy = scripted(() => approved);
  const result = await runReviewBenchmark({
    cases: [A, B, C],
    arms: [arm('perfeito', perfect.reviewer), arm('preguiçoso', lazy.reviewer)],
    budget,
  });
  expect(result.status).toBe('completed');
  expect(result.invocations).toBe(6);
  const all = (id: string) =>
    result.summaries.find((s) => s.arm === id && s.cycle === 'all')!;
  expect(all('perfeito')).toMatchObject({
    reviewed: 3,
    recall: { num: 2, den: 2, value: 1 },
    weakRecall: { num: 2, den: 2, value: 1 },
    precision: { num: 2, den: 2, value: 1 },
    falseApprovals: 0,
    cleanFlagged: 0,
    spuriousFindings: 0,
    totalFindings: 3,
    inputTokens: 300,
    outputTokens: 30,
  });
  expect(all('preguiçoso')).toMatchObject({
    recall: { num: 0, den: 2, value: 0 },
    falseApprovals: 2,
    // Ninguém foi apontado: não há precisão a medir (não é 0).
    precision: { num: 0, den: 0, value: null },
    spuriousRate: { value: null },
  });
});

test('revisor barulhento: precisão cai, controle limpo apontado e achados espúrios contados', async () => {
  const noisy = scripted(() => requested('method:Qualquer'));
  const result = await runReviewBenchmark({
    cases: [A, B, C],
    arms: [arm('barulhento', noisy.reviewer)],
    budget,
  });
  expect(result.summaries.at(-1)).toMatchObject({
    recall: { num: 0, den: 2, value: 0 },
    precision: { num: 0, den: 3, value: 0 },
    cleanFlagged: 1,
    spuriousFindings: 3,
    totalFindings: 3,
    spuriousRate: { value: 1 },
  });
});

test('resposta fora do formato ou sem texto é inválida e não conta como acerto', async () => {
  const mixed = scripted((_, call) =>
    call === 1
      ? 'Parece bom!'
      : call === 2
        ? null
        : requested('method:A.create'),
  );
  const result = await runReviewBenchmark({
    cases: [A, B, A],
    arms: [arm('x', mixed.reviewer)],
    budget,
  });
  expect(result.scores.map((s) => s.verdict)).toEqual([
    'invalid',
    'invalid',
    'changes_requested',
  ]);
  expect(result.scores[1]!.diagnostic).toBe('sem resposta');
  expect(result.summaries.at(-1)).toMatchObject({
    invalid: 2,
    recall: { num: 1, den: 3 },
  });
});

test('ciclos: um resumo por ciclo e o agregado; braço com relato do autor recebe a seção extra', async () => {
  const clean = scripted(() => approved);
  const authored = scripted((brief) =>
    brief.includes('Relato do executor') ? approved : requested('x'),
  );
  const result = await runReviewBenchmark({
    cases: [A, C],
    arms: [
      arm('limpo', clean.reviewer, 'clean'),
      arm('autoral', authored.reviewer, 'authored'),
    ],
    cycles: 2,
    budget,
  });
  expect(result.invocations).toBe(8);
  expect(result.summaries.map((s) => [s.arm, s.cycle, s.reviewed])).toEqual([
    ['limpo', 1, 2],
    ['limpo', 2, 2],
    ['limpo', 'all', 4],
    ['autoral', 1, 2],
    ['autoral', 2, 2],
    ['autoral', 'all', 4],
  ]);
  expect(clean.briefs.some((b) => b.includes('Relato do executor'))).toBe(
    false,
  );
  expect(authored.briefs.every((b) => b.includes('Relato do executor'))).toBe(
    true,
  );
});

test('orçamento: invocações e tokens interrompem; o resto é not_run e fica fora dos denominadores', async () => {
  const byCount = await runReviewBenchmark({
    cases: [A, B, C],
    arms: [arm('x', scripted(() => approved).reviewer)],
    budget: { maxInvocations: 2 },
  });
  expect(byCount.status).toBe('budget_exhausted');
  expect(byCount.scores.map((s) => s.verdict)).toEqual([
    'approved',
    'approved',
    'not_run',
  ]);
  expect(byCount.summaries.at(-1)).toMatchObject({
    reviewed: 2,
    notRun: 1,
    recall: { den: 2 },
  });

  const byTokens = await runReviewBenchmark({
    cases: [A, B],
    arms: [arm('x', scripted(() => approved).reviewer)],
    budget: { maxInvocations: 10, maxTokens: 110 },
  });
  expect(byTokens.status).toBe('budget_exhausted');
  expect(byTokens.invocations).toBe(1);

  const unknown = await runReviewBenchmark({
    cases: [A, B],
    arms: [arm('x', scripted(() => approved, [null, null]).reviewer)],
    budget: { maxInvocations: 10, maxTokens: 1_000_000 },
  });
  expect(unknown.status).toBe('budget_exhausted');
  expect(unknown.tokensUnknown).toBe(true);
  expect(unknown.summaries.at(-1)).toMatchObject({ inputTokens: null });

  const controller = new AbortController();
  controller.abort();
  const aborted = await runReviewBenchmark({
    cases: [A],
    arms: [arm('x', scripted(() => approved).reviewer)],
    budget,
    signal: controller.signal,
  });
  expect(aborted.status).toBe('aborted');
  expect(aborted.invocations).toBe(0);
});

test('onScore recebe cada caso na ordem de execução', async () => {
  const seen: CaseScore[] = [];
  await runReviewBenchmark({
    cases: [A, C],
    arms: [arm('x', scripted(() => approved).reviewer)],
    budget,
    onScore: (score) => void seen.push(score),
  });
  expect(seen.map((s) => s.caseId)).toEqual(['defect:A', 'clean:C']);
  expect(summarize('x', 'all', seen).reviewed).toBe(2);
});

test('o revisor real do benchmark roda sem nenhuma ferramenta', () => {
  const argv = claudeRunArgv(
    {
      executable: '/bin/claude',
      root: '/vazio',
      maxTurns: 3,
      maxUsdPerInvocation: 1,
      timeoutMs: 1000,
    },
    'claude-opus-5-5',
    'brief',
    [],
  );
  expect(argv).toContain('--tools=');
  expect(argv).not.toContain('--allowed-tools');
  expect(argv.some((a) => a.startsWith('--allowed-tools='))).toBe(false);
  expect(argv.slice(-2)).toEqual(['--', 'brief']);
});

test('CLI: --real exige orçamento e opções inválidas são recusadas', async () => {
  const error = console.error;
  console.error = () => {};
  try {
    expect(await main(['--real'])).toBe(2);
    expect(await main(['--arms', 'outro'])).toBe(2);
    expect(await main(['--cycles', '1.5'])).toBe(2);
    expect(await main(['--max-tokens', '0'])).toBe(2);
    expect(await main(['--inexistente'])).toBe(2);
    expect(await main(['--only', 'defect:nao-existe'])).toBe(1);
  } finally {
    console.error = error;
  }
}, 60000);

test('casos reais: com defeito e limpo passam nos gates, o diff traz a regressão e o brief não vaza o oráculo', async () => {
  const work = await mkdtemp(join(tmpdir(), 'review-cases-'));
  try {
    const cases = await buildReviewCases({
      workDir: work,
      only: ['defect:normalization', 'clean:entity:Task'],
    });
    const [defect, clean] = cases;
    expect(defect).toMatchObject({
      kind: 'defect',
      item: 'entity:Task',
      defect: 'normalization',
      expected: ['method:Task.create'],
    });
    // Os gates estão verdes mesmo com a regressão: só a revisão a pega.
    for (const c of cases)
      expect(c!.gates).toContain('item entity:Task — done');
    expect(defect!.diff).toContain('+const normalized = title;');
    expect(defect!.diff).toContain('superficial green coverage');
    expect(clean!.diff).toContain('title.trim()');
    expect(clean!.diff).not.toContain('superficial');
    expect(defect!.changedFiles).toEqual([
      'app/domain/task.ts',
      'app/test/entity-Task.test.ts',
    ]);
    for (const c of cases)
      for (const context of ['clean', 'authored'] as const) {
        const brief = buildReviewBrief(c!, context);
        expect(brief).toContain(c!.packet.trimEnd());
        expect(brief).not.toContain('normalization');
        expect(brief).not.toContain('"expected"');
      }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}, 120000);
