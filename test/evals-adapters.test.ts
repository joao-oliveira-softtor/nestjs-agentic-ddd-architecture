import { expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  parseCodexTranscript,
  codexArgv,
} from '../scripts/evals/adapters/codex';
import {
  parseCursorTranscript,
  cursorArgv,
} from '../scripts/evals/adapters/cursor';
import type {
  ProcessResult,
  AdapterRequest,
  EvalConfiguration,
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
const read = (name: string) =>
  Bun.file(
    join(import.meta.dir, 'fixtures/evals/transcripts', name + '.ndjson'),
  ).text();
test('failed processes retain native measurements without accepting the final answer', async () => {
  const codex = parseCodexTranscript(result(await read('codex-success'), 1));
  expect(codex.transport).toBe('infra_error');
  expect(codex.finalText).toBeNull();
  expect(codex.usage.inputTokens.status).toBe('available');
  const cursor = parseCursorTranscript({
    ...result(await read('cursor-success')),
    transport: 'timeout',
  });
  expect(cursor.transport).toBe('timeout');
  expect(cursor.finalText).toBeNull();
  expect(cursor.observedModel.status).toBe('available');
});
test('Codex final assistant independent from progress, native tokens preserved, model/cost unavailable', async () => {
  const parsed = parseCodexTranscript(result(await read('codex-success')));
  expect(parsed.transport).toBe('finished');
  expect(parsed.finalText).toBe('{"type":"exact","value":"sim"}');
  expect(parsed.sessionId.status).toBe('available');
  expect(parsed.usage.inputTokens).toEqual({
    status: 'available',
    value: 240,
    source: 'codex.turn.completed.usage.input_tokens',
  });
  expect(parsed.observedModel.status).toBe('unavailable');
  expect(parsed.modelRevision.status).toBe('unavailable');
  expect(parsed.usage.cost.status).toBe('unavailable');
});
test('Cursor final full assistant independent of concatenated terminal result; observed model preserved', async () => {
  const parsed = parseCursorTranscript(result(await read('cursor-success')));
  expect(parsed.transport).toBe('finished');
  expect(parsed.finalText).toBe('{"type":"exact","value":"sim"}');
  expect(parsed.observedModel).toEqual({
    status: 'available',
    value: 'Observed model display',
    source: 'cursor.init.model',
  });
  expect(parsed.usage.inputTokens.status).toBe('unavailable');
});
test('missing terminal, native errors, malformed NDJSON and nonzero exit are infrastructure', async () => {
  const codex = await read('codex-success'),
    cursor = await read('cursor-success');
  for (const [parse, text] of [
    [parseCodexTranscript, codex],
    [parseCursorTranscript, cursor],
  ] as const) {
    expect(parse(result('not json')).transport).toBe('infra_error');
    expect(parse(result(text, 1)).transport).toBe('infra_error');
    expect(
      parse(result(text.trim().split('\n').slice(0, -1).join('\n'))).transport,
    ).toBe('infra_error');
    expect(
      parse({
        ...result(text),
        transport: 'timeout',
        diagnostic: 'deadline_exceeded',
      }).transport,
    ).toBe('timeout');
  }
  expect(
    parseCodexTranscript(
      result('{"type":"turn.failed","error":{"message":"quota"}}'),
    ).transport,
  ).toBe('infra_error');
  expect(
    parseCursorTranscript(
      result('{"type":"result","subtype":"error","is_error":true}'),
    ).transport,
  ).toBe('infra_error');
});
test('malformed final agent JSON remains successful transport; partial usage does not invent missing fields', () => {
  const native =
    '{ "type":"item.completed","item":{"type":"agent_message","text":"malformed answer"}}\n{"type":"turn.completed","usage":{"input_tokens":7}}';
  const parsed = parseCodexTranscript(result(native));
  expect(parsed.transport).toBe('finished');
  expect(parsed.finalText).toBe('malformed answer');
  expect(parsed.usage.inputTokens.status).toBe('available');
  expect(parsed.usage.outputTokens.status).toBe('unavailable');
});
test('explicit argv selects model/effort and mode; no schema advantage, delegation, resume or credential argv', () => {
  const request: AdapterRequest = {
    id: 'question',
    mode: 'skills',
    cwd: '/private/assigned',
    prompt: 'question',
    timeoutMs: 100,
    evidenceDir: '/external/evidence',
  };
  const config: EvalConfiguration = {
    id: 'codex',
    adapter: 'codex-cli',
    model: 'gpt-6.1-sol',
    parameters: { reasoningEffort: 'high' },
  };
  const codex = codexArgv('/tools/codex', config, request);
  expect(codex).toContain('--ignore-user-config');
  expect(codex).toContain('--ignore-rules');
  expect(codex).toContain('features.multi_agent=false');
  expect(codex).toContain('model_reasoning_effort="high"');
  expect(codex).toContain('gpt-6.1-sol');
  expect(codex).not.toContain('--output-schema');
  expect(codex).not.toContain('resume');
  const cursor = cursorArgv(
    '/tools/cursor',
    {
      ...config,
      adapter: 'cursor-cli',
      model: 'gpt-5.3-codex',
      parameters: {},
    },
    request,
  );
  expect(cursor).toContain('ask');
  expect(cursor).not.toContain('--stream-partial-output');
  expect(cursor).not.toContain('--api-key');
  expect(
    cursorArgv(
      '/tools/cursor',
      { ...config, adapter: 'cursor-cli', parameters: {} },
      { ...request, mode: 'implementation' },
    ),
  ).toContain('--force');
});

test('complete native adapters execute only offline stub CLIs in private homes and redact injected secrets', async () => {
  const { mkdtemp, mkdir, writeFile, chmod, readFile, readdir, rm } =
    await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { frozenSource } = await import('./helpers/evals');
  const { createAttemptWorkspace, disposeWorkspace } =
    await import('../scripts/evals/isolation');
  const { createCodexAdapter } =
    await import('../scripts/evals/adapters/codex');
  const { createCursorAdapter } =
    await import('../scripts/evals/adapters/cursor');
  const fixture = await frozenSource();
  const root = await mkdtemp(join(tmpdir(), 'eval-native-stub-'));
  const baseline = join(fixture.source.root, 'stub-context');
  await mkdir(baseline);
  await writeFile(join(baseline, 'context.md'), 'private context');
  const workspace = await createAttemptWorkspace(
    fixture.source,
    baseline,
    'skills',
  );
  try {
    for (const authentication of ['api-key', 'local-login'] as const)
      for (const kind of ['codex', 'cursor'] as const) {
        const executable = join(root, kind);
        const transcript = await read(kind + '-success');
        const variable = kind === 'codex' ? 'CODEX_API_KEY' : 'CURSOR_API_KEY';
        const secret = 'offline-secret-never-publish';
        const loginFile = join(root, `${kind}-auth.json`);
        const loginBytes = JSON.stringify(
          kind === 'codex'
            ? {
                auth_mode: 'chatgpt',
                tokens: { access_token: secret, refresh_token: secret },
                last_refresh: '2026-10-09T00:00:00Z',
              }
            : { accessToken: secret, refreshToken: secret },
        );
        await writeFile(loginFile, loginBytes, { mode: 0o600 });
        const authPath =
          kind === 'codex'
            ? '$CODEX_HOME/auth.json'
            : '$HOME/.config/cursor/auth.json';
        const script =
          `#!/bin/sh\nif [ "$1" = '--version' ]; then echo 'offline-stub-1'; exit 0; fi\nif [ -e '${join(fixture.source.frameworkRoot, 'src/core/index.ts')}' ]; then exit 23; fi\nprintf '{"type":"offline_env","home":"%s","key":"%s"}\\n' "$HOME" "$${variable}"\ncat <<'SYNTHETIC_TRANSCRIPT'\n${transcript}SYNTHETIC_TRANSCRIPT\n` +
          (authentication === 'local-login'
            ? `test -f "${authPath}" || exit 24\ncat "${authPath}" >&2\n`
            : '') +
          (kind === 'codex'
            ? `mkdir -p "$CODEX_HOME/sessions"\ncat > "$CODEX_HOME/sessions/offline.jsonl" <<'SYNTHETIC_MODEL'\n{"type":"session_meta","payload":{"id":"offline-codex-session"}}\n{"type":"turn_context","payload":{"model":"actually-observed"}}\nSYNTHETIC_MODEL\n`
            : '');
        await writeFile(executable, script);
        await chmod(executable, 0o700);
        const options = {
          executable,
          credentials: { [variable]: secret },
          localLoginFile: loginFile,
          probeEvidenceDir: join(root, kind + '-probe'),
        };
        const configuration: EvalConfiguration = {
          id: kind,
          adapter: kind === 'codex' ? 'codex-cli' : 'cursor-cli',
          model: 'explicit-requested-model',
          parameters: {},
          authentication,
        };
        const adapter =
          kind === 'codex'
            ? createCodexAdapter(configuration, options)
            : createCursorAdapter(configuration, options);
        expect((await adapter.probe()).version).toBe('offline-stub-1');
        const evidenceDir = join(root, kind + '-run');
        const observed = await adapter.run(
          {
            id: 'case',
            mode: 'skills',
            cwd: workspace.root,
            prompt: 'question',
            timeoutMs: 2000,
            evidenceDir,
          },
          { signal: new AbortController().signal },
        );
        expect(observed.transport).toBe('finished');
        if (authentication === 'api-key') {
          const missing = (
            kind === 'codex' ? createCodexAdapter : createCursorAdapter
          )(configuration, { ...options, credentials: { [variable]: '' } });
          const rejected = await missing.run(
            {
              id: 'missing',
              mode: 'skills',
              cwd: workspace.root,
              prompt: 'must not dispatch',
              timeoutMs: 2000,
              evidenceDir: join(root, 'must-not-exist'),
            },
            { signal: new AbortController().signal },
          );
          expect(rejected.transport).toBe('infra_error');
          expect(rejected.evidence).toEqual([]);
          expect(
            await Bun.file(join(root, 'must-not-exist/process.json')).exists(),
          ).toBe(false);
        }
        expect(observed.finalText).toBe('{"type":"exact","value":"sim"}');
        expect(observed.observedModel).toEqual({
          status: 'available',
          value:
            kind === 'codex' ? 'actually-observed' : 'Observed model display',
          source:
            kind === 'codex'
              ? 'codex.rollout.turn_context.model'
              : 'cursor.init.model',
        });
        const stdout = await readFile(join(evidenceDir, 'stdout.log'), 'utf8');
        expect(stdout).toContain('"home":"/home/eval"');
        if (authentication === 'api-key')
          expect(stdout).toContain('[REDACTED]');
        expect(stdout).not.toContain(secret);
        expect(
          await readFile(join(evidenceDir, 'process.json'), 'utf8'),
        ).not.toContain(secret);
        if (authentication === 'local-login') {
          const stderr = await readFile(
            join(evidenceDir, 'stderr.log'),
            'utf8',
          );
          expect(stderr).toContain('[REDACTED]');
          expect(stderr).not.toContain(secret);
          expect(await readFile(loginFile, 'utf8')).toBe(loginBytes);
        }
        expect(
          (await readdir(join(workspace.root, '..'))).some((name) =>
            name.startsWith('session-home-'),
          ),
        ).toBe(false);
      }
  } finally {
    await disposeWorkspace(workspace);
    await fixture.cleanup();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
