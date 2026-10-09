import { z } from 'zod';
import {
  answerSchema,
  implementationReplySchema,
  manifestSchema,
  relativePathSchema,
} from './contracts';
const strings = z.array(z.string());
const number = z.number().finite().nonnegative();
const integer = number.int();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^[a-f0-9]{40,64}$/);
const measured = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion('status', [
    z.strictObject({
      status: z.literal('available'),
      value,
      source: z.string().min(1),
    }),
    z.strictObject({
      status: z.literal('unavailable'),
      reason: z.string().min(1),
    }),
  ]);
const usage = z.strictObject({
  inputTokens: measured(integer),
  cachedInputTokens: measured(integer),
  outputTokens: measured(integer),
  cost: measured(
    z.strictObject({ amount: number, currency: z.string().min(1) }),
  ),
});
const transport = z.enum(['finished', 'timeout', 'cancelled', 'infra_error']);
const processFields = {
  transport,
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  durationMs: number,
  evidence: z.array(relativePathSchema),
  diagnostic: z.string().nullable(),
};
const process = z.strictObject({
  ...processFields,
  stdout: z.string(),
  stderr: z.string(),
});
const adapter = z.strictObject({
  ...processFields,
  finalText: z.string().nullable(),
  sessionId: measured(z.string()),
  observedModel: measured(z.string()),
  modelRevision: measured(z.string()),
  usage,
});
const command = z.strictObject({
  name: z.string(),
  argv: strings,
  result: process,
});
const finding = z.strictObject({
  message: z.string(),
  fix: z.string().nullable(),
  source: z.string().nullable(),
});
const gate = z.strictObject({
  id: z.enum([
    'G1',
    'G2',
    'G3',
    'G4',
    'G5',
    'G6',
    'G7',
    'I1',
    'I2',
    'I3',
    'I4',
    'I5',
  ]),
  name: z.string(),
  status: z.enum(['passed', 'failed', 'pending']),
  findings: z.array(finding),
  warnings: z.array(finding),
});
const itemReport = z.strictObject({
  item: z.string(),
  status: z.enum(['done', 'failed']),
  gates: z.array(gate),
});
export const changeReportSchema = z.strictObject({
  change: z.string(),
  title: z.string(),
  status: z.enum(['done', 'needs-human', 'failed']),
  gates: z.array(gate),
});
const tests = z.strictObject({
  exitCode: z.number().int(),
  cases: z.array(
    z.strictObject({
      name: z.string(),
      file: z.string(),
      line: integer,
      status: z.enum(['passed', 'failed', 'skipped']),
      covers: strings,
    }),
  ),
  collectionError: z.string().optional(),
  emptySuite: z.boolean().optional(),
});
const verification = z.strictObject({
  ok: z.boolean(),
  findings: strings,
  commands: z.array(command),
  itemReport: itemReport.nullable(),
  executorTests: tests.nullable(),
  referenceTests: tests.nullable(),
});
const audit = z.strictObject({
  ok: z.boolean(),
  findings: strings,
  changedFiles: strings,
  patch: z.string(),
});
const criterion = z.strictObject({
  id: z.string(),
  given: z.string().optional(),
  when: z.string().optional(),
  // eslint-disable-next-line unicorn/no-thenable
  then: z.string(),
});
const handoff = z.strictObject({
  item: z.string(),
  packet: z.string(),
  specHash: hash,
  configPath: z.string(),
  testFile: relativePathSchema,
  criteria: z.array(criterion),
});
const attempt = z.strictObject({
  number: integer.positive(),
  handoff,
  baselineHash: hash,
  execution: adapter,
  reply: implementationReplySchema.nullable(),
  audit: audit.nullable(),
  verification: verification.nullable(),
  accepted: z.boolean(),
  reason: z.string().nullable(),
});
const item = z.strictObject({
  item: z.string(),
  specHash: hash.nullable(),
  state: z.enum(['accepted', 'failed', 'blocked', 'infra_error', 'not_run']),
  reason: z.string().nullable(),
  attempts: z.array(attempt),
});
const benchmark = z.strictObject({
  configuration: z.string(),
  baselineHash: hash.nullable(),
  items: z.array(item).length(5),
  finalVerification: z
    .strictObject({ report: changeReportSchema.nullable(), command })
    .nullable(),
});
const cases = z.strictObject({
  configuration: z.string(),
  dataset: relativePathSchema,
  datasetSha256: hash,
  id: z.string(),
  audience: z.enum(['dev', 'runtime']),
  question: z.string(),
  expect: answerSchema,
  answer: answerSchema.nullable(),
  verdict: z.enum([
    'correct',
    'incorrect',
    'malformed',
    'timeout',
    'infra_error',
    'not_run',
  ]),
  reason: z.string().nullable(),
  contextHash: hash,
  execution: adapter.nullable(),
});
const rate = z.strictObject({
  numerator: integer,
  denominator: integer,
  value: measured(number),
});
const metrics = z.strictObject({
  skills: z.array(
    z.strictObject({
      configuration: z.string(),
      dataset: z.string().nullable(),
      audience: z.string().nullable(),
      planned: integer,
      evaluable: integer,
      infrastructure: integer,
      notRun: integer,
      accuracy: rate,
      coverage: rate,
    }),
  ),
  benchmarks: z.array(
    z.strictObject({
      configuration: z.string(),
      initial: rate,
      final: rate,
      corrections: integer,
      completion: measured(z.string()),
      agentDurationMs: number,
      verificationDurationMs: number,
    }),
  ),
  agreements: z.array(
    z.strictObject({
      configurations: z.tuple([z.string(), z.string()]),
      agreement: rate,
      coverage: rate,
    }),
  ),
  kappa: z.strictObject({
    value: measured(z.number().finite()),
    completeRows: integer,
    plannedRows: integer,
    raters: integer,
    coverage: rate,
  }),
  usage: z.record(z.string(), usage),
});
export const reportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  mode: z.enum(['real', 'scripted']),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  durationMs: number,
  status: z.enum(['completed', 'infra_error', 'budget_exhausted', 'cancelled']),
  diagnostics: strings,
  manifest: manifestSchema,
  manifestSha256: hash,
  invocations: integer,
  provenance: z.strictObject({
    sourceCommit: commit,
    runnerCommit: commit,
    platform: z.string(),
    bun: z.string(),
    originBefore: hash,
    originAfter: measured(hash),
    nativeToolAccess: z
      .strictObject({
        sourceTrustAcknowledged: z.literal(true),
        credentials: z.literal('accessible'),
        network: z.literal('host'),
      })
      .optional(),
    adapters: z.record(
      z.string(),
      z.strictObject({
        id: z.enum(['scripted', 'codex-cli', 'cursor-cli']),
        version: z.string(),
        executableSha256: hash,
        companions: z
          .array(z.strictObject({ name: z.string(), sha256: hash }))
          .optional(),
      }),
    ),
  }),
  cases: z.array(cases),
  benchmarks: z.array(benchmark),
  artifacts: z.array(
    z.strictObject({ path: relativePathSchema, sha256: hash, bytes: integer }),
  ),
  metrics,
  redaction: z.strictObject({
    applied: z.boolean(),
    artifacts: strings,
    marker: z.literal('[REDACTED]'),
  }),
});
