import { expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  claudeArgv,
  claudeToolFlags,
  claudeRequests,
  claudeUsage,
  parseClaudeTranscript,
  reconcileRequests,
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
/** Eventos do smoke real de 2026-10-14 (Haiku, entity:Task), sem o conteúdo das mensagens. */
const haikuTranscript = () =>
  Bun.file(
    join(
      import.meta.dir,
      'fixtures/evals/transcripts/claude-haiku-requests.ndjson',
    ),
  ).text();
const HAIKU = 'claude-haiku-5-5';
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
  const withConfiguration = (patch: Record<string, unknown>) => ({
    ...frozen,
    configurations: [{ ...frozen.configurations[0], ...patch }],
  });
  for (const authentication of ['api-key', 'oauth-token'])
    expect(
      manifestSchema.safeParse(
        withConfiguration({ adapter: 'claude-cli', authentication }),
      ).success,
    ).toBe(true);
  expect(
    manifestSchema.safeParse(withConfiguration({ adapter: 'outro' })).success,
  ).toBe(false);
});

test('manifesto: oauth-token só no claude-cli e claude-cli sem local-login', async () => {
  const frozen = JSON.parse(
    await Bun.file(
      join(
        import.meta.dir,
        '../evals/campaigns/cycle-20/manifests/codex-sol-high-r1.json',
      ),
    ).text(),
  );
  const parse = (patch: Record<string, unknown>) =>
    manifestSchema.safeParse({
      ...frozen,
      configurations: [{ ...frozen.configurations[0], ...patch }],
    });
  const local = parse({ adapter: 'claude-cli', authentication: 'local-login' });
  expect(local.success).toBe(false);
  expect(JSON.stringify(local.error?.issues)).toContain('local-login');
  for (const adapter of ['codex-cli', 'cursor-cli', 'scripted']) {
    const oauth = parse({ adapter, authentication: 'oauth-token' });
    expect(oauth.success).toBe(false);
    expect(JSON.stringify(oauth.error?.issues)).toContain('claude-cli');
  }
});

test('smoke do roteamento: o manifesto é válido e o teto de 3 invocações reserva a última para a revisão', async () => {
  const manifest = manifestSchema.parse(
    JSON.parse(
      await Bun.file(
        join(import.meta.dir, '../evals/run.smoke-routing.json'),
      ).text(),
    ),
  );
  const [configuration] = manifest.configurations;
  expect(manifest.skillDatasets).toEqual([]);
  expect(configuration).toMatchObject({
    adapter: 'claude-cli',
    authentication: 'oauth-token',
    model: 'claude-haiku-5-5',
    promptMode: 'brief',
  });
  expect(configuration!.routing).toEqual({
    byLayer: {
      domain: 'claude-haiku-5-5',
      application: 'claude-sonnet-5-5',
      operators: 'claude-sonnet-5-5',
    },
    ladder: [
      { model: 'claude-haiku-5-5' },
      { model: 'claude-sonnet-5-5', reasoningEffort: 'medium' },
    ],
    reviewer: { model: 'claude-opus-5-5', reasoningEffort: 'low' },
  });
  // 3 invocações: 2 para itens (o domínio no Haiku e um item no Sonnet) e 1 reservada à revisão.
  expect(manifest.budget).toMatchObject({
    maxInvocations: 3,
    maxCorrectionsPerItem: 0,
    implementationTimeoutMs: 600000,
    // 3 × 10 min de invocação + 60 min de folga para baseline, status, next e verify.
    totalTimeoutMs: (3 * 10 + 60) * 60_000,
  });
});

test('smoke: o manifesto e o dataset de um caso são válidos e cabem no teto de 2 invocações', async () => {
  const { loadDataset } = await import('../scripts/evals/dataset');
  const manifest = manifestSchema.parse(
    JSON.parse(
      await Bun.file(
        join(import.meta.dir, '../evals/run.smoke-oauth.json'),
      ).text(),
    ),
  );
  expect(manifest.configurations).toEqual([
    expect.objectContaining({
      adapter: 'claude-cli',
      authentication: 'oauth-token',
      model: 'claude-haiku-5-5',
    }),
  ]);
  expect(manifest.budget.maxInvocations).toBe(2);
  expect(manifest.budget.maxCorrectionsPerItem).toBe(0);
  const cases = await loadDataset(
    join(import.meta.dir, '..', manifest.skillDatasets[0]!.path),
  );
  expect(cases.map((c) => c.id)).toEqual(['confirmar-pedido']);
});

