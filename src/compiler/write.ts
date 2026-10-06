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

export type DriftReason = 'missing' | 'changed' | 'extra' | 'mirror';

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

export function extractAgentsBlock(text: string): string | null {
  const begin = text.indexOf(BLOCK_BEGIN);
  const end = text.indexOf(BLOCK_END);
  if (begin === -1 || end === -1 || end < begin) return null;
  return text.slice(begin, end + BLOCK_END.length);
}

export function mergeAgentsBlock(
  existing: string | null,
  block: string,
): string {
  if (existing === null) return `# AGENTS.md\n\n${block}\n`;
  const current = extractAgentsBlock(existing);
  if (current === null) return `${existing.trimEnd()}\n\n${block}\n`;
  const begin = existing.indexOf(current);
  return `${existing.slice(0, begin)}${block}${existing.slice(begin + current.length)}`;
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
    const skill = await readOrNull(join(base, name, 'SKILL.md'));
    if (skill?.includes(GENERATED_MARK)) result.push(name);
  }
  return result;
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

  for (const [base, keep] of managedBases(config, rendered)) {
    for (const dir of await generatedSkillDirs(join(config.outRoot, base))) {
      await rm(join(config.outRoot, base, dir), {
        recursive: true,
        force: true,
      });
      if (!keep.includes(dir)) written.push(`${base}/${dir} (removido)`);
    }
  }

  for (const [path, content] of rendered.files) {
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
      if (resolve(mirrorDir, await readlink(link)).startsWith(skillsRoot)) {
        await rm(link, { force: true });
        written.push(`${mirror}/${name} (link removido)`);
      }
    }
    for (const dir of rendered.devSkillDirs) {
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

  for (const [path, content] of rendered.files) {
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
