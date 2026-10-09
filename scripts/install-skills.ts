import {
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

export const SKILL_SOURCE = resolve(import.meta.dir, '../skills/agentic-ddd');
type Target = 'cursor' | 'codex' | 'claude';
export interface InstallOptions {
  root: string;
  scope: 'project' | 'user';
  target: Target | 'all';
  check?: boolean;
}
type Artifact =
  { path: string; content: string } | { path: string; link: string };
const DESCRIPTIONS = {
  manager:
    'Prepara propostas e contratos agentic-ddd e coordena execução sequencial por packet e verify.',
  executor:
    'Implementa somente corpos atribuídos e testes agentic-ddd, preservando contratos e o hash do packet.',
};

function artifacts(options: InstallOptions): Artifact[] {
  const targets: Target[] =
    options.target === 'all' ? ['cursor', 'codex', 'claude'] : [options.target];
  const result: Artifact[] = [];
  if (targets.some((t) => t !== 'claude'))
    result.push({
      path: join(options.root, '.agents/skills/agentic-ddd'),
      link: SKILL_SOURCE,
    });
  if (targets.includes('claude'))
    result.push({
      path: join(options.root, '.claude/skills/agentic-ddd'),
      link: SKILL_SOURCE,
    });
  for (const target of targets)
    for (const role of ['manager', 'executor'] as const) {
      const skill = join(
        target === 'claude' ? '.claude' : '.agents',
        'skills/agentic-ddd',
      );
      const base = options.scope === 'user' ? join(options.root, skill) : skill;
      const instructions = `Você é o ${role === 'manager' ? 'gerente' : 'executor'} agentic-ddd. Leia [skill](${base}/SKILL.md) e [instruções do papel](${base}/references/${role}.md) antes de agir. Caminhos relativos são resolvidos a partir da raiz do projeto. Consulte também a skill gerada do módulo indicado pela configuração. Siga o contrato do papel; devolva resultados e findings para a sessão principal quando não houver delegação aninhada.`;
      const name = `agentic-ddd-${role}`;
      const content =
        target === 'codex'
          ? `# Instalado por skills:install; instruções compartilhadas na fonte autoral.\nname = ${JSON.stringify(name)}\ndescription = ${JSON.stringify(DESCRIPTIONS[role])}\ndeveloper_instructions = ${JSON.stringify(instructions)}\n`
          : `---\nname: ${name}\ndescription: ${JSON.stringify(DESCRIPTIONS[role])}\nmodel: inherit\n${target === 'claude' ? 'skills:\n  - agentic-ddd\n' : ''}---\n\n<!-- Instalado por skills:install; instruções compartilhadas na fonte autoral. -->\n\n${instructions}\n`;
      result.push({
        path: join(
          options.root,
          `.${target}/agents/${name}.${target === 'codex' ? 'toml' : 'md'}`,
        ),
        content,
      });
    }
  return result;
}

async function info(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Preflight every artifact and parent beneath root before writing. Identical installs are untouched. */
export async function installSkills(
  options: InstallOptions,
): Promise<string[]> {
  const root = resolve(options.root);
  await readFile(join(SKILL_SOURCE, 'SKILL.md'), 'utf8');
  const plan = artifacts({ ...options, root });
  const missing: Artifact[] = [];
  const conflicts: string[] = [];
  for (const artifact of plan) {
    for (
      let parent = dirname(artifact.path);
      parent !== root;
      parent = dirname(parent)
    ) {
      const stat = await info(parent);
      if (stat && !stat.isDirectory())
        conflicts.push(
          `${parent}: pai não é diretório (links não são substituídos)`,
        );
    }
    const stat = await info(artifact.path).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOTDIR') return null;
        throw error;
      },
    );
    if (!stat) {
      missing.push(artifact);
      continue;
    }
    const matches =
      'link' in artifact
        ? stat.isSymbolicLink() &&
          resolve(
            await realpath(dirname(artifact.path)),
            await readlink(artifact.path),
          ) === artifact.link &&
          (await realpath(artifact.path)) === (await realpath(SKILL_SOURCE))
        : stat.isFile() &&
          (await readFile(artifact.path, 'utf8')) === artifact.content;
    if (!matches)
      conflicts.push(
        `${artifact.path}: conflito; recuso substituir arquivo/link existente`,
      );
  }
  if (conflicts.length) throw new Error([...new Set(conflicts)].join('\n'));
  if (options.check && missing.length)
    throw new Error(
      `Instalação incompleta:\n${missing.map((a) => a.path).join('\n')}`,
    );
  for (const artifact of missing) {
    await mkdir(dirname(artifact.path), { recursive: true });
    if ('link' in artifact)
      await symlink(
        relative(await realpath(dirname(artifact.path)), artifact.link),
        artifact.path,
        'dir',
      );
    else await writeFile(artifact.path, artifact.content, { flag: 'wx' });
  }
  return plan.map((a) => a.path);
}

export function parseInstallArgs(args: string[]): InstallOptions {
  let scope: InstallOptions['scope'] = 'project';
  let target: InstallOptions['target'] = 'all';
  let root: string | undefined;
  let check = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--check') {
      check = true;
      continue;
    }
    if (!['--scope', '--target', '--root'].includes(flag!))
      throw new Error(`Opção inválida: ${flag}`);
    const value = args[++i];
    if (!value || value.startsWith('--'))
      throw new Error(`${flag} exige valor`);
    if (flag === '--scope') {
      if (value !== 'project' && value !== 'user')
        throw new Error('--scope exige project|user');
      scope = value;
    } else if (flag === '--target') {
      if (!['all', 'cursor', 'codex', 'claude'].includes(value))
        throw new Error('--target exige cursor|codex|claude|all');
      target = value as InstallOptions['target'];
    } else root = value;
  }
  return {
    scope,
    target,
    root: resolve(root ?? (scope === 'user' ? homedir() : process.cwd())),
    check,
  };
}

if (import.meta.main) {
  let options: InstallOptions;
  try {
    options = parseInstallArgs(process.argv.slice(2));
  } catch (error) {
    console.error(String(error));
    process.exit(2);
  }
  try {
    for (const path of await installSkills(options)) console.log(path);
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
