import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { ResolvedConfig } from './config.js';
import { toPosix } from './ir.js';
import { BLOCK_BEGIN, BLOCK_END } from './render/agents-md.js';
import type { Rendered } from './render/index.js';

export type DriftReason =
  'missing' | 'changed' | 'extra' | 'mirror' | 'conflict';

export interface Drift {
  readonly path: string;
  readonly reason: DriftReason;
}

export interface WriteResult {
  readonly written: string[];
  readonly warnings: string[];
}

export const GENERATED_MARK = 'agentic-ddd.generated: "true"';
export const CLAUDE_MD_CONTENT = '@AGENTS.md\n';

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function lstatOrNull(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch {
    return null;
  }
}

function locateAgentsBlock(
  text: string,
): { start: number; end: number } | null {
  let offset = 0;
  let begin: number | null = null;
  let end: number | null = null;
  for (const line of text.split('\n')) {
    const marker = line.trim();
    if (marker === BLOCK_BEGIN) {
      begin = offset + (line.length - line.trimStart().length);
      end = null;
    } else if (marker === BLOCK_END && begin !== null && end === null) {
      end = offset + line.trimEnd().length;
    }
    offset += line.length + 1;
  }
  return begin === null || end === null ? null : { start: begin, end };
}

export function extractAgentsBlock(text: string): string | null {
  const located = locateAgentsBlock(text);
  return located === null ? null : text.slice(located.start, located.end);
}

export function mergeAgentsBlock(
  existing: string | null,
  block: string,
): string {
  if (existing === null) return `# AGENTS.md\n\n${block}\n`;
  const located = locateAgentsBlock(existing);
  if (located === null) return `${existing.trimEnd()}\n\n${block}\n`;
  return `${existing.slice(0, located.start)}${block}${existing.slice(located.end)}`;
}

function isGenerated(skill: string | null): boolean {
  if (skill === null) return false;
  const lines = skill.split('\n');
  if (lines[0]?.trim() !== '---') return false;
  const close = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  return (
    close !== -1 &&
    lines.slice(1, close).some((line) => line.includes(GENERATED_MARK))
  );
}

async function generatedSkillDirs(base: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(base);
  } catch {
    return [];
  }
  const result: string[] = [];
  for (const name of names.sort()) {
    if (isGenerated(await readOrNull(join(base, name, 'SKILL.md'))))
      result.push(name);
  }
  return result;
}

async function conflictingDirs(
  config: ResolvedConfig,
  rendered: Rendered,
): Promise<Set<string>> {
  const conflicts = new Set<string>();
  for (const [base, keep] of managedBases(config, rendered)) {
    for (const dir of keep) {
      const absolute = join(config.outRoot, base, dir);
      if ((await lstatOrNull(absolute)) === null) continue;
      if (!isGenerated(await readOrNull(join(absolute, 'SKILL.md'))))
        conflicts.add(`${base}/${dir}`);
    }
  }
  return conflicts;
}

function inConflict(conflicts: ReadonlySet<string>, path: string): boolean {
  for (const dir of conflicts) if (path.startsWith(`${dir}/`)) return true;
  return false;
}

async function listFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const file of new Bun.Glob('**/*').scan({
    cwd: dir,
    onlyFiles: true,
    dot: true,
  }))
    files.push(toPosix(file));
  return files.sort();
}

function managedBases(
  config: ResolvedConfig,
  rendered: Rendered,
): [string, readonly string[]][] {
  return [
    [config.out.devSkills, rendered.devSkillDirs],
    [config.out.runtimeSkills, rendered.runtimeSkillDirs],
  ];
}

function mirrorTarget(
  config: ResolvedConfig,
  mirror: string,
  dir: string,
): string {
  return toPosix(
    relative(
      join(config.outRoot, mirror),
      join(config.outRoot, config.out.devSkills, dir),
    ),
  );
}