test('auth: apiKeySource do init é registrado; origem de chave de API reprova o oauth-token', async () => {
  const init = (source: string) =>
    `${JSON.stringify({ type: 'system', subtype: 'init', session_id: 'offline-claude-session', model: 'claude-haiku-5-5', apiKeySource: source })}\n`;
  const body = (await transcript())
    .split('\n')
    .filter((line) => line && JSON.parse(line).subtype !== 'init')
    .join('\n');
  const oauth = { authentication: 'oauth-token' as const };
  const subscription = parseClaudeTranscript(
    result(`${init('none')}${body}\n`),
    oauth,
  );
  expect(subscription.transport).toBe('finished');
  expect(subscription.authSource).toEqual({
    status: 'available',
    value: 'none',
    source: 'claude.init.apiKeySource',
  });
  for (const source of [
    'ANTHROPIC_API_KEY',
    'apiKeyHelper',
    '/login managed key',
    'user',
  ]) {
    const billed = parseClaudeTranscript(
      result(`${init(source)}${body}\n`),
      oauth,
    );
    expect(billed.transport).toBe('infra_error');
    expect(billed.finalText).toBeNull();
    expect(billed.diagnostic).toContain('auth_source_mismatch');
    // Com chave de API declarada, a mesma origem é a esperada.
    expect(
      parseClaudeTranscript(result(`${init(source)}${body}\n`), {
        authentication: 'api-key',
      }).transport,
    ).toBe('finished');
  }
});

test('argv: opções variádicas só na forma =, para não engolir o prompt, que vem depois de --', () => {
  const variadic = ['--tools', '--allowed-tools', '--allowedTools'];
  for (const mode of ['skills', 'implementation'] as const) {
    const argv = claudeArgv('c', configuration, { ...request, mode });
    for (const name of variadic) expect(argv).not.toContain(name);
    expect(argv.slice(-2)).toEqual(['--', 'pergunta']);
  }
  expect(claudeToolFlags([])).toEqual(['--tools=']);
  expect(claudeToolFlags(['Read'])).toEqual([
    '--tools=Read',
    '--allowed-tools=Read',
  ]);
});

