import { expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  containerScript,
  defaultCpus,
  dockerRunArgv,
  exitCode,
  gateScript,
  hostOwner,
  imageTag,
  main,
  missingBinary,
  parseArgs,
  shellQuote,
  snapshotTree,
} from '../scripts/ci-docker';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const run = { name: 'ci-docker-test' };

const workflowWith = (steps: string) =>
  `jobs:\n  ci:\n    steps:\n      - run: bun install --frozen-lockfile\n${steps}`;

test('gateScript is the run steps of the ci job after bun install, with the step env exported', () => {
  const script = gateScript(workflow);
  expect(script.startsWith('set -ex\n')).toBe(true);
  expect(script).not.toContain('bun install');
  const at = (text: string) => script.indexOf(text);
  const verify = [
    'export VERIFY_JSON=/tmp/verify-0001.json',
    'bun run agentic verify 0001 > "$VERIFY_JSON"',
    ')" = done',
  ].map(at);
  expect(at('bun run typecheck')).toBeGreaterThan(0);
  expect(verify[0]).toBeGreaterThan(at('bun run typecheck'));
  expect(verify).toEqual([...verify].sort((a, b) => a - b));
  expect(verify.every((p) => p > 0)).toBe(true);
  expect(at('skills:install --check')).toBeGreaterThan(verify[2]);
});

test('gateScript keeps the workflow order of the steps', () => {
  const script = gateScript(
    workflowWith(
      '      - run: first\n      - uses: some/action@v1\n      - run: second',
    ),
  );
  expect(script).toBe('set -ex\nfirst\nsecond');
});

test('gateScript refuses an expression it cannot translate', () => {
  const env = '      - env:\n          A: ${{ github.sha }}\n        run: x';
  expect(() => gateScript(workflowWith(env))).toThrow(
    'unsupported expression ${{ github.sha }}',
  );
  const inline = '      - run: echo ${{ matrix.os }}';
  expect(() => gateScript(workflowWith(inline))).toThrow(
    'unsupported expression',
  );
});

test('parseArgs reads flags and the command after --', () => {
  expect(parseArgs([])).toEqual({
    head: false,
    build: false,
    command: undefined,
  });
  expect(parseArgs(['--head', '--build', '--', 'bun', '--version'])).toEqual({
    head: true,
    build: true,
    command: 'bun --version',
  });
});

test('parseArgs takes the first non-flag argument as the start of the command', () => {
  expect(parseArgs(['--head', 'bun', '--version']).command).toBe(
    'bun --version',
  );
});

test('parseArgs rejects an unknown option', () => {
  expect(() => parseArgs(['--nope'])).toThrow('unknown option --nope');
});

test('parseArgs keeps the words of a multi-word command intact for the shell', () => {
  const { command } = parseArgs(['--', 'bun', 'test', '-t', "it's a test"]);
  expect(command).toBe("bun test -t 'it'\\''s a test'");
  const echoed = Bun.spawnSync(['bash', '-c', `printf '%s|' ${command}`]);
  expect(echoed.stdout.toString()).toBe("bun|test|-t|it's a test|");
});

test('parseArgs leaves a single word raw so pipes and redirects work', () => {
  expect(parseArgs(['--', 'crapper --help | head']).command).toBe(
    'crapper --help | head',
  );
  expect(parseArgs(['--', 'bash']).command).toBe('bash');
});

test('shellQuote quotes only what the shell would split or expand', () => {
  expect(shellQuote('bun')).toBe('bun');
  expect(shellQuote('--flag=a/b.c:d')).toBe('--flag=a/b.c:d');
  expect(shellQuote('')).toBe("''");
  expect(shellQuote('a b')).toBe("'a b'");
  expect(shellQuote('$HOME;rm')).toBe("'$HOME;rm'");
  expect(shellQuote("it's")).toBe("'it'\\''s'");
});

test('imageTag is a stable 12-hex digest of the Dockerfile text', () => {
  expect(imageTag('FROM x')).toBe(imageTag('FROM x'));
  expect(imageTag('FROM x')).not.toBe(imageTag('FROM y'));
  expect(imageTag('FROM x')).toMatch(/^agentic-ddd-ci:[0-9a-f]{12}$/);
});

test('containerScript sets up the snapshot, then runs the body', () => {
  const script = containerScript('bun --version');
  expect(script).toContain('tar -x -C /work');
  expect(script).toContain('bun install --frozen-lockfile');
  expect(script.endsWith('{\nbun --version\n}')).toBe(true);
  expect(containerScript('')).not.toContain('typecheck');
});

test('the install log is printed only when the install fails', () => {
  const install = containerScript('true')
    .split(' && ')
    .find((s) => s.includes('bun install'))!;
  const exec = (bun: string) =>
    Bun.spawnSync(['bash', '-c', `bun() { ${bun}; }\n${install}`]);
  const ok = exec('echo noisy-package-list');
  expect(ok.exitCode).toBe(0);
  expect(ok.stdout.toString() + ok.stderr.toString()).not.toContain(
    'noisy-package-list',
  );
  const failed = exec('echo lockfile-mismatch; return 1');
  expect(failed.exitCode).toBe(1);
  expect(failed.stderr.toString()).toContain('lockfile-mismatch');
});

