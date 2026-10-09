import { z } from 'zod';
import type { EvalMetrics } from './report';
import type {
  ItemVerifyReport,
  TestRun,
  VerifyReport,
} from '@agentic-ddd/compiler';

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
const jsonSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonSchema),
    z.record(z.string(), jsonSchema),
  ]),
);
export const answerSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('exact'), value: z.string() }),
  z.strictObject({
    type: z.literal('tool_call'),
    name: z.string().min(1),
    input: z.record(z.string(), jsonSchema),
  }),
]);
export type Answer = z.infer<typeof answerSchema>;
export const implementationReplySchema = z.strictObject({
  status: z.enum(['done', 'blocked', 'failed']),
  summary: z.string(),
});
export type ImplementationReply = z.infer<typeof implementationReplySchema>;
export const datasetSchema = z
  .array(
    z.strictObject({
      id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
      audience: z.enum(['dev', 'runtime']),
      question: z.string().trim().min(1),
      expect: answerSchema.refine(
        (a) => a.type !== 'exact' || a.value.trim().length > 0,
        'Empty expectation',
      ),
    }),
  )
  .min(1)
  .refine(
    (cases) => new Set(cases.map((c) => c.id)).size === cases.length,
    'Duplicate case IDs',
  );
export type EvalCase = z.infer<typeof datasetSchema>[number];
export const relativePathSchema = z
  .string()
  .min(1)
  .refine(
    (p) =>
      !p.startsWith('/') &&
      !p.startsWith('-') &&
      !/[\\\0\r\n]/.test(p) &&
      !p.split('/').some((c) => c === '..' || c === ''),
    'Expected safe relative POSIX path',
  );
const contexts = z.array(relativePathSchema).min(1);
export const manifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    sourceRef: z
      .string()
      .min(1)
      .refine(
        (ref) => !ref.startsWith('-') && !/[\0\r\n]/.test(ref),
        'Invalid source ref',
      ),
    skillDatasets: z
      .array(
        z.strictObject({
          path: relativePathSchema,
          contextRoots: z.strictObject({ dev: contexts, runtime: contexts }),
        }),
      )
      .min(1),
    benchmark: z.literal('tasks'),
    configurations: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
          adapter: z.enum(['scripted', 'codex-cli', 'cursor-cli']),
          authentication: z.enum(['api-key', 'local-login']).optional(),
          model: z
            .string()
            .min(1)
            .refine((m) => m !== 'auto', 'Explicit model required'),
          parameters: z.strictObject({
            reasoningEffort: z
              .enum(['none', 'low', 'medium', 'high', 'xhigh', 'max'])
              .optional(),
          }),
        }),
      )
      .min(1),
    budget: z.strictObject({
      maxInvocations: z.number().int().positive(),
      skillTimeoutMs: z.number().int().positive(),
      implementationTimeoutMs: z.number().int().positive(),
      totalTimeoutMs: z.number().int().positive(),
      maxCorrectionsPerItem: z.union([z.literal(0), z.literal(1)]),
      repetitions: z.literal(1),
      concurrency: z.literal(1),
    }),
  })
  .refine(
    (m) =>
      new Set(m.configurations.map((c) => c.id)).size ===
      m.configurations.length,
    'Duplicate configuration IDs',
  )
  .refine(
    (m) =>
      new Set(m.skillDatasets.map((d) => d.path)).size ===
      m.skillDatasets.length,
    'Duplicate datasets',
  );
export type RunManifest = z.infer<typeof manifestSchema>;
export type EvalConfiguration = RunManifest['configurations'][number];
export type AdapterId = EvalConfiguration['adapter'];
export type Measured<T> =
  | { status: 'available'; value: T; source: string }
  | { status: 'unavailable'; reason: string };
