// Runs the CI gate (or any command) inside the Linux image from docker/ci.Dockerfile.
// Usage: bun run ci:docker [--head] [--build] [-- <command...>]
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dir, '..');
const dockerfile = join(repo, 'docker', 'ci.Dockerfile');

// The `run:` steps of the `ci` job in .github/workflows/ci.yml after `bun install`, verbatim.
// test/ci-docker.test.ts compares this list with the workflow so the two cannot drift.
export const CI_GATE_STEPS = [
  'bun run typecheck',
  'bun run lint',
  "bun test --path-ignore-patterns='test/evals-*'",
  `bun run agentic verify 0001 > "$VERIFY_JSON"
test "$(bun -e 'console.log((await Bun.file(process.env.VERIFY_JSON).json()).status)')" = done`,
  'bun run build',
  'bun run test:package',
  'bun run agentic compile --check',
  'bun run skills:install --check',
];

export type Options = {
  head: boolean;
  build: boolean;
  command: string | undefined;
};

// Flags come first; the command starts at `--` or at the first argument that is not a flag.
export function parseArgs(argv: string[]): Options {
  const options: Options = { head: false, build: false, command: undefined };
  let i = 0;
  for (; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--head') options.head = true;
    else if (arg === '--build') options.build = true;
    else if (arg === '--') {
      i++;
      break;
    } else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else break;
  }
  const rest = argv.slice(i);
  if (rest.length > 0) options.command = rest.join(' ');
  return options;
}

export function imageTag(dockerfileText: string): string {
  const hash = createHash('sha256').update(dockerfileText).digest('hex');
  return `agentic-ddd-ci:${hash.slice(0, 12)}`;
}

export function gateScript(): string {
  return [
    'set -ex',
    'export VERIFY_JSON=/tmp/verify-0001.json',
    ...CI_GATE_STEPS,
  ].join('\n');
}

// Unpacks the snapshot, makes it a git repo (tests need one), installs from the lockfile, then runs `command`.
export function containerScript(command: string | undefined): string {
  const setup = [
    'tar -x -C /work',
    'git init -q',
    'git add -A',
    'git commit -qm snapshot',
    'bun install --frozen-lockfile',
  ].join(' && ');
  return `${setup} && {\n${command ?? gateScript()}\n}`;
}

export function dockerRunArgv(
  image: string,
  root: string,
  script: string,
  env: Record<string, string | undefined>,
): string[] {
  return [
    'docker',
    'run',
    '-i',
    '--rm',
    '--cpus',
    env.CI_DOCKER_CPUS ?? '4',
    '--memory',
    env.CI_DOCKER_MEMORY ?? '8g',
    '-v',
    'agentic-ddd-bun-cache:/root/.bun/install/cache',
    '-v',
    `${join(root, '.tmp', 'ci-docker')}:/out`,
    image,
    'bash',
    '-c',
    script,
  ];
}

async function exec(command: string[]): Promise<number> {
  const child = Bun.spawn(command, {
    cwd: repo,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return child.exited;
}

async function git(
  args: string[],
  env: Record<string, string | undefined> = {},
): Promise<string> {
  const child = Bun.spawn(['git', ...args], {
    cwd: repo,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const [out, code] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(' ')} exited ${code}`);
  return out.trim();
}

// The working tree as a tree object, built in a temporary index so the real one stays untouched.
async function snapshotTree(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'ci-docker-index-'));
  const env = { GIT_INDEX_FILE: join(dir, 'index') };
  try {
    await git(['read-tree', 'HEAD'], env);
    await git(['-c', 'core.autocrlf=input', 'add', '-A'], env);
    return await git(['write-tree'], env);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function ensureImage(tag: string, force: boolean): Promise<number> {
  if (!force) {
    const probe = Bun.spawn(['docker', 'image', 'inspect', tag], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    if ((await probe.exited) === 0) return 0;
  }
  return exec([
    'docker',
    'build',
    '-f',
    dockerfile,
    '-t',
    tag,
    join(repo, 'docker'),
  ]);
}

export async function main(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }
  const tag = imageTag(readFileSync(dockerfile, 'utf8'));
  const built = await ensureImage(tag, options.build);
  if (built !== 0) return built;

  const treeish = options.head ? 'HEAD' : await snapshotTree();
  mkdirSync(join(repo, '.tmp', 'ci-docker'), { recursive: true });
  const archive = Bun.spawn(
    ['git', '-c', 'core.autocrlf=false', 'archive', treeish],
    { cwd: repo, stdout: 'pipe', stderr: 'inherit' },
  );
  const argv2 = dockerRunArgv(tag, repo, containerScript(options.command), env);
  const container = Bun.spawn(argv2, {
    stdin: archive.stdout,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const [code, archived] = await Promise.all([
    container.exited,
    archive.exited,
  ]);
  return archived !== 0 ? archived : code;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
