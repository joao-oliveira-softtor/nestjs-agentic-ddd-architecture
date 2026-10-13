import { expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  claudeArgv,
  claudeUsage,
  parseClaudeTranscript,
} from '../scripts/evals/adapters/claude';
import { manifestSchema } from '../scripts/evals/contracts';
import type {
  AdapterRequest,
  EvalConfiguration,
  ProcessResult,
} from '../scripts/evals/contracts';

const result = (stdout: string, exitCode = 0): ProcessResult => ({
  transport: 'finished',
  exitCode,
  signal: null,
  stdout,
  stderr: '',
  durationMs: 1,
  evidence: [],
  diagnostic: null,
});
const transcript = () =>
  Bun.file(
    join(import.meta.dir, 'fixtures/evals/transcripts/claude-success.ndjson'),
  ).text();
const configuration: EvalConfiguration = {
  id: 'claude-haiku',
  adapter: 'claude-cli',
  model: 'claude-haiku-5-5',
  parameters: { reasoningEffort: 'low' },
};
const request: AdapterRequest = {
  id: 'case',
  mode: 'skills',
  cwd: '/workspace',
  prompt: 'pergunta',
  timeoutMs: 1000,
  evidenceDir: '/evidence',
};

test('o manifesto aceita claude-cli e os manifestos congelados continuam válidos', async () => {
  const frozen = JSON.parse(
    await Bun.file(
      join(
        import.meta.dir,
        '../evals/campaigns/cycle-20/manifests/codex-sol-high-r1.json',
      ),
    ).text(),
  );
  expect(manifestSchema.safeParse(frozen).success).toBe(true);
  const claude = {
    ...frozen,
    configurations: [{ ...frozen.configurations[0], adapter: 'claude-cli' }],
  };
  expect(manifestSchema.safeParse(claude).success).toBe(true);
  expect(
    manifestSchema.safeParse({
      ...frozen,
      configurations: [{ ...frozen.configurations[0], adapter: 'outro' }],
    }).success,
  ).toBe(false);
});

test('argv: modelo e esforço explícitos, sem sessão, configuração de usuário nem MCP', () => {
  const argv = claudeArgv('/bin/claude', configuration, request);
  expect(argv[0]).toBe('/bin/claude');
  expect(argv.at(-1)).toBe('pergunta');
  const value = (flag: string) => argv[argv.indexOf(flag) + 1];
  expect(value('--model')).toBe('claude-haiku-5-5');
  expect(value('--effort')).toBe('low');
  expect(value('--output-format')).toBe('stream-json');
  expect(value('--setting-sources')).toBe('project');
  expect(argv).toContain('--verbose');
  expect(argv).toContain('--no-session-persistence');
  expect(argv).toContain('--strict-mcp-config');
  expect(argv).not.toContain('--dangerously-skip-permissions');
  expect(value('--permission-mode')).toBe('dontAsk');
});

test('argv: skills só lê; implementação edita e roda comandos; none não é suportado', () => {
  expect(
    claudeArgv('c', configuration, request)[
      claudeArgv('c', configuration, request).indexOf('--tools') + 1
    ],
  ).toBe('Read,Grep,Glob');
  const implementation = claudeArgv('c', configuration, {
    ...request,
    mode: 'implementation',
  });
  expect(implementation[implementation.indexOf('--tools') + 1]).toBe(
    'Read,Grep,Glob,Edit,Write,Bash',
  );
  expect(
    claudeArgv('c', { ...configuration, parameters: {} }, request),
  ).not.toContain('--effort');
  expect(() =>
    claudeArgv(
      'c',
      { ...configuration, parameters: { reasoningEffort: 'none' } },
      request,
    ),
  ).toThrow('not supported');
});

test('parse: texto final do result, uso medido, modelo servido e custo não adotado', async () => {
  const parsed = parseClaudeTranscript(result(await transcript()));
  expect(parsed.transport).toBe('finished');
  expect(parsed.finalText).toBe('{"type":"exact","value":"sim"}');
  expect(parsed.sessionId).toEqual({
    status: 'available',
    value: 'offline-claude-session',
    source: 'claude.result.session_id',
  });
  expect(parsed.observedModel).toEqual({
    status: 'available',
    value: 'claude-sonnet-offline',
    source: 'claude.result.modelUsage',
  });
  expect(parsed.usage.inputTokens).toMatchObject({
    status: 'available',
    value: 208,
  });
  expect(parsed.usage.cachedInputTokens).toMatchObject({
    status: 'available',
    value: 100,
  });
  expect(parsed.usage.outputTokens).toMatchObject({
    status: 'available',
    value: 21,
  });
  expect(parsed.usage.cost).toEqual({
    status: 'unavailable',
    reason: 'derived_cost_not_adopted',
  });
  expect(parsed.modelRevision.status).toBe('unavailable');
});

test('uso: parcela ausente ou inválida fica indisponível, nunca estimada', () => {
  const partial = claudeUsage(
    { input_tokens: 5, output_tokens: 7 },
    'claude.result.usage',
  );
  expect(partial.inputTokens).toEqual({
    status: 'unavailable',
    reason: 'input_token_parts_incomplete',
  });
  expect(partial.cachedInputTokens.status).toBe('unavailable');
  expect(partial.outputTokens.status).toBe('available');
  expect(
    claudeUsage({ input_tokens: -1, output_tokens: 1.5 }, 'x').outputTokens
      .status,
  ).toBe('unavailable');
  expect(claudeUsage(undefined, 'x').inputTokens.status).toBe('unavailable');
});

