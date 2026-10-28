import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { auditDirectory } from './package-audit';

const repo = resolve(import.meta.dir, '..');
const workspace = await mkdtemp(join(tmpdir(), 'agentic-package-'));
const consumer = join(workspace, 'consumer');
async function run(command: string[], cwd = consumer): Promise<string> {
  const child = Bun.spawn(command, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    // Do not let a shared workspace NODE_PATH supply missing dependencies.
    env: { ...process.env, NODE_PATH: '' },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw new Error(
      `${command.join(' ')} exited ${code}\n${stdout}\n${stderr}`,
    );
  return stdout;
}
// Reads newline-delimited JSON-RPC from stdout until the reply with `id` arrives.
async function readReply(
  stdout: ReadableStream<Uint8Array>,
  id: number,
): Promise<{ result?: { isError?: boolean } }> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of stdout as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id === id) return msg;
    }
  }
  throw new Error(`stdout closed before reply ${id}`);
}
try {
  console.log('Packing and auditing the actual npm tarball...');
  const packed = JSON.parse(
    await run(['npm', 'pack', '--json', '--pack-destination', workspace], repo),
  ) as { filename: string; files: { path: string }[] }[];
  const pack = packed[0]!;
  const tarball = join(workspace, pack.filename);
  await mkdir(join(workspace, 'unpacked'));
  // Caminhos relativos ao workspace: o GNU tar do Git Bash lê `C:` como host remoto.
  await run(['tar', '-xzf', pack.filename, '-C', 'unpacked'], workspace);
  const paths = pack.files.map((f) => f.path);
  await auditDirectory(join(workspace, 'unpacked/package'), paths);
  console.log(`Audited ${paths.length} distributed files.`);
  const pkg = JSON.parse(
    await readFile(join(repo, 'package.json'), 'utf8'),
  ) as {
    name: string;
    dependencies: Record<string, string>;
    peerDependencies: Record<string, string>;
  };
  await cp(join(repo, 'test/fixtures/package-consumer'), consumer, {
    recursive: true,
  });
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify(
      {
        name: 'isolated-package-consumer',
        private: true,
        type: 'module',
        dependencies: {
          [pkg.name]: `file:${tarball}`,
          ...pkg.peerDependencies,
          zod: pkg.dependencies.zod,
        },
        devDependencies: {
          typescript: pkg.dependencies.typescript,
          '@types/node': '^24.0.0',
        },
      },
      null,
      2,
    ),
  );
  console.log('Installing into an isolated consumer with npm...');
  await run(['npm', 'install', '--no-audit', '--no-fund']);
  await run(['node', 'node_modules/typescript/bin/tsc', '-p', 'tsconfig.json']);
  await run([
    'node',
    'node_modules/typescript/bin/tsc',
    '-p',
    'tsconfig.json',
    '--module',
    'preserve',
    '--moduleResolution',
    'bundler',
  ]);
  const blocked = await run([
    'node',
    '--input-type=module',
    '-e',
    `try { await import('${pkg.name}/dist/decorators/registry.js'); process.exit(1); } catch(e) { if (e.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw e; }`,
  ]);
  void blocked;
  const cli = join(consumer, 'node_modules/.bin/agentic-ddd');
  await run([cli, 'compile']);
  await run([cli, 'compile', '--check']);
  await run([
    'bun',
    '-e',
    `const mod = await import('${pkg.name}/mcp'); if (typeof mod.startMcpServer !== 'function') throw new Error('startMcpServer is not exported');`,
  ]);
  await run([
    'bun',
    '-e',
    `const mod = await import('${pkg.name}/elysia'); if (typeof mod.agentic !== 'function') throw new Error('agentic is not exported');`,
  ]);
  const mcp = Bun.spawn([cli, 'mcp', '--root', consumer], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const timer = setTimeout(() => mcp.kill(), 30_000);
  void mcp.stdin.write(
    [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'smoke', version: '1' },
        },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'domain_overview', arguments: {} },
      },
    ]
      .map((m) => `${JSON.stringify(m)}\n`)
      .join(''),
  );
  const reply = await readReply(mcp.stdout, 2);
  assert(
    reply.result && reply.result.isError !== true,
    `domain_overview failed over stdio: ${JSON.stringify(reply).slice(0, 500)}`,
  );
  void mcp.stdin.end();
  assert.equal(
    await mcp.exited,
    0,
    'agentic-ddd mcp must exit 0 when stdin closes',
  );
  clearTimeout(timer);
  const source = JSON.parse(
    (await run(['bun', 'src/run.ts'])).trim().split('\n').at(-1)!,
  ) as { hash: string; source: string; status: string };
  console.log(
    'Consumer source: imports, declarations, CLI skills and Nest DI passed.',
  );
  await run([
    'bun',
    '-e',
    `
    const result = await Bun.build({
      entrypoints: ['./src/run.ts'], root: '.', outdir: '.', naming: 'bundle.js',
      target: 'bun', sourcemap: 'linked',
      external: ['@nestjs/*', 'reflect-metadata', 'rxjs', 'zod', 'typescript'],
    });
    if (!result.success) throw new Error(result.logs.join('\\n'));
  `,
  ]);
  const bundled = JSON.parse(
    (await run(['bun', './bundle.js'])).trim().split('\n').at(-1)!,
  );
  assert.deepEqual(
    bundled,
    source,
    'Bundled consumer must preserve source locations, IR hash and DI result',
  );
  assert.equal(source.status, 'completed');
  const agents = await readFile(join(consumer, 'AGENTS.md'), 'utf8');
  assert(agents.includes(`${pkg.name}/decorators`));
  assert(!agents.includes('@agentic-ddd/'));
  assert(agents.includes('bun run agentic-ddd status'));
  assert(!/\bbun run agentic\b(?!-ddd)/.test(agents));
  await run(['bun', 'run', 'agentic-ddd', 'status', '--static']);
  console.log(
    `Package smoke passed (source + bundle, IR ${source.hash}, ${source.source}).`,
  );
} finally {
  await rm(workspace, { recursive: true, force: true });
}
