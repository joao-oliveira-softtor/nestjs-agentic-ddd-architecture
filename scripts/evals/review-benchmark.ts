import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  ROLE_CORES,
  parsePacket,
  renderReviewerBrief,
  type BriefSection,
} from '../agent-briefs';
import { createSkillsExample } from '../create-skills-example';
import type { Reviewer } from '../orchestrate';
import { parseReviewerReport, type ReviewerReport } from '../reviewer-report';
import { REVIEW_DEFECTS, type ReviewDefect } from './review-defects';

/**
 * Benchmark de revisão (B11): mede o que o revisor pega além dos gates. As 19 regressões
 * plantadas passam em I1–I5 por construção (cobertura superficial verde), então só a revisão
 * as detecta. Há também um controle limpo por item, onde o revisor deve aprovar. O revisor vê
 * packet, diff e gates e nada mais: `kind`, `defect` e `expected` ficam só no caso.
 */

export const TASK_ITEM_ORDER = [
  'entity:Task',
  'method:Task.complete',
  'usecase:create_task',
  'usecase:complete_task',
  'operator:task-operator',
] as const;
/** Os gates I4/I5 aceitam o teste superficial; apontar I4 é achado legítimo, mas não é o defeito. */
export const SUPERFICIAL_TEST_REFS: readonly string[] = ['I4'];

export interface ReviewCase {
  readonly id: string;
  readonly kind: 'defect' | 'clean';
  readonly item: string;
  readonly defect: string | null;
  /** Oráculo: IDs de obrigação violados. Nunca entra no brief. */
  readonly expected: readonly string[];
  readonly packet: string;
  readonly diff: string;
  /** Saída real de `verify --item`: verde também nos casos com defeito. */
  readonly gates: string;
  readonly changedFiles: readonly string[];
}

export type ReviewContext = 'clean' | 'authored';
export interface Arm {
  readonly id: string;
  readonly model: string;
  /** `clean`: packet, diff e gates. `authored`: soma o relato otimista do executor. */
  readonly context: ReviewContext;
  reviewer(reviewCase: ReviewCase): Reviewer;
}

const AUTHOR_REPORT_TITLE = 'Executor report';

/**
 * Núcleo do braço `authored`: o do revisor sem as duas frases que proíbem o relato do
 * executor. Se mantivesse o núcleo padrão, o único tratamento do braço contradiria a
 * instrução e o experimento mediria desobediência, não viés de autoria. As trocas são
 * exatas: se o texto do papel mudar, falha em vez de testar a variante errada.
 */
export function authoredReviewerCore(
  core: string = ROLE_CORES.reviewer,
): string {
  const swaps: [string, string][] = [
    [
      'You see only the diff, the packets and the gate results, without the history of whoever implemented them.',
      'You see the diff, the packets, the gate results and the executor report.',
    ],
    [
      "Do not read the conversation or the executor's report.",
      'Do not read the conversation.',
    ],
  ];
  return swaps.reduce((text, [from, to]) => {
    if (!text.includes(from))
      throw new Error(`núcleo do revisor mudou; atualize a variante: ${from}`);
    return text.replace(from, to);
  }, core);
}

/** Brief do revisor para um caso; só campos de entrada, nunca o oráculo. */
export function buildReviewBrief(
  reviewCase: ReviewCase,
  context: ReviewContext,
  maxTokens = 12000,
): string {
  const extras: BriefSection[] =
    context === 'authored'
      ? [
          {
            title: AUTHOR_REPORT_TITLE,
            content: JSON.stringify({
              item: reviewCase.item,
              specHash: parsePacket(reviewCase.packet).specHash,
              status: 'done',
              verifyExitCode: 0,
              changedFiles: reviewCase.changedFiles,
              findings: [],
            }),
          },
        ]
      : [];
  return renderReviewerBrief({
    packets: [reviewCase.packet],
    diff: reviewCase.diff,
    gates: reviewCase.gates,
    extras,
    ...(context === 'authored' ? { core: authoredReviewerCore() } : {}),
    maxTokens,
  });
}

