import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type {
  AdapterRequest,
  AttemptWorkspace,
  PreparedSource,
} from './contracts';

const workspaces = new Map<string, AttemptWorkspace>();
export function getWorkspace(root: string): AttemptWorkspace {
  const workspace = workspaces.get(root);
  if (!workspace) throw Error('Unprepared evaluation workspace');
  return workspace;
}

export const sha256 = (bytes: string | Uint8Array) =>
  new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
export const within = (root: string, path: string) => {
  const r = relative(root, path);
  return r === '' || (!r.startsWith('../') && r !== '..' && !isAbsolute(r));
};
function git(root: string, args: string[]): Buffer {
  const result = Bun.spawnSync(['git', ...args], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0)
    throw Error(`git ${args[0]}: ${result.stderr.toString()}`);
  return result.stdout;
}
export async function fingerprintOrigin(root: string): Promise<string> {
  const paths = [
    ...new Set(
      git(root, [
        'ls-files',
        '-z',
        '--cached',
        '--others',
        '--exclude-standard',
      ])
        .toString()
        .split('\0')
        .filter(Boolean),
    ),
  ].sort();
  const files = await Promise.all(
    paths.map(async (path) => {
      const full = join(root, path);
      const stat = await lstat(full).catch(() => null);
      return [
        path,
        stat?.mode ?? null,
        stat?.isSymbolicLink()
          ? `link:${await readlink(full)}`
          : stat?.isFile()
            ? sha256(await readFile(full))
            : null,
      ];
    }),
  );
  // Includes staged bytes, not merely the working-tree status.
  return sha256(
    JSON.stringify({
      head: git(root, ['rev-parse', 'HEAD']).toString().trim(),
      index: sha256(git(root, ['ls-files', '--stage', '-z'])),
      files,
    }),
  );
}
async function validateLinks(root: string): Promise<void> {
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await realpath(path);
        if (!within(root, target)) throw Error(`Outward link: ${path}`);
      } else if (entry.isDirectory()) await visit(path);
    }
  }
  await visit(root);
}
async function copyProduction(
  snapshot: string,
  framework: string,
): Promise<void> {
  await mkdir(framework);
  for (const path of [
    'src',
    'skills/agentic-ddd',
    'scripts/create-skills-example.ts',
    'scripts/install-skills.ts',
    'package.json',
    'tsconfig.json',
    'bun.lock',
  ]) {
    const from = join(snapshot, path);
    if (!(await lstat(from).catch(() => null))) continue;
    await cp(from, join(framework, path), {
      recursive: true,
      dereference: true,
      filter: (p) =>
        !/(?:^|\/)(?:__fixtures__|__snapshots__)(?:\/|$)/.test(p) &&
        !/\.(?:test|spec)\.ts$/.test(p),
    });
  }
}
export async function prepareSource(
  sourceRoot: string,
  sourceRef: string,
): Promise<PreparedSource> {
  const originRoot = await realpath(sourceRoot);
  if (
    ['/usr', '/bin', '/lib', '/lib64', '/etc', '/proc', '/dev'].some(
      (root) => within(root, originRoot) || within(originRoot, root),
    )
  )
    throw Error('Origin overlaps sandbox system mounts');
  if (
    git(originRoot, ['status', '--porcelain', '--untracked-files=normal'])
      .length
  )
    throw Error('Evaluation source must be clean');
  const commit = git(originRoot, [
    'rev-parse',
    '--verify',
    `${sourceRef}^{commit}`,
  ])
    .toString()
    .trim();
  const runnerCommit = git(resolve(import.meta.dir, '../..'), [
    'rev-parse',
    'HEAD',
  ])
    .toString()
    .trim();
  const fingerprint = await fingerprintOrigin(originRoot);
  const root = await mkdtemp(join(tmpdir(), 'agentic-eval-'));
  try {
    const snapshotRoot = join(root, 'snapshot');
    const frameworkRoot = join(root, 'framework');
    await mkdir(snapshotRoot);
    const archive = git(originRoot, ['archive', commit]);
    const extraction = Bun.spawnSync(['tar', '-x', '-C', snapshotRoot], {
      stdin: archive,
    });
    if (extraction.exitCode !== 0)
      throw Error(`snapshot: ${extraction.stderr.toString()}`);
    await validateLinks(snapshotRoot);
    await copyProduction(snapshotRoot, frameworkRoot);
    const dependencies = await realpath(join(originRoot, 'node_modules'));
    await validateLinks(dependencies);
    await cp(dependencies, join(frameworkRoot, 'node_modules'), {
      recursive: true,
      dereference: true,
    });
    await symlink(
      join(frameworkRoot, 'node_modules'),
      join(snapshotRoot, 'node_modules'),
      'dir',
    );
    return {
      originRoot,
      commit,
      runnerCommit,
      fingerprint,
      root,
      snapshotRoot,
      frameworkRoot,
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
export async function createAttemptWorkspace(
  source: PreparedSource,
  baseline: string,
  mode: AdapterRequest['mode'],
): Promise<AttemptWorkspace> {
  const parent = await mkdtemp(join(source.root, 'attempt-'));
  const root = join(parent, 'workspace');
  await mkdir(root);
  // Links in a prepared tutorial may reach only the private readonly framework.
  async function check(directory: string, allowedRoot: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await realpath(path);
        if (
          !within(allowedRoot, target) &&
          !within(source.frameworkRoot, target)
        )
          throw Error(`Unsafe workspace link: ${path}`);
      } else if (entry.isDirectory()) await check(path, allowedRoot);
    }
  }
  try {
    await check(baseline, baseline);
    await cp(baseline, root, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
    });
    await check(root, root);
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  const workspace = {
    root,
    configPath: join(root, 'agentic.config.ts'),
    baseline,
    frameworkRoot: source.frameworkRoot,
    mode,
  };
  workspaces.set(root, workspace);
  return workspace;
}
export async function disposeWorkspace(
  workspace: AttemptWorkspace,
): Promise<void> {
  workspaces.delete(workspace.root);
  await rm(workspace.root, { recursive: true, force: true });
}
export const disposeSource = (source: PreparedSource) =>
  rm(source.root, { recursive: true, force: true });

async function physicalDestination(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const stat = await lstat(absolute).catch(() => null);
    if (stat?.isSymbolicLink())
      throw Error(`Dangling output link: ${absolute}`);
    if (dirname(absolute) === absolute) throw error;
    return join(
      await physicalDestination(dirname(absolute)),
      relative(dirname(absolute), absolute),
    );
  }
}
export async function reserveOutput(
  path: string,
  sourceRoot: string,
): Promise<string> {
  const root = await realpath(sourceRoot);
  const target = await physicalDestination(path);
  if (within(root, target)) throw Error('Output must be outside the origin');
  if (await lstat(resolve(path)).catch(() => null))
    throw Error('Output already exists');
  await mkdir(dirname(target), { recursive: true });
  await mkdir(target);
  return target;
}
export interface SandboxOptions {
  network: boolean;
  homeDir?: string;
  extraReadOnly?: readonly string[];
  extraWritable?: readonly string[];
}
export async function protectedWorkspacePaths(
  workspace: AttemptWorkspace,
  writableFiles: readonly string[],
): Promise<string[]> {
  if (workspace.mode === 'skills') return [];
  const paths: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(join(workspace.root, directory), {
      withFileTypes: true,
    })) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue; // Prepared links target readonly mounts.
      if (writableFiles.includes(path)) continue;
      if (
        entry.isDirectory() &&
        writableFiles.some((file) => file.startsWith(path + '/'))
      )
        await visit(path);
      else paths.push(join(workspace.root, path));
    }
  }
  await visit('');
  return paths;
}
/** Minimal root: no host checkout, home, runner artifacts or host sockets are mounted. */
export async function sandboxCommand(
  workspace: AttemptWorkspace,
  argv: readonly string[],
  options: SandboxOptions,
): Promise<string[]> {
  if (process.platform !== 'linux' || !Bun.which('bwrap'))
    throw Error('Linux bubblewrap is required');
  const args = [
    'bwrap',
    '--die-with-parent',
    '--unshare-pid',
    '--unshare-ipc',
    '--unshare-uts',
  ];
  if (!options.network) args.push('--unshare-net');
  for (const path of ['/usr', '/bin', '/lib', '/lib64'])
    if (await lstat(path).catch(() => null)) args.push('--ro-bind', path, path);
  args.push(
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--tmpfs',
    '/tmp',
    '--tmpfs',
    '/home',
    '--dir',
    '/home/eval',
    '--dir',
    '/etc',
  );
  for (const path of [
    '/etc/ssl',
    '/etc/resolv.conf',
    '/etc/hosts',
    '/etc/nsswitch.conf',
    '/etc/passwd',
    '/etc/group',
  ])
    if (await lstat(path).catch(() => null)) args.push('--ro-bind', path, path);
  const bun = await realpath(process.execPath);
  args.push('--ro-bind', bun, '/tools/bun');
  args.push('--ro-bind', workspace.frameworkRoot, workspace.frameworkRoot);
  args.push(
    workspace.mode === 'skills' ? '--ro-bind' : '--bind',
    workspace.root,
    workspace.root,
  );
  for (const path of options.extraReadOnly ?? []) {
    const physical = await realpath(path);
    args.push('--ro-bind', physical, physical);
  }
  for (const path of options.extraWritable ?? []) {
    const physical = await realpath(path);
    args.push('--bind', physical, physical);
  }
  if (options.homeDir)
    args.push('--bind', await realpath(options.homeDir), '/home/eval');
  args.push(
    '--setenv',
    'HOME',
    '/home/eval',
    '--setenv',
    'PATH',
    '/tools:/usr/bin:/bin',
    '--chdir',
    workspace.root,
    '--',
    ...(argv[0] === process.execPath ? ['/tools/bun', ...argv.slice(1)] : argv),
  );
  return args;
}