export const unavailable = <T>(reason = 'not_reported'): Measured<T> => ({
  status: 'unavailable',
  reason,
});
export const available = <T>(value: T, source: string): Measured<T> => ({
  status: 'available',
  value,
  source,
});
export interface Usage {
  inputTokens: Measured<number>;
  cachedInputTokens: Measured<number>;
  outputTokens: Measured<number>;
  cost: Measured<{ amount: number; currency: string }>;
}
export const emptyUsage = (): Usage => ({
  inputTokens: unavailable(),
  cachedInputTokens: unavailable(),
  outputTokens: unavailable(),
  cost: unavailable(),
});
export interface AdapterRequest {
  id: string;
  mode: 'skills' | 'implementation';
  cwd: string;
  prompt: string;
  timeoutMs: number;
  evidenceDir: string;
}
export interface AdapterInfo {
  id: AdapterId;
  version: string;
  executableSha256: string;
  companions?: { name: string; sha256: string }[];
}
export interface AdapterResult {
  transport: 'finished' | 'timeout' | 'cancelled' | 'infra_error';
  finalText: string | null;
  exitCode: number | null;
  signal: string | null;
  sessionId: Measured<string>;
  observedModel: Measured<string>;
  modelRevision: Measured<string>;
  usage: Usage;
  durationMs: number;
  evidence: string[];
  diagnostic: string | null;
}
export interface EvalAdapter {
  probe(): Promise<AdapterInfo>;
  run(
    request: AdapterRequest,
    options: { signal: AbortSignal },
  ): Promise<AdapterResult>;
}
export interface ProcessRequest {
  argv: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  timeoutMs: number;
  evidenceDir: string;
  secrets?: readonly string[];
}
export interface ProcessResult {
  transport: AdapterResult['transport'];
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  evidence: string[];
  diagnostic: string | null;
}
export interface PreparedSource {
  originRoot: string;
  commit: string;
  runnerCommit: string;
  fingerprint: string;
  root: string;
  snapshotRoot: string;
  frameworkRoot: string;
}
export interface AttemptWorkspace {
  root: string;
  configPath: string;
  baseline: string;
  frameworkRoot: string;
  mode: AdapterRequest['mode'];
}
export interface ContextBundle {
  root: string;
  files: { path: string; content: string }[];
  bundleSha256: string;
}
export type EvalVerdict =
  'correct' | 'incorrect' | 'malformed' | 'timeout' | 'infra_error' | 'not_run';
export interface CaseResult {
  configuration: string;
  dataset: string;
  datasetSha256: string;
  id: string;
  audience: 'dev' | 'runtime';
  question: string;
  expect: Answer;
  answer: Answer | null;
  verdict: EvalVerdict;
  reason: string | null;
  contextHash: string;
  execution: AdapterResult | null;
}
export interface AuditReport {
  ok: boolean;
  findings: string[];
  changedFiles: string[];
  patch: string;
}
export interface CommandEvidence {
  name: string;
  argv: readonly string[];
  result: ProcessResult;
}
export interface ItemHandoff {
  item: string;
  packet: string;
  specHash: string;
  configPath: string;
  testFile: string;
  criteria: { id: string; given?: string; when?: string; then: string }[];
}
export interface VerificationEvidence {
  ok: boolean;
  findings: string[];
  commands: CommandEvidence[];
  itemReport: ItemVerifyReport | null;
  executorTests: TestRun | null;
  referenceTests: TestRun | null;
}
export interface ItemAttempt {
  number: number;
  handoff: ItemHandoff;
  baselineHash: string;
  execution: AdapterResult;
  reply: ImplementationReply | null;
  audit: AuditReport | null;
  verification: VerificationEvidence | null;
  accepted: boolean;
  reason: string | null;
}
export interface ItemResult {
  item: string;
  specHash: string | null;
  state: 'accepted' | 'failed' | 'blocked' | 'infra_error' | 'not_run';
  reason: string | null;
  attempts: ItemAttempt[];
}
export interface BenchmarkResult {
  configuration: string;
  baselineHash: string | null;
  items: ItemResult[];
  finalVerification: {
    report: VerifyReport | null;
    command: CommandEvidence;
  } | null;
}
export interface RunControl {
  signal: AbortSignal;
  reserveInvocation(): boolean;
  stopReason(): 'budget_exhausted' | 'cancelled' | null;
  remainingMs(): number;
  invocations: number;
}
export interface RunOptions {
  outDir: string;
  real: boolean;
  signal: AbortSignal;
  control?: RunControl;
  onCase?: (result: CaseResult) => void;
  onBenchmark?: (result: BenchmarkResult) => void;
}
export interface Artifact {
  path: string;
  sha256: string;
  bytes: number;
}
export interface EvalReport {
  schemaVersion: 1;
  id: string;
  mode: 'real' | 'scripted';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: 'completed' | 'infra_error' | 'budget_exhausted' | 'cancelled';
  diagnostics: string[];
  manifest: RunManifest;
  manifestSha256: string;
  invocations: number;
  provenance: {
    sourceCommit: string;
    runnerCommit: string;
    platform: string;
    bun: string;
    originBefore: string;
    originAfter: Measured<string>;
    adapters: Record<string, AdapterInfo>;
  };
  cases: CaseResult[];
  benchmarks: BenchmarkResult[];
  artifacts: Artifact[];
  metrics?: EvalMetrics;
  redaction?: { applied: boolean; artifacts: string[]; marker: '[REDACTED]' };
}
