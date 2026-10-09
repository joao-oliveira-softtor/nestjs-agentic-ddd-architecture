import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { stableStringify } from '@agentic-ddd/compiler';
import type {
  CaseResult,
  ContextBundle,
  EvalAdapter,
  PreparedSource,
  RunManifest,
  RunOptions,
} from './contracts';
import { loadDataset } from './dataset';
import { judge, parseAnswer } from './judge';
import {
  createAttemptWorkspace,
  disposeWorkspace,
  sha256,
  within,
  sandboxCommand,
} from './isolation';
import { runProcess } from './process';

export async function buildSkillContext(
  source: PreparedSource,
  roots: readonly string[],
): Promise<ContextBundle> {
  const selected = new Map<string, string>();
  const visiting = new Set<string>();
  for (const root of roots) {
    if (
      root !== 'AGENTS.md' &&
      !/^\.(?:agents\/skills|agentic\/runtime)\/[^/]+(?:\/[^.][^]*)?$/.test(
        root,
      )
    )
      throw Error(`Forbidden context root: ${root}`);
    if (root.split('/').includes('..')) throw Error('Unsafe context path');
    async function visit(path: string) {
      const physical = await realpath(join(source.snapshotRoot, path));
      if (!within(source.snapshotRoot, physical))
        throw Error('Context link escapes snapshot');
      const target = relative(source.snapshotRoot, physical);
      if (
        target !== 'AGENTS.md' &&
        !/^(?:\.agents\/skills|\.agentic\/runtime|skills\/agentic-ddd)(?:\/|$)/.test(
          target,
        )
      )
        throw Error('Context link reaches forbidden source');
      const stat = await lstat(physical);
      if (stat.isDirectory()) {
        if (visiting.has(physical)) throw Error('Cyclic context link');
        visiting.add(physical);
        for (const name of (await readdir(physical)).sort())
          await visit(`${path}/${name}`);
        visiting.delete(physical);
      } else if (stat.isFile()) {
        if (!/\.(?:md|json|ya?ml)$/.test(path))
          throw Error(`Unsupported context file: ${path}`);
        selected.set(path, await readFile(physical, 'utf8'));
      } else throw Error(`Unsupported context entry: ${path}`);
    }
    await visit(root);
  }
  const files = [...selected]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, content]) => ({ path, content }));
  if (!files.length) throw Error('Empty context');
  const root = await mkdtemp(join(source.root, 'context-'));
  for (const file of files) {
    await mkdir(dirname(join(root, file.path)), { recursive: true });
    await writeFile(join(root, file.path), file.content);
  }
  return {
    root,
    files,
    bundleSha256: sha256(
      stableStringify(files.map((f) => [f.path, f.content])),
    ),
  };
}