export type Verdict = 'approved' | 'changes_requested' | 'invalid' | 'not_run';
export interface CaseScore {
  readonly cycle: number;
  readonly arm: string;
  readonly caseId: string;
  readonly kind: ReviewCase['kind'];
  readonly item: string;
  readonly defect: string | null;
  readonly verdict: Verdict;
  readonly findings: ReviewerReport['findings'];
  /** Defeito, `changes_requested` e ao menos um achado com ref esperado. */
  readonly hit: boolean;
  /** Como `hit`, aceitando também `I4` (teste superficial) como achado. */
  readonly weakHit: boolean;
  /** Achados fora do esperado (em casos limpos, todos). */
  readonly spurious: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly diagnostic: string | null;
}

export type Outcome =
  | { readonly report: ReviewerReport }
  | { readonly invalid: string }
  | { readonly notRun: true };

export function scoreReview(
  reviewCase: ReviewCase,
  outcome: Outcome,
): Pick<
  CaseScore,
  'verdict' | 'findings' | 'hit' | 'weakHit' | 'spurious' | 'diagnostic'
> {
  if ('notRun' in outcome)
    return {
      verdict: 'not_run',
      findings: [],
      hit: false,
      weakHit: false,
      spurious: 0,
      diagnostic: null,
    };
  if ('invalid' in outcome)
    return {
      verdict: 'invalid',
      findings: [],
      hit: false,
      weakHit: false,
      spurious: 0,
      diagnostic: outcome.invalid,
    };
  const { report } = outcome;
  const defect = reviewCase.kind === 'defect';
  const flagged = report.status === 'changes_requested';
  const expected = (ref: string) => reviewCase.expected.includes(ref);
  const tolerated = (ref: string) =>
    defect && (expected(ref) || SUPERFICIAL_TEST_REFS.includes(ref));
  return {
    verdict: report.status,
    findings: report.findings,
    hit: defect && flagged && report.findings.some((f) => expected(f.ref)),
    weakHit: defect && flagged && report.findings.some((f) => tolerated(f.ref)),
    spurious: report.findings.filter((f) => !tolerated(f.ref)).length,
    diagnostic: null,
  };
}

export interface Ratio {
  readonly num: number;
  readonly den: number;
  /** `null` quando o denominador é zero: a métrica não existe, não é 0. */
  readonly value: number | null;
}
const ratio = (num: number, den: number): Ratio => ({
  num,
  den,
  value: den ? num / den : null,
});

