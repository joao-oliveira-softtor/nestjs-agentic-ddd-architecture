import { expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  CI_GATE_STEPS,
  containerScript,
  dockerRunArgv,
  exitCode,
  gateScript,
  imageTag,
  main,
  parseArgs,
} from '../scripts/ci-docker';

test('the gate steps match the run steps of the ci job after bun install', () => {
  const workflow = Bun.YAML.parse(
    readFileSync('.github/workflows/ci.yml', 'utf8'),
  ) as { jobs: { ci: { steps: { run?: string }[] } } };
  const runs = workflow.jobs.ci.steps.flatMap((step) =>
    step.run === undefined ? [] : [step.run.trim()],
  );
  expect(runs[0]).toBe('bun install --frozen-lockfile');
  expect(CI_GATE_STEPS).toEqual(runs.slice(1));
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

test('imageTag is a stable 12-hex digest of the Dockerfile text', () => {
  expect(imageTag('FROM x')).toBe(imageTag('FROM x'));
  expect(imageTag('FROM x')).not.toBe(imageTag('FROM y'));
  expect(imageTag('FROM x')).toMatch(/^agentic-ddd-ci:[0-9a-f]{12}$/);
});

test('gateScript stops on the first failing step and runs every step in order', () => {
  const script = gateScript();
  expect(script.startsWith('set -ex\n')).toBe(true);
  const positions = CI_GATE_STEPS.map((step) => script.indexOf(step));
  expect(positions.every((p) => p > 0)).toBe(true);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
});

test('containerScript sets up the snapshot, then runs the command or the gate', () => {
  const custom = containerScript('bun --version');
  expect(custom).toContain('tar -x -C /work');
  expect(custom).toContain('bun install --frozen-lockfile');
  expect(custom.endsWith('{\nbun --version\n}')).toBe(true);
  expect(containerScript(undefined)).toContain(gateScript());
});

test('dockerRunArgv applies the resource defaults and the env overrides', () => {
  const defaults = dockerRunArgv('img:1', '/repo', 'echo', {});
  expect(
    defaults.slice(defaults.indexOf('--cpus'), defaults.indexOf('--cpus') + 4),
  ).toEqual(['--cpus', '4', '--memory', '8g']);
  const tuned = dockerRunArgv('img:1', '/repo', 'echo', {
    CI_DOCKER_CPUS: '2',
    CI_DOCKER_MEMORY: '4g',
  });
  expect(tuned).toContain('2');
  expect(tuned).toContain('4g');
  expect(tuned.slice(-4)).toEqual(['img:1', 'bash', '-c', 'echo']);
  expect(tuned.some((arg) => arg.endsWith('ci-docker:/out'))).toBe(true);
});

test('exitCode returns the archive failure first, then the container code', () => {
  expect(exitCode(0, 0)).toBe(0);
  expect(exitCode(0, 3)).toBe(3);
  expect(exitCode(128, 0)).toBe(128);
  expect(exitCode(128, 3)).toBe(128);
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