test('the container hands /out to the host user and keeps the command exit code', () => {
  const stubs =
    'tar() { :; }; git() { :; }; bun() { :; }; chown() { echo "chown $*" >&2; }';
  const exec = (body: string, owner: string) =>
    Bun.spawnSync(['bash', '-c', `${stubs}\n${containerScript(body)}`], {
      env: { ...process.env, CI_DOCKER_OWNER: owner },
    });
  const failed = exec('exit 3', '1000:1000');
  expect(failed.exitCode).toBe(3);
  expect(failed.stderr.toString()).toContain('chown -R 1000:1000 /out');
  const passed = exec('true', '');
  expect(passed.exitCode).toBe(0);
  expect(passed.stderr.toString()).not.toContain('chown');
});

test('dockerRunArgv applies the resource defaults and the env overrides', () => {
  const defaults = dockerRunArgv('img:1', '/repo', 'echo', {}, run);
  expect(
    defaults.slice(defaults.indexOf('--cpus'), defaults.indexOf('--cpus') + 4),
  ).toEqual(['--cpus', defaultCpus(), '--memory', '8g']);
  const tuned = dockerRunArgv(
    'img:1',
    '/repo',
    'echo',
    { CI_DOCKER_CPUS: '2', CI_DOCKER_MEMORY: '4g' },
    run,
  );
  expect(tuned).toContain('2');
  expect(tuned).toContain('4g');
  expect(tuned.slice(-4)).toEqual(['img:1', 'bash', '-c', 'echo']);
  expect(tuned.some((arg) => arg.endsWith('ci-docker:/out'))).toBe(true);
});

test('dockerRunArgv falls back to the defaults for empty resource variables', () => {
  const argv = dockerRunArgv(
    'img:1',
    '/repo',
    'echo',
    { CI_DOCKER_CPUS: '', CI_DOCKER_MEMORY: '' },
    run,
  );
  expect(
    argv.slice(argv.indexOf('--cpus'), argv.indexOf('--cpus') + 4),
  ).toEqual(['--cpus', defaultCpus(), '--memory', '8g']);
});

test('defaultCpus never asks for more CPUs than the host has', () => {
  expect(defaultCpus(2)).toBe('2');
  expect(defaultCpus(4)).toBe('4');
  expect(defaultCpus(16)).toBe('4');
});

test('dockerRunArgv runs under an init process with a name docker kill can target', () => {
  const argv = dockerRunArgv('img:1', '/repo', 'echo', {}, run);
  expect(argv).toContain('--init');
  expect(argv[argv.indexOf('--name') + 1]).toBe('ci-docker-test');
});

test('dockerRunArgv passes the host owner only when there is one', () => {
  const none = dockerRunArgv('img:1', '/repo', 'echo', {}, run);
  expect(none.join(' ')).not.toContain('CI_DOCKER_OWNER');
  const owned = dockerRunArgv(
    'img:1',
    '/repo',
    'echo',
    {},
    { ...run, owner: '1000:1001' },
  );
  expect(owned[owned.indexOf('CI_DOCKER_OWNER=1000:1001') - 1]).toBe('-e');
});

test('hostOwner is the uid:gid of the host user, and nothing on Windows', () => {
  expect(
    hostOwner(
      'linux',
      () => 1000,
      () => 1001,
    ),
  ).toBe('1000:1001');
  expect(
    hostOwner(
      'win32',
      () => 1000,
      () => 1001,
    ),
  ).toBeUndefined();
  expect(hostOwner('linux', undefined, undefined)).toBeUndefined();
});

test('exitCode lets a failed container win over the archive it never finished reading', () => {
  expect(exitCode(0, 0)).toBe(0);
  expect(exitCode(0, 3)).toBe(3);
  expect(exitCode(128, 0)).toBe(128);
  expect(exitCode(141, 125)).toBe(125);
});

test('missingBinary names the executable that is not in PATH', () => {
  const error = (() => {
    try {
      Bun.spawn(['no-such-binary-xyz']);
    } catch (e) {
      return e;
    }
  })();
  expect(missingBinary(error)).toBe(
    'no-such-binary-xyz was not found in PATH; ci:docker needs docker and git',
  );
  expect(missingBinary(new Error('boom'))).toBeUndefined();
  expect(missingBinary('nope')).toBeUndefined();
});

test('main reports a bad option with exit code 2 before touching docker', async () => {
  const error = spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(await main(['--nope'])).toBe(2);
    expect(error).toHaveBeenCalledWith('unknown option --nope');
  } finally {
    error.mockRestore();
  }
});

test('main exits 127 with one line when docker is not installed', async () => {
  const error = spyOn(console, 'error').mockImplementation(() => {});
  // An env whose PATH is an empty dir; process.env stays untouched, so nothing leaks into later tests.
  const env = { ...process.env, PATH: mkdtempSync(join(tmpdir(), 'no-bin-')) };
  try {
    expect(await main([], env)).toBe(127);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain('was not found in PATH');
  } finally {
    error.mockRestore();
  }
});

test('snapshotTree returns the tree of the working tree and leaves the real index untouched', async () => {
  const indexPath = Bun.spawnSync(['git', 'rev-parse', '--git-path', 'index'])
    .stdout.toString()
    .trim();
  const digest = () =>
    createHash('sha256').update(readFileSync(indexPath)).digest('hex');
  const before = digest();
  expect(await snapshotTree()).toMatch(/^[0-9a-f]{40}$/);
  expect(digest()).toBe(before);
});

test('git ignores the dirs the snapshot must not pick up', () => {
  const paths = [
    '.claude/worktrees/x/file',
    '.metrics/file',
    'target/file',
    'coverage/file',
  ];
  const ignored = Bun.spawnSync(['git', 'check-ignore', ...paths]);
  expect(ignored.stdout.toString().trim().split('\n')).toEqual(paths);
});