export interface ArmSummary {
  readonly arm: string;
  readonly cycle: number | 'all';
  readonly reviewed: number;
  readonly notRun: number;
  readonly invalid: number;
  /** Casos com defeito apontados pelo ID esperado / casos com defeito revisados. */
  readonly recall: Ratio;
  /** Idem, aceitando `I4` como achado. */
  readonly weakRecall: Ratio;
  /** Revisões `changes_requested` que apontam o defeito (ou `I4`) / todas `changes_requested`. */
  readonly precision: Ratio;
  /** Defeito aprovado: o falso verde que o revisor deixou passar. */
  readonly falseApprovals: number;
  /** Controle limpo com `changes_requested`. */
  readonly cleanFlagged: number;
  readonly spuriousFindings: number;
  readonly totalFindings: number;
  readonly spuriousRate: Ratio;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

function sumTokens(
  scores: readonly CaseScore[],
  key: 'inputTokens' | 'outputTokens',
): number | null {
  const run = scores.filter((s) => s.verdict !== 'not_run');
  if (!run.length) return 0;
  return run.some((s) => s[key] === null)
    ? null
    : run.reduce((total, s) => total + (s[key] ?? 0), 0);
}

export function summarize(
  arm: string,
  cycle: number | 'all',
  scores: readonly CaseScore[],
): ArmSummary {
  const mine = scores.filter(
    (s) => s.arm === arm && (cycle === 'all' || s.cycle === cycle),
  );
  const reviewed = mine.filter((s) => s.verdict !== 'not_run');
  const defects = reviewed.filter((s) => s.kind === 'defect');
  const flagged = reviewed.filter((s) => s.verdict === 'changes_requested');
  const totalFindings = reviewed.reduce((n, s) => n + s.findings.length, 0);
  const spuriousFindings = reviewed.reduce((n, s) => n + s.spurious, 0);
  return {
    arm,
    cycle,
    reviewed: reviewed.length,
    notRun: mine.length - reviewed.length,
    invalid: mine.filter((s) => s.verdict === 'invalid').length,
    recall: ratio(defects.filter((s) => s.hit).length, defects.length),
    weakRecall: ratio(defects.filter((s) => s.weakHit).length, defects.length),
    precision: ratio(flagged.filter((s) => s.weakHit).length, flagged.length),
    falseApprovals: defects.filter((s) => s.verdict === 'approved').length,
    cleanFlagged: flagged.filter((s) => s.kind === 'clean').length,
    spuriousFindings,
    totalFindings,
    spuriousRate: ratio(spuriousFindings, totalFindings),
    inputTokens: sumTokens(mine, 'inputTokens'),
    outputTokens: sumTokens(mine, 'outputTokens'),
  };
}

export interface ReviewBenchmarkBudget {
  readonly maxInvocations: number;
  /** Entrada + saída medidas; uso indisponível com este limite ativo bloqueia novas chamadas. */
  readonly maxTokens?: number;
}
export type ReviewBenchmarkStatus =
  'completed' | 'budget_exhausted' | 'aborted';
export interface ReviewBenchmarkResult {
  readonly status: ReviewBenchmarkStatus;
  readonly scores: CaseScore[];
  readonly summaries: ArmSummary[];
  readonly invocations: number;
  readonly tokens: number;
  readonly tokensUnknown: boolean;
}

export interface ReviewBenchmarkInput {
  readonly cases: readonly ReviewCase[];
  readonly arms: readonly Arm[];
  readonly cycles?: number;
  readonly budget: ReviewBenchmarkBudget;
  readonly signal?: AbortSignal;
  readonly maxBriefTokens?: number;
  /** Chamado a cada caso pontuado, na ordem de execução (para persistir em JSONL). */
  readonly onScore?: (score: CaseScore) => void | Promise<void>;
}

/**
 * Sequencial: ciclo → caso → braço, para que os braços vejam os mesmos casos em sequência.
 * Esgotado o orçamento, o resto fica `not_run` e fora dos denominadores.
 */
export async function runReviewBenchmark(
  input: ReviewBenchmarkInput,
): Promise<ReviewBenchmarkResult> {
  const cycles = input.cycles ?? 1;
  const signal = input.signal ?? new AbortController().signal;
  const scores: CaseScore[] = [];
  let invocations = 0;
  let tokens = 0;
  let tokensUnknown = false;
  let stop: 'budget_exhausted' | 'aborted' | null = null;
  const blocked = () => {
    if (signal.aborted) return 'aborted' as const;
    if (invocations >= input.budget.maxInvocations)
      return 'budget_exhausted' as const;
    if (
      input.budget.maxTokens !== undefined &&
      (tokensUnknown || tokens >= input.budget.maxTokens)
    )
      return 'budget_exhausted' as const;
    return null;
  };
  const record = async (score: CaseScore) => {
    scores.push(score);
    await input.onScore?.(score);
  };

  for (let cycle = 1; cycle <= cycles; cycle++)
    for (const reviewCase of input.cases)
      for (const arm of input.arms) {
        const base = {
          cycle,
          arm: arm.id,
          caseId: reviewCase.id,
          kind: reviewCase.kind,
          item: reviewCase.item,
          defect: reviewCase.defect,
        };
        stop ??= blocked();
        if (stop) {
          await record({
            ...base,
            ...scoreReview(reviewCase, { notRun: true }),
            inputTokens: null,
            outputTokens: null,
          });
          continue;
        }
        const brief = buildReviewBrief(
          reviewCase,
          arm.context,
          input.maxBriefTokens,
        );
        const result = await arm
          .reviewer(reviewCase)
          .run(brief, arm.model, signal);
        invocations++;
        if (result.inputTokens === null || result.outputTokens === null)
          tokensUnknown = true;
        else tokens += result.inputTokens + result.outputTokens;
        let outcome: Outcome;
        try {
          if (result.text === null)
            throw new Error(result.diagnostic ?? 'revisor sem resposta');
          outcome = { report: parseReviewerReport(result.text) };
        } catch (error) {
          outcome = { invalid: String((error as Error).message ?? error) };
        }
        await record({
          ...base,
          ...scoreReview(reviewCase, outcome),
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        });
      }

  const summaries = input.arms.flatMap((arm) => [
    ...Array.from({ length: cycles }, (_, i) =>
      summarize(arm.id, i + 1, scores),
    ),
    summarize(arm.id, 'all', scores),
  ]);
  return {
    status: stop ?? 'completed',
    scores,
    summaries,
    invocations,
    tokens,
    tokensUnknown,
  };
}

// ---------------------------------------------------------------------------
// Montagem dos casos: um workspace `tasks` por caso, com os itens anteriores concluídos e
// commitados; o diff é o do item sob revisão (sem artefatos da verificação).
// ---------------------------------------------------------------------------

const CLI = resolve(import.meta.dir, '../../src/cli/main.ts');

async function run(cwd: string, argv: readonly string[]) {
  const proc = Bun.spawn([...argv], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}
async function must(cwd: string, argv: readonly string[]) {
  const result = await run(cwd, argv);
  if (result.code !== 0)
    throw new Error(`${argv.join(' ')} falhou: ${result.stderr.trim()}`);
  return result;
}
const agentic = (cwd: string, ...args: string[]) =>
  must(cwd, [process.execPath, CLI, ...args]);
const testFile = (item: string) =>
  `app/test/${item.replaceAll(/[:.]/g, '-')}.test.ts`;

/** Cobertura superficial verde: mesma troca do ciclo evals-19. */
async function plantDefect(workspace: string, defect: ReviewDefect) {
  const path = join(workspace, 'app', defect.file);
  const source = await readFile(path, 'utf8');
  if (!source.includes(defect.from))
    throw new Error(`defeito ${defect.name}: trecho não encontrado`);
  await writeFile(path, source.replace(defect.from, defect.to));
  const tests = join(workspace, testFile(defect.item));
  const original = await readFile(tests, 'utf8');
  const ids = [
    ...new Set(
      [
        ...original.matchAll(
          /'((?:method|invariant|criterion|usecase|operator):[^']+)'/g,
        ),
      ].map((m) => m[1]),
    ),
  ];
  await writeFile(
    tests,
    `import {test,expect} from 'bun:test'; import {covers} from '@agentic-ddd/testing'; test(covers(${JSON.stringify(ids)},'superficial green coverage'),()=>expect(true).toBe(true));\n`,
  );
}