test('argv: modelo e esforço explícitos, sem sessão, configuração de usuário nem MCP', () => {
  const argv = claudeArgv('/bin/claude', configuration, request);
  expect(argv[0]).toBe('/bin/claude');
  expect(argv.slice(-2)).toEqual(['--', 'pergunta']);
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
  const flag = (argv: string[], name: string) =>
    argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  const skills = claudeArgv('c', configuration, request);
  expect(flag(skills, '--tools')).toBe('Read,Grep,Glob');
  expect(flag(skills, '--allowed-tools')).toBe('Read,Grep,Glob');
  const implementation = claudeArgv('c', configuration, {
    ...request,
    mode: 'implementation',
  });
  expect(flag(implementation, '--tools')).toBe(
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

test('uso: soma modelUsage de todos os modelos e ignora o usage de nível superior', async () => {
  const parsed = parseClaudeTranscript(result(await transcript()));
  // O usage de nível superior da fixture é só do laço principal (5 + 100 de entrada, 12 de saída).
  expect(parsed.usage.inputTokens).toMatchObject({
    status: 'available',
    value: 208,
  });
  const many = claudeUsage(
    {
      a: {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadInputTokens: 3,
        cacheCreationInputTokens: 4,
      },
      b: {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadInputTokens: 30,
        cacheCreationInputTokens: 40,
      },
    },
    'claude.result.modelUsage',
  );
  expect(many.inputTokens).toEqual({
    status: 'available',
    value: 88,
    source:
      'claude.result.modelUsage.*.inputTokens+cacheCreationInputTokens+cacheReadInputTokens',
  });
  expect(many.cachedInputTokens).toMatchObject({ value: 33 });
  expect(many.outputTokens).toMatchObject({ value: 22 });
});

test('uso: modelUsage ausente, parcela faltando ou inválida fica indisponível, nunca estimada', () => {
  expect(claudeUsage(undefined, 'x').inputTokens).toEqual({
    status: 'unavailable',
    reason: 'model_usage_missing',
  });
  expect(claudeUsage({}, 'x').outputTokens.status).toBe('unavailable');
  const partial = claudeUsage({ a: { inputTokens: 5, outputTokens: 7 } }, 'x');
  expect(partial.inputTokens).toEqual({
    status: 'unavailable',
    reason: 'model_usage_incomplete',
  });
  expect(partial.cachedInputTokens.status).toBe('unavailable');
  expect(partial.outputTokens.status).toBe('available');
  // Um modelo incompleto invalida a soma inteira.
  const mixed = claudeUsage(
    {
      a: { outputTokens: 1 },
      b: { outputTokens: -1 },
    },
    'x',
  );
  expect(mixed.outputTokens.status).toBe('unavailable');
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

test('adapter com oauth-token: só o token no ambiente do sandbox, redigido, e sem token o run nem começa', async () => {
  const { mkdtemp, mkdir, writeFile, chmod, rm } =
    await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { frozenSource } = await import('./helpers/evals');
  const { createAttemptWorkspace } = await import('../scripts/evals/isolation');
  const { createClaudeAdapter } =
    await import('../scripts/evals/adapters/claude');
  const fixture = await frozenSource();
  const root = await mkdtemp(join(tmpdir(), 'eval-claude-oauth-'));
  const baseline = join(fixture.source.root, 'oauth-context');
  await mkdir(baseline);
  await writeFile(join(baseline, 'context.md'), 'private context');
  const workspace = await createAttemptWorkspace(
    fixture.source,
    baseline,
    'skills',
  );
  try {
    const executable = join(root, 'claude');
    const token = 'offline-oauth-token-never-publish';
    // Sai com 25 se uma chave de API chegar ao processo; ecoa o token para provar a redação.
    await writeFile(
      executable,
      `#!/bin/sh\nif [ "$1" = '--version' ]; then echo 'offline-claude-1'; exit 0; fi\nif [ -n "$ANTHROPIC_API_KEY" ]; then exit 25; fi\nprintf '{"type":"system","subtype":"init","session_id":"offline-claude-session","model":"m","apiKeySource":"none","key":"%s"}\\n' "$CLAUDE_CODE_OAUTH_TOKEN"\ncat <<'SYNTHETIC_TRANSCRIPT'\n${(
        await transcript()
      )
        .split('\n')
        .filter((line) => line && JSON.parse(line).subtype !== 'init')
        .join('\n')}\nSYNTHETIC_TRANSCRIPT\n`,
    );
    await chmod(executable, 0o700);
    const registered = new Set<string>();
    const options = {
      executable,
      credentials: {
        CLAUDE_CODE_OAUTH_TOKEN: token,
        ANTHROPIC_API_KEY: 'offline-key-must-not-reach-the-cli',
      },
      onSecrets: (values: readonly string[]) =>
        values.forEach((value) => registered.add(value)),
      probeEvidenceDir: join(root, 'probe'),
    };
    const oauth = { ...configuration, authentication: 'oauth-token' as const };
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
    await mkdir(join(root, 'run'));
    const observed = await run(
      createClaudeAdapter(oauth, options),
      join(root, 'run'),
    );
    expect(observed.transport).toBe('finished');
    expect(observed.authSource).toEqual({
      status: 'available',
      value: 'none',
      source: 'claude.init.apiKeySource',
    });
    expect(registered.has(token)).toBe(true);
    const evidence = await Promise.all(
      observed.evidence.map((path) => Bun.file(path).text()),
    );
    expect(evidence.join('\n')).not.toContain(token);
    expect(evidence.join('\n')).toContain('[REDACTED]');

    const missing = await run(
      createClaudeAdapter(oauth, {
        ...options,
        credentials: { CLAUDE_CODE_OAUTH_TOKEN: '' },
      }),
      join(root, 'must-not-exist'),
    );
    expect(missing.transport).toBe('infra_error');
    expect(missing.diagnostic).toBe('Missing external CLAUDE_CODE_OAUTH_TOKEN');
    expect(missing.evidence).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

test('adapters sem token de assinatura recusam oauth-token antes de executar', async () => {
  const { createCodexAdapter } =
    await import('../scripts/evals/adapters/codex');
  const outcome = await createCodexAdapter(
    {
      id: 'codex',
      adapter: 'codex-cli',
      authentication: 'oauth-token',
      model: 'gpt',
      parameters: {},
    },
    { executable: '/bin/false', credentials: { CODEX_API_KEY: 'k' } },
  ).run(request, { signal: new AbortController().signal });
  expect(outcome.transport).toBe('infra_error');
  expect(outcome.diagnostic).toContain('does not support oauth-token');
});

test('requests: entrada por requisição deduplicada por message.id bate com modelUsage; saída só do modelUsage', async () => {
  const stdout = await haikuTranscript();
  const assistantEvents = stdout
    .split('\n')
    .filter((l) => l.includes('"type":"assistant"')).length;
  const parsed = parseClaudeTranscript(result(stdout));
  expect(parsed.transport).toBe('finished');
  const requests = parsed.usage.requests!;
  // 29 eventos assistant de 15 requisições: os parciais repetem o mesmo id.
  expect(assistantEvents).toBe(29);
  expect(requests.items).toHaveLength(15);
  expect(requests.status).toBe('reconciled');
  expect(requests.residual).toEqual({});
  const total = (
    key:
      'uncachedInputTokens' | 'cacheWriteInputTokens' | 'cacheReadInputTokens',
  ) => requests.items.reduce((n, i) => n + i[key], 0);
  expect([
    total('uncachedInputTokens'),
    total('cacheWriteInputTokens'),
    total('cacheReadInputTokens'),
  ]).toEqual([30, 26670, 308730]);
  // A escrita de cache do smoke foi toda de 1 h.
  expect(
    requests.items.every(
      (i) => i.cacheWrite1hInputTokens === i.cacheWriteInputTokens,
    ),
  ).toBe(true);
  expect(
    Math.max(
      ...requests.items.map(
        (i) =>
          i.uncachedInputTokens +
          i.cacheWriteInputTokens +
          i.cacheReadInputTokens,
      ),
    ),
  ).toBe(31_665);
  expect(parsed.usage.byModel).toEqual({
    [HAIKU]: {
      uncachedInputTokens: 30,
      cacheWriteInputTokens: 26670,
      cacheReadInputTokens: 308730,
      outputTokens: 9393,
      reportedCostUSD: 0.013120799999999998,
    },
  });
  expect(parsed.usage.cacheWriteInputTokens).toMatchObject({ value: 26670 });
  expect(parsed.usage.inputTokens).toMatchObject({
    value: 30 + 26670 + 308730,
  });
  expect(parsed.numTurns).toMatchObject({ status: 'available', value: 15 });
});

test('requests: chamada auxiliar sem evento assistant vira resíduo positivo; leitura a mais, negativo', async () => {
  const stdout = await haikuTranscript();
  const lines = stdout.trim().split('\n');
  const last = JSON.parse(lines.at(-1)!) as {
    modelUsage: Record<string, Record<string, number>>;
  };
  last.modelUsage[HAIKU]!.inputTokens! += 10;
  last.modelUsage['claude-aux'] = {
    inputTokens: 5,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 7,
    outputTokens: 3,
  };
  const parsed = parseClaudeTranscript(
    result([...lines.slice(0, -1), JSON.stringify(last)].join('\n') + '\n'),
  );
  expect(parsed.usage.requests).toMatchObject({
    status: 'residual',
    residual: {
      [HAIKU]: {
        uncachedInputTokens: 10,
        cacheWriteInputTokens: 0,
        cacheReadInputTokens: 0,
      },
      'claude-aux': {
        uncachedInputTokens: 5,
        cacheWriteInputTokens: 0,
        cacheReadInputTokens: 7,
      },
    },
  });
  const items = parsed.usage.requests!.items;
  expect(
    reconcileRequests(items, {
      [HAIKU]: { ...parsed.usage.byModel![HAIKU]!, uncachedInputTokens: 0 },
    }).residual[HAIKU]!.uncachedInputTokens,
  ).toBe(-30);
});

test('requests: timeout com stdout truncado mede a entrada já recebida, sem reconciliar nem saída', async () => {
  const stdout = await haikuTranscript();
  const cut = stdout.lastIndexOf('"type":"assistant"');
  const parsed = parseClaudeTranscript({
    ...result(stdout.slice(0, cut + 40)),
    transport: 'timeout',
    exitCode: null,
  });
  expect(parsed.transport).toBe('timeout');
  expect(parsed.finalText).toBeNull();
  expect(parsed.usage.requests!.status).toBe('unreconciled');
  // A última requisição ficou cortada no meio da linha e não entra.
  expect(parsed.usage.requests!.items).toHaveLength(14);
  expect(parsed.usage.byModel).toBeUndefined();
  expect(parsed.usage.outputTokens.status).toBe('unavailable');
  expect(parsed.numTurns).toBeUndefined();
});

const assistantEvent = (id: string, input: number, extra: object = {}) =>
  JSON.stringify({
    type: 'assistant',
    message: {
      id,
      model: 'claude-haiku-5-5',
      usage: {
        input_tokens: input,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        ...extra,
      },
    },
  });

test('requests: com o mesmo id vale o último evento, mesmo com entrada diferente', () => {
  const items = claudeRequests(
    [
      assistantEvent('a', 10),
      assistantEvent('a', 20),
      assistantEvent('b', 5),
    ].join('\n'),
  );
  expect(items.map((i) => i.uncachedInputTokens)).toEqual([20, 5]);
});

test('requests: escrita de 1 h maior que a escrita total é TTL desconhecido, nunca preço negativo', () => {
  const [item] = claudeRequests(
    assistantEvent('a', 0, {
      cache_creation_input_tokens: 1000,
      cache_creation: { ephemeral_1h_input_tokens: 2000 },
    }),
  );
  expect(item!.cacheWrite1hInputTokens).toBeNull();
  const [ok] = claudeRequests(
    assistantEvent('b', 0, {
      cache_creation_input_tokens: 1000,
      cache_creation: { ephemeral_1h_input_tokens: 400 },
    }),
  );
  expect(ok!.cacheWrite1hInputTokens).toBe(400);
});