test('modelo: sem modelUsage cai no init; vários modelos ficam indisponíveis', async () => {
  const lines = (await transcript()).trim().split('\n');
  const withoutUsage = lines
    .map((line) => {
      const event = JSON.parse(line);
      if (event.type === 'result') delete event.modelUsage;
      return JSON.stringify(event);
    })
    .join('\n');
  expect(parseClaudeTranscript(result(withoutUsage)).observedModel).toEqual({
    status: 'available',
    value: 'claude-sonnet-offline',
    source: 'claude.init.model',
  });
  const many = lines
    .map((line) => {
      const event = JSON.parse(line);
      if (event.type === 'result') event.modelUsage = { a: {}, b: {} };
      return JSON.stringify(event);
    })
    .join('\n');
  expect(parseClaudeTranscript(result(many)).observedModel).toEqual({
    status: 'unavailable',
    reason: 'multiple_models_observed',
  });
});

test('falhas de transporte: sem result, erro nativo, evento após o fim, NDJSON inválido e saída não zero', async () => {
  const text = await transcript();
  const lines = text.trim().split('\n');
  const failed = (value: ProcessResult) => {
    const parsed = parseClaudeTranscript(value);
    expect(parsed.transport).toBe('infra_error');
    expect(parsed.finalText).toBeNull();
    return parsed;
  };
  failed(result('not json'));
  failed(result(text, 1));
  failed(result(lines.slice(0, -1).join('\n')));
  failed(
    result(
      lines
        .map((line) => {
          const event = JSON.parse(line);
          if (event.type === 'result') {
            event.is_error = true;
            event.subtype = 'error_during_execution';
          }
          return JSON.stringify(event);
        })
        .join('\n'),
    ),
  );
  failed(result(text + lines[1] + '\n'));
  failed(result(text + lines.at(-1) + '\n'));
  expect(failed(result(text, 1)).usage.inputTokens.status).toBe('available');
  expect(
    parseClaudeTranscript({
      ...result(text),
      transport: 'timeout',
      diagnostic: 'deadline_exceeded',
    }).transport,
  ).toBe('timeout');
});

test('adapter executa só um CLI falso no sandbox, com chave por variável e sem login local', async () => {
  const { mkdtemp, mkdir, writeFile, chmod, rm } =
    await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { frozenSource } = await import('./helpers/evals');
  const { createAttemptWorkspace } = await import('../scripts/evals/isolation');
  const { createClaudeAdapter } =
    await import('../scripts/evals/adapters/claude');
  const fixture = await frozenSource();
  const root = await mkdtemp(join(tmpdir(), 'eval-claude-stub-'));
  const baseline = join(fixture.source.root, 'stub-context');
  await mkdir(baseline);
  await writeFile(join(baseline, 'context.md'), 'private context');
  const workspace = await createAttemptWorkspace(
    fixture.source,
    baseline,
    'skills',
  );
  try {
    const executable = join(root, 'claude');
    const secret = 'offline-anthropic-secret-never-publish';
    await writeFile(
      executable,
      `#!/bin/sh\nif [ "$1" = '--version' ]; then echo 'offline-claude-1'; exit 0; fi\nif [ "$DISABLE_AUTOUPDATER" != 1 ] || [ -n "$CODEX_HOME" ]; then exit 23; fi\nif [ -e '${join(fixture.source.frameworkRoot, 'src/core/index.ts')}' ]; then exit 24; fi\nprintf '{"type":"system","subtype":"init","session_id":"s","model":"m","key":"%s"}\\n' "$ANTHROPIC_API_KEY"\ncat <<'SYNTHETIC_TRANSCRIPT'\n${await transcript()}SYNTHETIC_TRANSCRIPT\n`,
    );
    await chmod(executable, 0o700);
    const registered = new Set<string>();
    const options = {
      executable,
      credentials: { ANTHROPIC_API_KEY: secret },
      onSecrets: (values: readonly string[]) =>
        values.forEach((value) => registered.add(value)),
      probeEvidenceDir: join(root, 'probe'),
    };
    const run = (
      adapter: ReturnType<typeof createClaudeAdapter>,
      dir: string,
    ) =>
      adapter.run(
        {
          id: 'case',
          mode: 'skills',
          cwd: workspace.root,
          prompt: 'pergunta',
          timeoutMs: 5000,
          evidenceDir: dir,
        },
        { signal: new AbortController().signal },
      );
    const adapter = createClaudeAdapter(configuration, options);
    expect((await adapter.probe()).version).toBe('offline-claude-1');
    await mkdir(join(root, 'run'));
    const observed = await run(adapter, join(root, 'run'));
    expect(observed.transport).toBe('finished');
    expect(observed.finalText).toBe('{"type":"exact","value":"sim"}');
    expect(observed.usage.outputTokens.status).toBe('available');
    expect(registered.has(secret)).toBe(true);
    const evidence = await Promise.all(
      observed.evidence.map((path) => Bun.file(path).text()),
    );
    expect(evidence.join('\n')).not.toContain(secret);

    const missing = await run(
      createClaudeAdapter(configuration, {
        ...options,
        credentials: { ANTHROPIC_API_KEY: '' },
      }),
      join(root, 'must-not-exist'),
    );
    expect(missing.transport).toBe('infra_error');
    expect(missing.evidence).toEqual([]);

    const local = await run(
      createClaudeAdapter(
        { ...configuration, authentication: 'local-login' },
        options,
      ),
      join(root, 'must-not-exist-either'),
    );
    expect(local.transport).toBe('infra_error');
    expect(local.diagnostic).toContain('api-key');
    expect(
      await Bun.file(join(root, 'must-not-exist-either/process.json')).exists(),
    ).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