export async function writeOutputs(
  config: ResolvedConfig,
  rendered: Rendered,
): Promise<WriteResult> {
  const written: string[] = [];
  const warnings: string[] = [];
  const conflicts = await conflictingDirs(config, rendered);
  for (const dir of [...conflicts].sort()) {
    warnings.push(
      `${dir} existe e não foi gerado pelo agentic-ddd; não foi sobrescrito`,
    );
  }

  const removedOrphans = new Set<string>();
  for (const [base, keep] of managedBases(config, rendered)) {
    for (const dir of await generatedSkillDirs(join(config.outRoot, base))) {
      const absolute = join(config.outRoot, base, dir);
      await rm(absolute, { recursive: true, force: true });
      if (!keep.includes(dir)) {
        removedOrphans.add(resolve(absolute));
        written.push(`${base}/${dir} (removido)`);
      }
    }
  }

  for (const [path, content] of rendered.files) {
    if (inConflict(conflicts, path)) continue;
    const absolute = join(config.outRoot, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
    written.push(path);
  }

  const agentsPath = join(config.outRoot, config.out.agentsMd);
  await mkdir(dirname(agentsPath), { recursive: true });
  await writeFile(
    agentsPath,
    mergeAgentsBlock(await readOrNull(agentsPath), rendered.agentsBlock),
  );
  written.push(config.out.agentsMd);

  const claudePath = join(config.outRoot, config.out.claudeMd);
  if ((await readOrNull(claudePath)) === null) {
    await writeFile(claudePath, CLAUDE_MD_CONTENT);
    written.push(config.out.claudeMd);
  }

  const skillsRoot = `${resolve(config.outRoot, config.out.devSkills)}${sep}`;
  for (const mirror of config.mirrors) {
    const mirrorDir = join(config.outRoot, mirror);
    await mkdir(mirrorDir, { recursive: true });
    for (const name of (await readdir(mirrorDir)).sort()) {
      const link = join(mirrorDir, name);
      const stat = await lstat(link);
      if (!stat.isSymbolicLink() || rendered.devSkillDirs.includes(name))
        continue;
      const target = resolve(mirrorDir, await readlink(link));
      const dangling =
        target.startsWith(skillsRoot) && (await lstatOrNull(target)) === null;
      if (dangling || removedOrphans.has(target)) {
        await rm(link, { force: true });
        written.push(`${mirror}/${name} (link removido)`);
      }
    }
    for (const dir of rendered.devSkillDirs) {
      if (conflicts.has(`${config.out.devSkills}/${dir}`)) continue;
      const link = join(mirrorDir, dir);
      const stat = await lstatOrNull(link);
      if (stat && !stat.isSymbolicLink()) {
        warnings.push(
          `${mirror}/${dir} existe e não é um link; não foi substituído`,
        );
        continue;
      }
      if (stat) await rm(link, { force: true });
      await symlink(mirrorTarget(config, mirror, dir), link);
      written.push(`${mirror}/${dir}`);
    }
  }

  return { written, warnings };
}

export async function checkOutputs(
  config: ResolvedConfig,
  rendered: Rendered,
): Promise<Drift[]> {
  const drift: Drift[] = [];
  const conflicts = await conflictingDirs(config, rendered);
  for (const dir of conflicts) drift.push({ path: dir, reason: 'conflict' });

  for (const [path, content] of rendered.files) {
    if (inConflict(conflicts, path)) continue;
    const actual = await readOrNull(join(config.outRoot, path));
    if (actual === null) drift.push({ path, reason: 'missing' });
    else if (actual !== content) drift.push({ path, reason: 'changed' });
  }

  for (const [base, keep] of managedBases(config, rendered)) {
    for (const dir of await generatedSkillDirs(join(config.outRoot, base))) {
      if (!keep.includes(dir)) {
        drift.push({ path: `${base}/${dir}`, reason: 'extra' });
        continue;
      }
      for (const file of await listFiles(join(config.outRoot, base, dir))) {
        const path = `${base}/${dir}/${file}`;
        if (!rendered.files.has(path)) drift.push({ path, reason: 'extra' });
      }
    }
  }

  const agents = await readOrNull(join(config.outRoot, config.out.agentsMd));
  const block = agents === null ? null : extractAgentsBlock(agents);
  if (block === null)
    drift.push({ path: config.out.agentsMd, reason: 'missing' });
  else if (block !== rendered.agentsBlock)
    drift.push({ path: config.out.agentsMd, reason: 'changed' });

  if ((await readOrNull(join(config.outRoot, config.out.claudeMd))) === null) {
    drift.push({ path: config.out.claudeMd, reason: 'missing' });
  }

  for (const mirror of config.mirrors) {
    for (const dir of rendered.devSkillDirs) {
      if (conflicts.has(`${config.out.devSkills}/${dir}`)) continue;
      const link = join(config.outRoot, mirror, dir);
      const stat = await lstatOrNull(link);
      if (
        !stat?.isSymbolicLink() ||
        (await readlink(link)) !== mirrorTarget(config, mirror, dir)
      ) {
        drift.push({ path: `${mirror}/${dir}`, reason: 'mirror' });
      }
    }
  }

  return drift.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
