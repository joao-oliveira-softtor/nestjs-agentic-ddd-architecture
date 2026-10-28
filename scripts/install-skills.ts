import { match } from 'ts-pattern';
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
  mcp?: boolean;
}
type Artifact =
  { path: string; content: string } | { path: string; link: string };
const DESCRIPTIONS = {
  manager:
    'Prepares agentic-ddd proposals and contracts and coordinates sequential execution through packet and verify.',
  executor:
    'Implements only assigned agentic-ddd bodies and tests, keeping contracts and the packet hash.',
  reviewer:
    'Reviews the diff against the agentic-ddd contract and gates, citing rule or gate IDs, without editing files.',
};
const ROLE_NAMES = {
  manager: 'manager',
  executor: 'executor',
  reviewer: 'reviewer',
} as const;
// Cursor usa o mesmo formato do Claude: o cursor-agent não expande ${workspaceFolder} (validado na #68).
const mcpJson = (cli: string) =>
  JSON.stringify(
    { mcpServers: { 'agentic-ddd': { command: 'bun', args: [cli, 'mcp'] } } },
    null,
    2,
  ) + '\n';
const MCP_CONFIG = {
  claude: { path: '.mcp.json', content: mcpJson },
  cursor: { path: '.cursor/mcp.json', content: mcpJson },
  codex: {
    path: '.codex/config.toml',
    content: (cli: string) =>
      '# Instalado por skills:install --mcp.\n[mcp_servers.agentic-ddd]\ncommand = "bun"\nargs = ' +
      JSON.stringify([cli, 'mcp']) +
      '\n',
  },
} satisfies Record<Target, { path: string; content: (cli: string) => string }>;

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
    for (const role of ['manager', 'executor', 'reviewer'] as const) {
      // Links com `/` em qualquer SO, para o adaptador não mudar entre plataformas.
      const skill = `${target === 'claude' ? '.claude' : '.agents'}/skills/agentic-ddd`;
      const base =
        options.scope === 'user'
          ? join(options.root, skill).split('\\').join('/')
          : skill;
      const moduleSkill =
        role === 'reviewer'
          ? ''
          : ' Also read the generated skill of the module named by the configuration.';
      // O revisor lê só a própria referência: a skill geral manda ler configuração e skill do módulo.
      const reading =
        role === 'reviewer'
          ? `Read only the [role instructions](${base}/references/reviewer.md) before acting`
          : `Read the [skill](${base}/SKILL.md) and the [role instructions](${base}/references/${role}.md) before acting`;
      const instructions = `You are the agentic-ddd ${ROLE_NAMES[role]}. ${reading}. Relative paths resolve from the project root.${moduleSkill} Follow the role contract; return results and findings to the main session when there is no nested delegation.`;
      const name = `agentic-ddd-${role}`;
      const content =
        target === 'codex'
          ? `# Installed by skills:install; shared instructions live in the authored source.\nname = ${JSON.stringify(name)}\ndescription = ${JSON.stringify(DESCRIPTIONS[role])}\ndeveloper_instructions = ${JSON.stringify(instructions)}\n`
          : `---\nname: ${name}\ndescription: ${JSON.stringify(DESCRIPTIONS[role])}\nmodel: inherit\n${target === 'claude' && role !== 'reviewer' ? 'skills:\n  - agentic-ddd\n' : ''}---\n\n<!-- Installed by skills:install; shared instructions live in the authored source. -->\n\n${instructions}\n`;
      result.push({
        path: join(
          options.root,
          `.${target}/agents/${name}.${target === 'codex' ? 'toml' : 'md'}`,
        ),
        content,
      });
    }
  if (options.mcp) {
    const cli = relative(
      options.root,
      resolve(import.meta.dir, '../src/cli/main.ts'),
    )
      .split('\\')
      .join('/');
    for (const target of targets)
      result.push({
        path: join(options.root, MCP_CONFIG[target].path),
        content: MCP_CONFIG[target].content(cli),
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
  let scope = 'project' as InstallOptions['scope'];
  let target = 'all' as InstallOptions['target'];
  let root: string | undefined;
  let check = false;
  let mcp = false;
  for (let i = 0; i < args.length; i++) {
    match(args[i])
      .with('--check', () => {
        check = true;
      })
      .with('--mcp', () => {
        mcp = true;
      })
      .with('--scope', '--target', '--root', (flag) => {
        const value = args[++i];
        if (!value || value.startsWith('--'))
          throw new Error(`${flag} exige valor`);
        match(flag)
          .with('--scope', () => {
            if (value !== 'project' && value !== 'user')
              throw new Error('--scope exige project|user');
            scope = value;
          })
          .with('--target', () => {
            if (!['all', 'cursor', 'codex', 'claude'].includes(value))
              throw new Error('--target exige cursor|codex|claude|all');
            target = value as InstallOptions['target'];
          })
          .with('--root', () => {
            root = value;
          })
          .exhaustive();
      })
      .otherwise((flag) => {
        throw new Error(`Opção inválida: ${flag}`);
      });
  }
  if (mcp && scope === 'user')
    throw new Error('--mcp só vale com --scope project');
  return {
    scope,
    target,
    root: resolve(root ?? (scope === 'user' ? homedir() : process.cwd())),
    check,
    mcp,
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
