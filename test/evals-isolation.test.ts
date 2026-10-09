import { afterEach, expect, test } from 'bun:test';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  rm,
  realpath,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  prepareSource,
  disposeSource,
  createAttemptWorkspace,
  disposeWorkspace,
  sandboxCommand,
  reserveOutput,
  fingerprintOrigin,
} from '../scripts/evals/isolation';
import { runProcess } from '../scripts/evals/process';
import { createScriptedAdapter } from '../scripts/evals/adapters/scripted';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'eval-origin-'));
  roots.push(root);
  for (const path of [
    'src/core',
    'src/core/__fixtures__',
    'skills/agentic-ddd/assets/tasks',
    'scripts',
    'node_modules/pkg',
  ])
    await mkdir(join(root, path), { recursive: true });
  for (const [path, value] of Object.entries({
    'src/core/index.ts': 'export const framework=1;',
    'src/core/hidden.test.ts': 'private test',
    'src/core/__fixtures__/solution.ts': 'private solution',
    'scripts/create-skills-example.ts': 'export {};',
    'skills/agentic-ddd/SKILL.md': 'author skill',
    'package.json': '{}',
    'tsconfig.json': '{}',
    'node_modules/pkg/index.js': 'module.exports=1;',
    'secret.txt': 'source-secret',
  }))
    await writeFile(join(root, path), value);
  await writeFile(join(root, '.gitignore'), 'node_modules/\n');
  for (const argv of [
    ['git', 'init', '-q'],
    ['git', 'add', '.'],
    [
      'git',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'user.name=Test',
      'commit',
      '-qm',
      'fixture',
    ],
  ]) {
    const p = Bun.spawnSync(argv, { cwd: root });
    if (p.exitCode !== 0) throw Error(p.stderr.toString());
  }
  return root;
}
test('physical source snapshot excludes solutions and materializes dependencies privately', async () => {
  const root = await fixture();
  const ancestor = await mkdtemp(join(tmpdir(), 'eval-links-'));
  roots.push(ancestor);
  await symlink(root, join(ancestor, 'source'));
  const source = await prepareSource(join(ancestor, 'source'), 'HEAD');
  roots.push(source.root);
  expect(source.originRoot).toBe(await realpath(root));
  expect(
    await readFile(join(source.frameworkRoot, 'src/core/index.ts'), 'utf8'),
  ).toContain('framework');
  expect(
    await Bun.file(
      join(source.frameworkRoot, 'src/core/hidden.test.ts'),
    ).exists(),
  ).toBe(false);
  expect(
    await Bun.file(
      join(source.frameworkRoot, 'src/core/__fixtures__/solution.ts'),
    ).exists(),
  ).toBe(false);
  expect(
    await realpath(join(source.frameworkRoot, 'node_modules/pkg/index.js')),
  ).not.toContain(root);
  const baseline = join(source.root, 'baseline');
  await mkdir(baseline);
  await writeFile(join(baseline, 'visible.txt'), 'assigned');
  const workspace = await createAttemptWorkspace(source, baseline, 'skills');
  const evidence = join(ancestor, 'evidence');
  const before = await fingerprintOrigin(root);
  const code = `if(await Bun.file(${JSON.stringify(join(root, 'secret.txt'))}).exists()) process.exit(11); for(const path of ${JSON.stringify([join(workspace.root, 'visible.txt'), join(source.frameworkRoot, 'node_modules/pkg/index.js')])}) {try{await Bun.write(path,'overwrite');process.exit(12)}catch{}} console.log(await Bun.file('visible.txt').text())`;
  const result = await runProcess(
    {
      argv: await sandboxCommand(workspace, [process.execPath, '-e', code], {
        network: false,
      }),
      cwd: workspace.root,
      env: { PATH: '/tools:/usr/bin:/bin', HOME: '/home/eval' },
      timeoutMs: 3000,
      evidenceDir: evidence,
    },
    { signal: new AbortController().signal },
  );
  expect(result.stderr).toBe('');
  expect(result.transport).toBe('finished');
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe('assigned\n');
  const adapter = createScriptedAdapter([
    { finalText: '{"type":"exact","value":"scripted"}' },
    { delayMs: 300 },
    { exitCode: 1 },
  ]);
  const request = {
    id: 'case',
    mode: 'skills' as const,
    cwd: workspace.root,
    prompt: 'question',
    timeoutMs: 100,
    evidenceDir: join(evidence, 'scripted'),
  };
  expect((await adapter.probe()).id).toBe('scripted');
  expect(
    (await adapter.run(request, { signal: new AbortController().signal }))
      .finalText,
  ).toBe('{"type":"exact","value":"scripted"}');
  expect(
    (await adapter.run(request, { signal: new AbortController().signal }))
      .transport,
  ).toBe('timeout');
  expect(
    (await adapter.run(request, { signal: new AbortController().signal }))
      .transport,
  ).toBe('infra_error');
  expect(await fingerprintOrigin(root)).toBe(before);
  await disposeWorkspace(workspace);
  expect(await Bun.file(join(workspace.root, 'visible.txt')).exists()).toBe(
    false,
  );
  expect(await Bun.file(result.evidence[0]!).exists()).toBe(true);
  await disposeSource(source);
});
test('rejects dirty sources, outward links, and existing or origin-contained output including symbolic ancestors', async () => {
  const root = await fixture();
  await writeFile(join(root, 'secret.txt'), 'changed');
  let error: unknown;
  try {
    await prepareSource(root, 'HEAD');
  } catch (e) {
    error = e;
  }
  expect(String(error)).toContain('clean');
  const outside = await mkdtemp(join(tmpdir(), 'eval-out-'));
  roots.push(outside);
  await symlink(root, join(outside, 'back'));
  for (const path of [
    root,
    join(root, 'new'),
    join(outside, 'back/new'),
    outside,
  ]) {
    let failure: unknown;
    try {
      await reserveOutput(path, root);
    } catch (e) {
      failure = e;
    }
    expect(failure).toBeInstanceOf(Error);
  }
  const reserved = await reserveOutput(join(outside, 'fresh'), root);
  expect(reserved).toBe(join(outside, 'fresh'));
  const p = Bun.spawnSync(['git', 'checkout', '--', 'secret.txt'], {
    cwd: root,
  });
  expect(p.exitCode).toBe(0);
  await symlink('/etc/passwd', join(root, 'escape'));
  Bun.spawnSync(['git', 'add', 'escape'], { cwd: root });
  Bun.spawnSync(
    [
      'git',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'user.name=Test',
      'commit',
      '-qm',
      'link',
    ],
    { cwd: root },
  );
  let linkFailure: unknown;
  try {
    await prepareSource(root, 'HEAD');
  } catch (e) {
    linkFailure = e;
  }
  expect(String(linkFailure)).toContain('link');
});
