import { lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { toPosix } from '../src/contracts/ir';
import { match, P } from 'ts-pattern';
import { installSkills } from './install-skills';
import { shellQuote } from '../src/compiler/packet';

const FRAMEWORK = resolve(import.meta.dir, '..');
export type Tutorial = 'tasks' | 'matriculas';

const AGENTS_TEXT = (tutorial: Tutorial) =>
  `# Tutorial ${tutorial}\n\nUse a skill autoral agentic-ddd instalada e a skill gerada ${tutorial}-dev após compile. Executor altera somente corpo atribuído e testes; preserve imports, contratos, propostas e gerados.\n`;

export async function createSkillsExample(
  destination: string,
  tutorial: Tutorial = 'tasks',
): Promise<void> {
  const ASSETS = join(FRAMEWORK, 'skills/agentic-ddd/assets', tutorial);
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
    `changes/0001-${tutorial}/proposal.md`,
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
  // Caminhos gravados com `/` em qualquer SO (Bun e tsc aceitam no Windows).
  const fw = (path: string) => toPosix(join(FRAMEWORK, path));
  const tsc = fw('node_modules/typescript/bin/tsc');
  await put(
    'package.json',
    JSON.stringify(
      {
        name: `agentic-ddd-${tutorial}-tutorial`,
        private: true,
        type: 'module',
        scripts: {
          agentic: `bun ${shellQuote(fw('src/cli/main.ts'))}`,
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
            '@agentic-ddd/*': [fw('src/*/index.ts')],
            zod: [fw('node_modules/zod')],
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
    `import { defineConfig } from '@agentic-ddd/compiler';\nexport default defineConfig({ modules: [{ name: '${tutorial}', path: 'app' }], verify: { test: ['bun', 'test'], commands: { typecheck: ['bun', ${JSON.stringify(tsc)}, '--noEmit', '--project', 'tsconfig.json'] } } });\n`,
  );
  await symlink(
    join(FRAMEWORK, 'node_modules'),
    join(root, 'node_modules'),
    'dir',
  );
  await put('AGENTS.md', AGENTS_TEXT(tutorial));
  await put(
    '.ai/rules/testes.md',
    "---\npaths: ['app/**']\n---\n- Títulos de teste em português, descrevendo o comportamento observado.\n",
  );
  await put('.gitignore', 'node_modules/\n');
  await installSkills({ root, scope: 'project', target: 'all' });
}

if (import.meta.main) {
  const notFlag = P.string.regex(/^[^-].*/);
  const parsed = match(process.argv.slice(2))
    .with(['--root', notFlag], ([, root]) => ({
      root,
      tutorial: 'tasks' as Tutorial,
    }))
    .with(
      ['--root', notFlag, '--tutorial', P.union('tasks', 'matriculas')],
      ([, root, , tutorial]) => ({ root, tutorial }),
    )
    .otherwise(() => null);
  if (!parsed) {
    console.error(
      'Uso: bun run skills:example --root <destino-inexistente> [--tutorial tasks|matriculas]',
    );
    process.exit(2);
  }
  try {
    await createSkillsExample(parsed.root, parsed.tutorial);
    console.log(
      `Workspace criado: ${resolve(parsed.root)}\nPróximo: bun run agentic compile`,
    );
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
