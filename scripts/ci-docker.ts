// Runs the CI gate (or any command) inside the Linux image from docker/ci.Dockerfile.
// Usage: bun run ci:docker [--head] [--build] [-- <command...>]
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dir, '..');
const dockerfile = join(repo, 'docker', 'ci.Dockerfile');
const workflowFile = join(repo, '.github', 'workflows', 'ci.yml');

export type Options = {
  head: boolean;
  build: boolean;
  command: string | undefined;
};

// Quotes a word for bash only when it has characters the shell would split or expand.
export function shellQuote(word: string): string {
  if (/^[\w@%+=:,./-]+$/.test(word)) return word;
  return `'${word.replaceAll("'", "'\\''")}'`;
}

// Flags come first; the command starts at `--` or at the first argument that is not a flag.
// Several words are quoted one by one; a single word stays raw so it can hold pipes and redirects.
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
  if (rest.length === 1) options.command = rest[0];
  else if (rest.length > 1) options.command = rest.map(shellQuote).join(' ');
  return options;
}

export function imageTag(dockerfileText: string): string {
  const hash = createHash('sha256').update(dockerfileText).digest('hex');
  return `agentic-ddd-ci:${hash.slice(0, 12)}`;
}

// `${{ runner.temp }}` is the only expression the gate steps use; anything else has no local meaning.
function translate(text: string): string {
  const local = text.replace(/\$\{\{\s*runner\.temp\s*\}\}/g, '/tmp');
  const left = local.match(/\$\{\{.*?\}\}/);
  if (left) throw new Error(`unsupported expression ${left[0]}`);
  return local;
}

type Step = { run?: string; env?: Record<string, unknown> };

// The `run` steps of the `ci` job after `bun install`, each preceded by its exported `env`.
export function gateScript(workflowText: string): string {
  const { jobs } = Bun.YAML.parse(workflowText) as {
    jobs: { ci: { steps: Step[] } };
  };
  const steps = jobs.ci.steps;
  const install = steps.findIndex(
    (step) => step.run?.trim() === 'bun install --frozen-lockfile',
  );
  if (install < 0) throw new Error('the ci job has no bun install step');
  const lines = steps.slice(install + 1).flatMap((step) => {
    if (step.run === undefined) return [];
    const exports = Object.entries(step.env ?? {}).map(
      ([name, value]) =>
        `export ${name}=${shellQuote(translate(String(value)))}`,
    );
    return [...exports, translate(step.run.trim())];
  });
  return ['set -ex', ...lines].join('\n');
}

// Unpacks the snapshot, makes it a git repo (tests need one), installs from the lockfile, then runs `body`.
// On exit, /out goes back to the host user (CI_DOCKER_OWNER, set on non-Windows hosts) and the exit code is kept.
export function containerScript(body: string): string {
  const handBack =
    'trap \'rc=$?; [ -z "$CI_DOCKER_OWNER" ] || chown -R "$CI_DOCKER_OWNER" /out; exit $rc\' EXIT';
  const setup = [
    'tar -x -C /work',
    'git init -q',
    'git add -A',
    'git commit -qm snapshot',
    // The package list is noise on every run; it is shown only when the install fails.
    '{ bun install --frozen-lockfile > /tmp/bun-install.log 2>&1 || { cat /tmp/bun-install.log >&2; exit 1; }; }',
  ].join(' && ');
  return `${handBack}\n${setup} && {\n${body}\n}`;
}

// Docker refuses a --cpus above what the host (or its VM) has.
export function defaultCpus(
  available: number = availableParallelism(),
): string {
  return String(Math.min(4, available));
}

// uid:gid of the host user so files written to /out are not root-owned; Windows hosts have no such ids.
export function hostOwner(
  platform: string,
  getuid: (() => number) | undefined,
  getgid: (() => number) | undefined,
): string | undefined {
  if (platform === 'win32' || !getuid || !getgid) return undefined;
  return `${getuid()}:${getgid()}`;
}

export type Run = { name: string; owner?: string };

// --init puts a signal-forwarding init in front of bash, which as PID 1 would ignore SIGINT/SIGTERM.
export function dockerRunArgv(
  image: string,
  root: string,
  script: string,
  env: Record<string, string | undefined>,
  run: Run,
): string[] {
  return [
    'docker',
    'run',
    '-i',
    '--rm',
    '--init',
    '--name',
    run.name,
    '--cpus',
    env.CI_DOCKER_CPUS || defaultCpus(),
    '--memory',
    env.CI_DOCKER_MEMORY || '8g',
    ...(run.owner ? ['-e', `CI_DOCKER_OWNER=${run.owner}`] : []),
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

// A container that failed wins: when it exits before reading stdin, `git archive` dies of EPIPE and its code is noise.
export function exitCode(archived: number, container: number): number {
  return container !== 0 ? container : archived;
}

// The message for a spawn that failed because the executable is not installed.
export function missingBinary(error: unknown): string | undefined {
  const { code, path } = (error ?? {}) as { code?: string; path?: string };
  if (code !== 'ENOENT') return undefined;
  return `${path ?? 'a required program'} was not found in PATH; ci:docker needs docker and git`;
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

// The working tree as a tree object, built in a copy of the real index (so only changed files are
// rehashed) and never in the real one, which stays untouched.
export async function snapshotTree(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'ci-docker-index-'));
  const env = { GIT_INDEX_FILE: join(dir, 'index') };
  try {
    const index = resolve(
      repo,
      await git(['rev-parse', '--git-path', 'index']),
    );
    if (existsSync(index)) copyFileSync(index, env.GIT_INDEX_FILE);
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

// Ctrl+C reaches docker's CLI, but a SIGTERM to this process would not: kill the container by name.
async function runContainer(
  argv: string[],
  name: string,
  archive: Bun.Subprocess<'ignore', 'pipe', 'inherit'>,
): Promise<number> {
  const kill = () =>
    Bun.spawnSync(['docker', 'kill', name], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
  process.on('SIGINT', kill);
  process.on('SIGTERM', kill);
  try {
    const container = Bun.spawn(argv, {
      stdin: archive.stdout,
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const [code, archived] = await Promise.all([
      container.exited,
      archive.exited,
    ]);
    return exitCode(archived, code);
  } finally {
    process.off('SIGINT', kill);
    process.off('SIGTERM', kill);
  }
}

async function runGate(
  options: Options,
  env: Record<string, string | undefined>,
): Promise<number> {
  const tag = imageTag(readFileSync(dockerfile, 'utf8'));
  const built = await ensureImage(tag, options.build);
  if (built !== 0) return built;

  const body =
    options.command ?? gateScript(readFileSync(workflowFile, 'utf8'));
  const treeish = options.head ? 'HEAD' : await snapshotTree();
  mkdirSync(join(repo, '.tmp', 'ci-docker'), { recursive: true });
  const archive = Bun.spawn(
    ['git', '-c', 'core.autocrlf=false', 'archive', treeish],
    { cwd: repo, stdout: 'pipe', stderr: 'inherit' },
  );
  const name = `agentic-ddd-ci-${process.pid}`;
  const owner = hostOwner(process.platform, process.getuid, process.getgid);
  const argv = dockerRunArgv(tag, repo, containerScript(body), env, {
    name,
    owner,
  });
  return runContainer(argv, name, archive);
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
  try {
    return await runGate(options, env);
  } catch (error) {
    const message = missingBinary(error);
    if (message === undefined) throw error;
    console.error(message);
    return 127;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