export async function checkSourceCompile(
  source: PreparedSource,
  options: RunOptions,
): Promise<void> {
  const workspace = await createAttemptWorkspace(
    source,
    source.snapshotRoot,
    'skills',
  );
  try {
    const argv = await sandboxCommand(
      workspace,
      [
        process.execPath,
        join(workspace.root, 'src/cli/main.ts'),
        'compile',
        '--check',
      ],
      { network: false },
    );
    const result = await runProcess(
      {
        argv,
        cwd: workspace.root,
        env: { PATH: '/tools:/usr/bin:/bin' },
        timeoutMs: Math.min(120000, options.control?.remainingMs() ?? 120000),
        evidenceDir: join(options.outDir, 'skills/preflight'),
      },
      { signal: options.control?.signal ?? options.signal },
    );
    if (result.transport !== 'finished' || result.exitCode !== 0)
      throw Error(
        `Base compile --check failed: ${result.diagnostic ?? result.stderr}`,
      );
  } finally {
    await disposeWorkspace(workspace);
  }
}
export async function evaluateSkills(
  manifest: RunManifest,
  source: PreparedSource,
  adapters: ReadonlyMap<string, EvalAdapter>,
  options: RunOptions,
): Promise<readonly CaseResult[]> {
  if (
    !options.real &&
    manifest.configurations.some((c) => c.adapter !== 'scripted')
  )
    throw Error('Real adapters require --real');
  await checkSourceCompile(source, options);
  const results: CaseResult[] = [];
  for (const datasetEntry of manifest.skillDatasets) {
    const path = join(source.snapshotRoot, datasetEntry.path);
    const dataset = await loadDataset(path);
    const datasetSha256 = sha256(await readFile(path));
    const contexts = {
      dev: await buildSkillContext(source, datasetEntry.contextRoots.dev),
      runtime: await buildSkillContext(
        source,
        datasetEntry.contextRoots.runtime,
      ),
    };
    for (const configuration of manifest.configurations) {
      const adapter = adapters.get(configuration.id);
      if (!adapter) throw Error(`Adapter missing: ${configuration.id}`);
      for (const entry of dataset) {
        const context = contexts[entry.audience];
        const result: CaseResult = {
          configuration: configuration.id,
          dataset: datasetEntry.path,
          datasetSha256,
          id: entry.id,
          audience: entry.audience,
          question: entry.question,
          expect: entry.expect,
          answer: null,
          verdict: 'not_run',
          reason: null,
          contextHash: context.bundleSha256,
          execution: null,
        };
        results.push(result);
        options.onCase?.(result);
        if (
          options.signal.aborted ||
          options.control?.stopReason() ||
          (options.control && !options.control.reserveInvocation())
        ) {
          result.reason = options.control?.stopReason() ?? 'cancelled';
          continue;
        }
        const workspace = await createAttemptWorkspace(
          source,
          context.root,
          'skills',
        );
        const evidenceDir = join(
          options.outDir,
          'skills',
          configuration.id,
          sha256(datasetEntry.path),
          entry.id,
        );
        const prompt = `Leia os arquivos de contexto desta sessão: ${context.files.map((f) => f.path).join(', ')}.\nResponda somente um objeto JSON, sem cercas nem prosa. Formatos: {"type":"exact","value":"texto"} ou {"type":"tool_call","name":"nome","input":{}}. Preserve a resposta literal solicitada. Não execute tools de negócio. Use somente a sessão principal, sem delegação ou subagentes.\nPergunta: ${entry.question}`;
        await mkdir(evidenceDir, { recursive: true });
        await writeFile(join(evidenceDir, 'prompt.txt'), prompt);
        await writeFile(
          join(evidenceDir, 'context.json'),
          JSON.stringify(
            { bundleSha256: context.bundleSha256, files: context.files },
            null,
            2,
          ) + '\n',
        );
        try {
          const execution = await adapter.run(
            {
              id: entry.id,
              mode: 'skills',
              cwd: workspace.root,
              prompt,
              timeoutMs: Math.min(
                manifest.budget.skillTimeoutMs,
                options.control?.remainingMs() ?? Infinity,
              ),
              evidenceDir,
            },
            { signal: options.control?.signal ?? options.signal },
          );
          result.execution = execution;
          if (execution.transport === 'timeout') {
            result.verdict = 'timeout';
            result.reason = execution.diagnostic;
          } else if (execution.transport === 'cancelled') {
            result.reason = options.control?.stopReason() ?? 'cancelled';
          } else if (execution.transport === 'infra_error') {
            result.verdict = 'infra_error';
            result.reason = execution.diagnostic;
          } else {
            try {
              result.answer = parseAnswer(execution.finalText ?? '');
              result.verdict = judge(entry.expect, result.answer);
            } catch {
              result.verdict = 'malformed';
              result.reason = 'invalid_answer_json';
            }
          }
        } catch (error) {
          result.verdict = 'infra_error';
          result.reason = String(error);
        } finally {
          await disposeWorkspace(workspace);
        }
        await writeFile(
          join(evidenceDir, 'result.json'),
          JSON.stringify(result, null, 2) + '\n',
        );
      }
    }
  }
  return results;
}