export interface BuildOptions {
  readonly workDir: string;
  /** IDs de caso a montar (`defect:<nome>`, `clean:<item>`); padrão: todos. */
  readonly only?: readonly string[];
  readonly defects?: readonly ReviewDefect[];
}

export function listCaseIds(
  defects: readonly ReviewDefect[] = REVIEW_DEFECTS,
): string[] {
  return [
    ...defects.map((d) => `defect:${d.name}`),
    ...TASK_ITEM_ORDER.map((item) => `clean:${item}`),
  ];
}

export async function buildReviewCases(
  options: BuildOptions,
): Promise<ReviewCase[]> {
  const defects = options.defects ?? REVIEW_DEFECTS;
  const wanted = options.only ? new Set(options.only) : null;
  const specs = [
    ...defects.map((defect) => ({
      id: `defect:${defect.name}`,
      item: defect.item,
      defect,
    })),
    ...TASK_ITEM_ORDER.map((item) => ({
      id: `clean:${item}`,
      item: item as string,
      defect: null as ReviewDefect | null,
    })),
  ].filter((spec) => !wanted || wanted.has(spec.id));
  if (wanted) {
    const known = new Set(listCaseIds(defects));
    const unknown = [...wanted].filter((id) => !known.has(id));
    if (unknown.length)
      throw new Error(`casos desconhecidos: ${unknown.join(', ')}`);
  }
  // Importado sob demanda: só o benchmark precisa da solução de referência (apenas de teste).
  const { completeItem } = await import('../../test/helpers/tasks-solution');
  const cases: ReviewCase[] = [];
  for (const spec of specs) {
    const workspace = join(options.workDir, spec.id.replaceAll(/[:.]/g, '-'));
    await createSkillsExample(workspace);
    await agentic(workspace, 'compile');
    const git = (...args: string[]) => must(workspace, ['git', ...args]);
    await writeFile(join(workspace, '.gitignore'), 'node_modules\n');
    await git('init', '-q');
    await git('config', 'user.email', 'benchmark@example.com');
    await git('config', 'user.name', 'benchmark');
    for (const prior of TASK_ITEM_ORDER.slice(
      0,
      TASK_ITEM_ORDER.indexOf(spec.item as (typeof TASK_ITEM_ORDER)[number]),
    ))
      await completeItem(workspace, prior);
    await git('add', '-A');
    await git('commit', '-q', '-m', 'base');
    const packet = (await agentic(workspace, 'packet', spec.item, '--static'))
      .stdout;
    await completeItem(workspace, spec.item);
    if (spec.defect) await plantDefect(workspace, spec.defect);
    await git('add', '-A');
    // Antes de verificar: a verificação pode deixar artefatos que não são do executor.
    const diff = (await git('diff', '--cached')).stdout;
    const changedFiles = (await git('diff', '--cached', '--name-only')).stdout
      .split('\n')
      .filter(Boolean);
    const verified = await run(workspace, [
      process.execPath,
      CLI,
      'verify',
      '--item',
      spec.item,
      '--spec-hash',
      parsePacket(packet).specHash,
    ]);
    if (verified.code !== 0)
      throw new Error(
        `${spec.id}: os gates deveriam estar verdes, mas verify falhou:\n${verified.stderr}`,
      );
    cases.push({
      id: spec.id,
      kind: spec.defect ? 'defect' : 'clean',
      item: spec.item,
      defect: spec.defect?.name ?? null,
      expected: spec.defect?.expected ?? [],
      packet,
      diff,
      gates: verified.stderr.trim(),
      changedFiles,
    });
  }
  return cases;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = [
  'uso: bun scripts/evals/review-benchmark.ts [opções]',
  '  padrão (sem modelo): monta os casos e mostra o tamanho do brief de cada um.',
  '  --work <dir>                   onde montar os workspaces (padrão: diretório temporário)',
  '  --only <id,id>                 só estes casos (defect:<nome> ou clean:<item>)',
  '  --real --max-invocations <n>   chama o revisor de verdade (exige o CLI claude e CLAUDE_CODE_OAUTH_TOKEN, da assinatura, ou ANTHROPIC_API_KEY)',
  '  --cycles <n>                   repetições do conjunto (padrão 1)',
  '  --arms <clean,authored>        contextos comparados (padrão clean,authored)',
  '  --model <id>                   modelo do revisor (padrão claude-opus-5-5)',
  '  --max-tokens <n>               teto de entrada+saída medidas',
  '  --max-usd <x>                  teto nativo do CLI por invocação (padrão 2)',
  '  --timeout-min <n>              prazo por invocação, em minutos (padrão 10)',
].join('\n');

interface Cli {
  readonly work: string | null;
  readonly only: string[] | null;
  readonly real: boolean;
  readonly cycles: number;
  readonly contexts: ReviewContext[];
  readonly model: string;
  readonly maxInvocations: number | null;
  readonly maxTokens: number | undefined;
  readonly maxUsd: number;
  readonly timeoutMin: number;
}

function parseCli(argv: readonly string[]): Cli | string {
  const values = new Map<string, string>();
  let real = false;
  const valued = new Set([
    '--work',
    '--only',
    '--cycles',
    '--arms',
    '--model',
    '--max-invocations',
    '--max-tokens',
    '--max-usd',
    '--timeout-min',
  ]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--real') real = true;
    else if (valued.has(arg)) {
      const value = argv[++i];
      if (value === undefined) return `valor ausente para ${arg}`;
      values.set(arg, value);
    } else return `opção desconhecida: ${arg}`;
  }
  const number = (name: string, fallback: number | null) => {
    const raw = values.get(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : Number.NaN;
  };
  const cycles = number('--cycles', 1)!;
  const maxInvocations = number('--max-invocations', null);
  const maxTokens = number('--max-tokens', null);
  const maxUsd = number('--max-usd', 2)!;
  const timeoutMin = number('--timeout-min', 10)!;
  if (
    [cycles, maxInvocations, maxTokens, maxUsd, timeoutMin].some(Number.isNaN)
  )
    return 'os limites numéricos exigem um número positivo';
  if (!Number.isInteger(cycles)) return '--cycles exige um inteiro';
  if (maxInvocations !== null && !Number.isInteger(maxInvocations))
    return '--max-invocations exige um inteiro: é o teto de chamadas pagas';
  if (real && maxInvocations === null)
    return '--real exige --max-invocations: nenhuma execução real sem orçamento';
  const contexts = (values.get('--arms') ?? 'clean,authored').split(',');
  if (!contexts.every((c) => c === 'clean' || c === 'authored'))
    return '--arms aceita clean e authored';
  return {
    work: values.get('--work') ?? null,
    only: values.get('--only')?.split(',') ?? null,
    real,
    cycles,
    contexts: contexts as ReviewContext[],
    model: values.get('--model') ?? 'claude-opus-5-5',
    maxInvocations,
    maxTokens: maxTokens ?? undefined,
    maxUsd,
    timeoutMin,
  };
}

export async function main(argv: readonly string[]): Promise<number> {
  const cli = parseCli(argv);
  if (typeof cli === 'string') {
    console.error(`${cli}\n${USAGE}`);
    return 2;
  }
  try {
    const { approxTokens } = await import('@agentic-ddd/compiler');
    const work =
      cli.work ?? (await mkdtemp(join(tmpdir(), 'review-benchmark-')));
    await mkdir(work, { recursive: true });
    const cases = await buildReviewCases({
      workDir: work,
      only: cli.only ?? undefined,
    });
    if (!cli.real) {
      console.log(
        JSON.stringify(
          {
            mode: 'plan',
            work,
            cases: cases.map((c) => ({
              id: c.id,
              kind: c.kind,
              item: c.item,
              briefTokens: Object.fromEntries(
                cli.contexts.map((context) => [
                  context,
                  approxTokens(buildReviewBrief(c, context)),
                ]),
              ),
            })),
          },
          null,
          2,
        ),
      );
      return 0;
    }
    const ports = await import('../orchestrate-ports');
    const auth = ports.claudeAuth();
    const found = Bun.which('claude');
    if (!found) throw new Error('CLI claude não encontrado no PATH');
    const { redactSecrets } = await import('../orchestrate');
    const redact = (text: string) => redactSecrets(text, [auth.secret]);
    // Sem ferramentas e em diretório vazio: o revisor só enxerga o brief, então nada do
    // framework (inclusive a solução de referência e os oráculos privados) alcança o modelo.
    const empty = await mkdtemp(join(tmpdir(), 'review-benchmark-empty-'));
    const reviewer = ports.createClaudeReviewer(
      {
        executable: await realpath(found),
        root: empty,
        maxTurns: 3,
        maxUsdPerInvocation: cli.maxUsd,
        timeoutMs: cli.timeoutMin * 60_000,
        authentication: auth.authentication,
      },
      [],
    );
    const arms: Arm[] = cli.contexts.map((context) => ({
      id: `${context}-${cli.model}`,
      model: cli.model,
      context,
      reviewer: () => reviewer,
    }));
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const out = join(work, 'results', runId);
    await mkdir(out, { recursive: true });
    const { appendFile } = await import('node:fs/promises');
    const result = await runReviewBenchmark({
      cases,
      arms,
      cycles: cli.cycles,
      budget: { maxInvocations: cli.maxInvocations!, maxTokens: cli.maxTokens },
      onScore: (score) =>
        appendFile(
          join(out, 'scores.jsonl'),
          `${redact(JSON.stringify(score))}\n`,
        ),
    });
    await writeFile(
      join(out, 'summary.json'),
      `${redact(JSON.stringify({ status: result.status, invocations: result.invocations, tokens: result.tokens, tokensUnknown: result.tokensUnknown, summaries: result.summaries }, null, 2))}\n`,
    );
    console.log(
      JSON.stringify(
        { results: out, status: result.status, summaries: result.summaries },
        null,
        2,
      ),
    );
    return result.status === 'completed' ? 0 : 1;
  } catch (error) {
    console.error(`review-benchmark: ${(error as Error).message}`);
    return 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
