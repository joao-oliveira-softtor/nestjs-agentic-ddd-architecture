import { lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { installSkills } from './install-skills';
import { shellQuote } from '../src/compiler/packet';

const FRAMEWORK = resolve(import.meta.dir, '..');
const ASSETS = join(FRAMEWORK, 'skills/agentic-ddd/assets/tasks');

export async function createSkillsExample(destination: string): Promise<void> {
  const root = resolve(destination);
  const existing = await lstat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (existing) throw new Error(`Destino já existe: ${root}`);
  await lstat(join(FRAMEWORK, 'node_modules/typescript/bin/tsc')).catch(() => {
    throw new Error(
      'Execute bun install --frozen-lockfile no checkout do framework antes de criar o exemplo.',
    );
  });
  // Materialize proposal before declarations. No compile or solution tests are applied here.
  await mkdir(dirname(root), { recursive: true });
  await mkdir(root);
  const put = async (path: string, content: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content, { flag: 'wx' });
  };
  await put(
    'changes/0001-tasks/proposal.md',
    await readFile(join(ASSETS, 'proposal.md'), 'utf8'),
  );
  for await (const file of new Bun.Glob('**/*.ts.txt').scan({
    cwd: ASSETS,
    onlyFiles: true,
  })) {
    await put(
      `app/${file.slice(0, -4)}`,
      await readFile(join(ASSETS, file), 'utf8'),
    );
  }
  const tsc = join(FRAMEWORK, 'node_modules/typescript/bin/tsc');
  await put(
    'package.json',
    JSON.stringify(
      {
        name: 'agentic-ddd-tasks-tutorial',
        private: true,
        type: 'module',
        scripts: {
          agentic: `bun ${shellQuote(join(FRAMEWORK, 'src/cli/main.ts'))}`,
          typecheck: `bun ${shellQuote(tsc)} --noEmit --project tsconfig.json`,
          test: 'bun test',
        },
      },
      null,
      2,
    ) + '\n',
  );
  await put(
    'tsconfig.json',
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2023',
          module: 'preserve',
          moduleResolution: 'bundler',
          strict: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
          skipLibCheck: true,
          noEmit: true,
          types: ['bun'],
          paths: {
            '@agentic-ddd/*': [join(FRAMEWORK, 'src/*/index.ts')],
            zod: [join(FRAMEWORK, 'node_modules/zod')],
          },
        },
        include: ['app/**/*.ts', 'agentic.config.ts'],
      },
      null,
      2,
    ) + '\n',
  );
  await put(
    'agentic.config.ts',
    `import { defineConfig } from '@agentic-ddd/compiler';\nexport default defineConfig({ modules: [{ name: 'tasks', path: 'app' }], verify: { test: ['bun', 'test'], commands: { typecheck: ['bun', ${JSON.stringify(tsc)}, '--noEmit', '--project', 'tsconfig.json'] } } });\n`,
  );
  await symlink(
    join(FRAMEWORK, 'node_modules'),
    join(root, 'node_modules'),
    'dir',
  );
  await put(
    'AGENTS.md',
    '# Tutorial tasks\n\nUse a skill autoral agentic-ddd instalada e a skill gerada tasks-dev após compile. Executor altera somente corpo atribuído e testes; preserve imports, contratos, propostas e gerados.\n',
  );
  await put('.gitignore', 'node_modules/\n');
  await installSkills({ root, scope: 'project', target: 'all' });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (
    args.length !== 2 ||
    args[0] !== '--root' ||
    !args[1] ||
    args[1].startsWith('--')
  ) {
    console.error('Uso: bun run skills:example --root <destino-inexistente>');
    process.exit(2);
  }
  try {
    await createSkillsExample(args[1]);
    console.log(
      `Workspace criado: ${resolve(args[1])}\nPróximo: bun run agentic compile`,
    );
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
