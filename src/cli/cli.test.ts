import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MOTIVO_PLACEHOLDER } from '@agentic-ddd/compiler';
import { checkSnapshot } from '../compiler/snapshot';
import { bootstrapChanges } from '../../test/helpers/bootstrap';

const ROOT = resolve(import.meta.dir, '../..');

function run(...args: string[]) {
  const result = Bun.spawnSync(['bun', 'src/cli/main.ts', ...args], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

let out: string;

beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), 'agentic-cli-'));
});

afterEach(async () => {
  await rm(out, { recursive: true, force: true });
});

describe('agentic-ddd compile (CLI)', () => {
  test('writes, then --check exits 0', async () => {
    await bootstrapChanges(out);
    expect(run('compile', '--out-root', out).code).toBe(0);
    expect((await checkSnapshot(out)).ok).toBe(true);
    const check = run('compile', '--check', '--out-root', out);
    expect(check.code).toBe(0);
    expect(check.stdout).toContain('generated files are up to date');
  });

  test('--check exits 1 and lists the outdated file', async () => {
    run('compile', '--out-root', out);
    const skillPath = join(out, '.agents/skills/orders-dev/SKILL.md');
    await writeFile(
      skillPath,
      `${await readFile(skillPath, 'utf8')}\neditado\n`,
    );
    const check = run('compile', '--check', '--out-root', out);
    expect(check.code).toBe(1);
    expect(check.stderr).toContain(
      'outdated (changed): .agents/skills/orders-dev/SKILL.md',
    );
  });

  test('--check with a real directory in place of the mirror link suggests removing or renaming it', async () => {
    await bootstrapChanges(out);
    run('compile', '--out-root', out);
    const mirror = join(out, '.claude/skills/orders-dev');
    await rm(mirror, { recursive: true, force: true });
    await mkdir(mirror, { recursive: true });
    const check = run('compile', '--check', '--out-root', out);
    expect(check.code).toBe(1);
    expect(check.stderr).toContain(
      'outdated (conflict): .claude/skills/orders-dev',
    );
    expect(check.stderr).toContain('remove or rename the existing directory');
    expect(check.stderr).not.toContain('run `bun run agentic compile`');
  });

  test('--check with a missing mirror link tells you to run compile', async () => {
    await bootstrapChanges(out);
    run('compile', '--out-root', out);
    await rm(join(out, '.claude/skills/orders-dev'));
    const check = run('compile', '--check', '--out-root', out);
    expect(check.code).toBe(1);
    expect(check.stderr).toContain(
      'outdated (mirror): .claude/skills/orders-dev',
    );
    expect(check.stderr).toContain('run `bun run agentic compile`');
    expect(check.stderr).not.toContain('remove or rename');
  });

  test('--check with a change without a proposal prints pending and exits 1', () => {
    run('compile', '--out-root', out);
    const check = run('compile', '--check', '--out-root', out);
    expect(check.code).toBe(1);
    expect(check.stderr).toContain('pending: there are ');
    expect(check.stderr).toContain('--draft-change <slug>');
  });

  test('--draft-change from the CLI creates the proposal and guides the next step', () => {
    const result = run(
      'compile',
      '--draft-change',
      'estado-inicial',
      '--out-root',
      out,
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      'proposal created at changes/0001-estado-inicial/proposal.md',
    );
    expect(result.stderr).toContain(
      'pending: proposal 0001: the ## Motivo section is empty',
    );
  });

  test('declaration error exits 1 and points to file:line', () => {
    const result = run(
      'compile',
      '--config',
      'test/fixtures/broken/agentic.config.ts',
      '--out-root',
      out,
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('domain/thing.ts:5:');
    expect(result.stderr).toContain('[validate.invariant-id-format]');
  });

  test('wrong usage exits 2', () => {
    expect(run('build').code).toBe(2);
    expect(run('compile', '--nada').code).toBe(2);
    expect(run('constructor').code).toBe(2);
  });

  test('--report prints tokens per file', () => {
    const result = run('compile', '--report', '--out-root', out);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      '| `.agentic/runtime/order-operator/SKILL.md` |',
    );
    expect(result.stdout).toContain('≈tokens');
  });

  test('lint error in write mode exits 1 but still writes', async () => {
    const result = run(
      'compile',
      '--config',
      'test/fixtures/long-description/agentic.config.ts',
      '--out-root',
      out,
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('[lint.description-length]');
    const skillPath = join(out, '.agentic/runtime/long-operator/SKILL.md');
    try {
      await access(skillPath);
      expect(true).toBe(true); // File exists
    } catch {
      expect.unreachable('File should exist');
    }
  });

  test('lint error in write mode does not archive the proposal or write the lock', async () => {
    const longConfig = 'test/fixtures/long-description/agentic.config.ts';
    const draft = run(
      'compile',
      '--config',
      longConfig,
      '--out-root',
      out,
      '--draft-change',
      'estado-inicial',
    );
    expect(draft.code).toBe(1);
    const proposalPath = join(out, 'changes/0001-estado-inicial/proposal.md');
    await writeFile(
      proposalPath,
      (await readFile(proposalPath, 'utf8')).replace(
        MOTIVO_PLACEHOLDER,
        'Estado inicial do domínio.',
      ),
    );
    const result = run('compile', '--config', longConfig, '--out-root', out);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('[lint.description-length]');
    const exists = (path: string) =>
      access(join(out, path)).then(
        () => true,
        () => false,
      );
    // the proposal stays open and the lock is not written
    expect(await exists('changes/0001-estado-inicial/proposal.md')).toBe(true);
    expect(await exists('changes/archive/0001-estado-inicial')).toBe(false);
    expect(await exists('.agentic/domain.lock.json')).toBe(false);
    expect(await exists('.agentic/mcp/snapshot.json')).toBe(false);
    // generated artifacts are still written (decision in c9b29b9)
    expect(await exists('.agentic/runtime/long-operator/SKILL.md')).toBe(true);
  });

  test('lint error in --check mode exits 1', () => {
    run(
      'compile',
      '--config',
      'test/fixtures/long-description/agentic.config.ts',
      '--out-root',
      out,
    );
    const checkResult = run(
      'compile',
      '--check',
      '--config',
      'test/fixtures/long-description/agentic.config.ts',
      '--out-root',
      out,
    );
    expect(checkResult.code).toBe(1);
    expect(checkResult.stderr).toContain('[lint.description-length]');
  });

  test('ir prints the canonical IR', () => {
    const result = run('ir');
    expect(result.code).toBe(0);
    const ir = JSON.parse(result.stdout) as {
      irVersion: number;
      operators: { id: string }[];
    };
    expect(ir.irVersion).toBe(1);
    expect(ir.operators.map((o) => o.id)).toEqual(['operator:order-operator']);
    expect(result.stdout.endsWith('}\n')).toBe(true);
  });

  test('ir with a declaration error exits 1', () => {
    const result = run(
      'ir',
      '--config',
      'test/fixtures/broken/agentic.config.ts',
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('domain/thing.ts:5:');
  });

  test('ir with an extra argument exits 2', () => {
    expect(run('ir', 'extra').code).toBe(2);
  });
});
