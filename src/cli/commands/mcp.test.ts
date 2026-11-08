import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EMPTY_IR } from '../../compiler/diff';
import {
  createPublishedLock,
  serializePublishedLock,
} from '../../compiler/published';
import {
  SHORT_PATH_TEST_TIMEOUT_MS,
  shortPath,
} from '../../../test/helpers/short-path';
import { mcpCommand } from './mcp';
import { DEFAULT_CONVENTIONS } from '../../compiler/conventions';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agentic-mcp-'));
  await mkdir(join(dir, 'models'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// A config file whose mcp section is `mcp` (source text), or no mcp section at all.
async function configFile(mcp?: string): Promise<string> {
  const file = join(dir, 'agentic.config.ts');
  const section = mcp === undefined ? '' : `, mcp: ${mcp}`;
  await writeFile(
    file,
    `export default { modules: [{ name: 'x', path: 'models' }]${section} };\n`,
  );
  return file;
}

const MCP =
  "{ issuer: 'https://auth.example.com', resource: 'https://orders.example.com/mcp' }";

// Records the HTTP start options and stops the command on the next tick, as SIGINT would.
function httpLoad(calls: unknown[]) {
  return () =>
    Promise.resolve({
      startMcpServer: () => ({ close: () => {} }),
      startMcpHttpServer: (options: unknown) => {
        calls.push(options);
        setTimeout(() => process.emit('SIGINT'), 0);
        return Promise.resolve({ port: 4321, close: () => {} });
      },
    });
}

function captureErrors() {
  return spyOn(console, 'error').mockImplementation(() => {});
}

describe('mcpCommand', () => {
  test('missing SDK: explains the install and exits 1', async () => {
    const error = spyOn(console, 'error').mockImplementation(() => {});
    const code = await mcpCommand([], () =>
      Promise.reject(
        Object.assign(
          new Error(
            "Cannot find package '@modelcontextprotocol/server' imported from x",
          ),
          { code: 'ERR_MODULE_NOT_FOUND' },
        ),
      ),
    );
    const messages = error.mock.calls.flat().join('\n');
    error.mockRestore();
    expect(code).toBe(1);
    expect(messages).toContain('@modelcontextprotocol/server@2.3.1');
    expect(messages).toContain('[cli.mcp-sdk-missing]');
  });

  test('other load errors are rethrown', async () => {
    const failure = await mcpCommand([], () =>
      Promise.reject(new Error('boom')),
    ).catch((e: Error) => e);
    expect((failure as Error).message).toBe('boom');
  });

  test.each([
    [
      'the given --config, resolved',
      ['--config', 'sub/a.config.ts'],
      'sub/a.config.ts',
    ],
    ['agentic.config.ts under --root by default', [], 'agentic.config.ts'],
  ])('stdio hands the server %s', async (_, extra, file) => {
    const starts: unknown[] = [];
    const stop = setTimeout(() => process.stdin.emit('end'), 0);
    const code = await mcpCommand(['--root', dir, ...extra], () =>
      Promise.resolve({
        startMcpServer: (options: unknown) => {
          starts.push(options);
          return { close: () => {} };
        },
        startMcpHttpServer: () => Promise.reject(new Error('unused')),
      }),
    );
    clearTimeout(stop);
    expect(code).toBe(0);
    expect(starts[0]).toMatchObject({
      config: file === 'agentic.config.ts' ? join(dir, file) : resolve(file),
    });
  });

  test('--http starts on 127.0.0.1:3333 with the config mcp section', async () => {
    const calls: unknown[] = [];
    const error = captureErrors();
    const config = await configFile(MCP);
    const code = await mcpCommand(
      ['--http', '--config', config],
      httpLoad(calls),
    );
    const messages = error.mock.calls.flat().join('\n');
    error.mockRestore();
    expect(code).toBe(0);
    // The config also reaches the server: propose_change compiles with it.
    expect(calls).toEqual([
      {
        root: process.cwd(),
        config,
        port: 3333,
        host: '127.0.0.1',
        mcp: {
          issuer: 'https://auth.example.com',
          resource: 'https://orders.example.com/mcp',
        },
      },
    ]);
    expect(messages).toContain(
      'agentic-ddd mcp listening on http://127.0.0.1:4321/mcp',
    );
  });

  test('--http passes --root, --port and --host through', async () => {
    const calls: unknown[] = [];
    const error = captureErrors();
    const code = await mcpCommand(
      [
        '--http',
        '--root',
        dir,
        '--port',
        '0',
        '--host',
        '::1',
        '--config',
        await configFile(MCP),
      ],
      httpLoad(calls),
    );
    const messages = error.mock.calls.flat().join('\n');
    error.mockRestore();
    expect(code).toBe(0);
    expect(calls[0]).toMatchObject({ root: dir, port: 0, host: '::1' });
    expect(messages).toContain('http://[::1]:4321/mcp');
  });

  test('--http prints an IPv6 host in brackets exactly once', async () => {
    for (const [host, shown] of [
      ['::1', '[::1]'],
      ['[::1]', '[::1]'],
      ['127.0.0.1', '127.0.0.1'],
    ]) {
      const calls: unknown[] = [];
      const error = captureErrors();
      const code = await mcpCommand(
        ['--http', '--host', host, '--config', await configFile(MCP)],
        httpLoad(calls),
      );
      const messages = error.mock.calls.flat().join('\n');
      error.mockRestore();
      expect(code).toBe(0);
      expect(calls[0]).toMatchObject({ host });
      expect(messages).toContain(`http://${shown}:4321/mcp`);
    }
  });

  test('--port or --host without --http is a usage error (exit 2)', async () => {
    const load = mock(() => Promise.reject(new Error('must not load')));
    for (const args of [
      ['--port', '4000'],
      ['--host', '0.0.0.0'],
    ]) {
      const error = captureErrors();
      const code = await mcpCommand(args, load);
      const messages = error.mock.calls.flat().join('\n');
      error.mockRestore();
      expect(code).toBe(2);
      expect(messages).toContain('[cli.http-option-requires-http]');
      expect(messages).toContain(
        'agentic-ddd mcp [--root <dir>] [--config <file>] [--published',
      );
    }
    expect(load).not.toHaveBeenCalled();
  });

  test('--port outside 0-65535 or not an integer is a usage error (exit 2)', async () => {
    for (const port of ['65536', '-1', '1.5', 'abc']) {
      const error = captureErrors();
      const code = await mcpCommand(['--http', '--port', port], () =>
        Promise.reject(new Error('must not load')),
      );
      const messages = error.mock.calls.flat().join('\n');
      error.mockRestore();
      expect(code).toBe(2);
      expect(messages).toContain('[cli.port-invalid]');
    }
  });

  test('--http without an mcp section exits 1 with cli.mcp-config-missing', async () => {
    const calls: unknown[] = [];
    const error = captureErrors();
    const code = await mcpCommand(
      ['--http', '--config', await configFile()],
      httpLoad(calls),
    );
    const messages = error.mock.calls.flat().join('\n');
    error.mockRestore();
    expect(code).toBe(1);
    expect(messages).toContain(
      '--http needs an mcp section in agentic.config.ts. [cli.mcp-config-missing]',
    );
    expect(calls).toEqual([]);
  });

  test('an explicit empty --config is used as given, not replaced by the default', async () => {
    await configFile(MCP);
    const calls: unknown[] = [];
    const outcome = await mcpCommand(
      ['--http', '--root', dir, '--config', ''],
      httpLoad(calls),
    ).then(
      () => 'ran',
      () => 'failed',
    );
    expect(outcome).toBe('failed');
    expect(calls).toEqual([]);
  });

  test('--http reports a missing SDK like stdio mode', async () => {
    const error = captureErrors();
    const code = await mcpCommand(
      ['--http', '--config', await configFile(MCP)],
      () =>
        Promise.reject(
          Object.assign(
            new Error("Cannot find package '@modelcontextprotocol/server'"),
            { code: 'ERR_MODULE_NOT_FOUND' },
          ),
        ),
    );
    const messages = error.mock.calls.flat().join('\n');
    error.mockRestore();
    expect(code).toBe(1);
    expect(messages).toContain('[cli.mcp-sdk-missing]');
  });

  test('--http reports a missing jose with its own code', async () => {
    const error = captureErrors();
    const code = await mcpCommand(
      ['--http', '--config', await configFile(MCP)],
      () =>
        Promise.resolve({
          startMcpServer: () => ({ close: () => {} }),
          startMcpHttpServer: () =>
            Promise.reject(
              Object.assign(new Error("Cannot find package 'jose'"), {
                code: 'ERR_MODULE_NOT_FOUND',
              }),
            ),
        }),
    );
    const messages = error.mock.calls.flat().join('\n');
    error.mockRestore();
    expect(code).toBe(1);
    expect(messages).toContain('jose@6.2.14');
    expect(messages).toContain('[cli.jose-missing]');
  });

  test('--http on an occupied port exits 1 with cli.port-in-use', async () => {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => new Response('x'),
    });
    const error = captureErrors();
    try {
      const code = await mcpCommand([
        '--http',
        '--root',
        dir,
        '--config',
        await configFile(MCP),
        '--port',
        String(server.port),
      ]);
      const messages = error.mock.calls.flat().join('\n');
      expect(code).toBe(1);
      expect(messages).toContain('[cli.port-in-use]');
    } finally {
      error.mockRestore();
      await server.stop(true);
    }
  });

  // Injects a bind failure with the given error code; the command must map it, not rethrow.
  function failingBind(error: Record<string, unknown>) {
    return () =>
      Promise.resolve({
        startMcpServer: () => ({ close: () => {} }),
        startMcpHttpServer: () => Promise.reject(error),
      });
  }

  test('--http on a privileged port exits 1 with cli.port-denied', async () => {
    const error = captureErrors();
    const code = await mcpCommand(
      ['--http', '--port', '80', '--config', await configFile(MCP)],
      failingBind({ code: 'EACCES', message: 'x' }),
    );
    const messages = error.mock.calls.flat().join('\n');
    error.mockRestore();
    expect(code).toBe(1);
    expect(messages).toContain('[cli.port-denied]');
    expect(messages).toContain('permission denied to bind 127.0.0.1:80');
  });

  test('--http on an address this machine lacks exits 1 with cli.host-unavailable', async () => {
    const error = captureErrors();
    const code = await mcpCommand(
      ['--http', '--host', '203.0.113.1', '--config', await configFile(MCP)],
      failingBind({ code: 'EADDRNOTAVAIL', message: 'x' }),
    );
    const messages = error.mock.calls.flat().join('\n');
    error.mockRestore();
    expect(code).toBe(1);
    expect(messages).toContain('[cli.host-unavailable]');
    expect(messages).toContain('203.0.113.1 is not an address of this machine');
  });

  test('--http rethrows a bind error it does not map', async () => {
    const failure = await mcpCommand(
      ['--http', '--config', await configFile(MCP)],
      failingBind({ code: 'ECONNRESET', message: 'x' }),
    ).catch((e: unknown) => e);
    expect(failure).toEqual({ code: 'ECONNRESET', message: 'x' });
  });

  // Binds TEST-NET-3 (203.0.113.1), which is never local, so no privileges are needed.
  // Skipped on Windows: Bun 1.4.4 reports EADDRINUSE for every failed bind there.
  test.skipIf(process.platform === 'win32')(
    '--http on a non-local address exits 1 with cli.host-unavailable (real bind)',
    async () => {
      const main = join(import.meta.dir, '..', 'main.ts');
      const proc = Bun.spawn(
        [
          process.execPath,
          main,
          'mcp',
          '--http',
          '--host',
          '203.0.113.1',
          '--port',
          '0',
          '--root',
          dir,
          '--config',
          await configFile(MCP),
        ],
        // The spawn timeout kills a bind that unexpectedly succeeds, so `exited` always settles.
        {
          stdout: 'ignore',
          stderr: 'pipe',
          timeout: 10_000,
          killSignal: 'SIGKILL',
        },
      );
      try {
        const [stderr, exitCode] = await Promise.all([
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        expect(exitCode).toBe(1);
        expect(stderr).toContain('[cli.host-unavailable]');
      } finally {
        // Belt and braces: the spawn timeout normally has already ended the child.
        proc.kill();
      }
    },
    15_000,
  );
});

describe('mcpCommand --published', () => {
  const lock = { lockVersion: 1 as const, ir: EMPTY_IR, changes: [] };
  const published = createPublishedLock('v9', lock, [], DEFAULT_CONVENTIONS);
  const file = () => join(dir, 'published.json');
  const idle = () => ({ close: () => {} });
  const starts: unknown[] = [];
  const load = () =>
    Promise.resolve({
      startMcpServer: (options: unknown) => {
        starts.push(options);
        return idle();
      },
      startMcpHttpServer: () => Promise.resolve({ ...idle(), port: 1 }),
    });

  beforeEach(async () => {
    starts.length = 0;
    await writeFile(file(), serializePublishedLock(published));
  });

  test('--expect-digest without --published is a usage error (exit 2)', async () => {
    const error = captureErrors();
    const code = await mcpCommand(['--expect-digest', 'a'.repeat(64)], load);
    const messages = error.mock.calls.flat().join('\n');
    error.mockRestore();
    expect(code).toBe(2);
    expect(messages).toContain('[cli.expect-digest-requires-published]');
  });

  test('a digest other than the pinned one exits 1 before serving', async () => {
    const error = captureErrors();
    const code = await mcpCommand(
      ['--published', file(), '--expect-digest', 'b'.repeat(64)],
      load,
    );
    const messages = error.mock.calls.flat().join('\n');
    error.mockRestore();
    expect(code).toBe(1);
    expect(messages).toContain('[published.digest-unexpected]');
    expect(starts).toEqual([]);
  });

  test('an unreadable file exits 1 with a coded error', async () => {
    const error = captureErrors();
    const code = await mcpCommand(['--published', join(dir, 'nope')], load);
    const messages = error.mock.calls.flat().join('\n');
    error.mockRestore();
    expect(code).toBe(1);
    expect(messages).toContain('[published.unreadable]');
  });

  const serving = () =>
    `agentic-ddd serving published lock v9 (digest ${published.digest.slice(0, 12)})`;

  test('a matching digest serves the lock and says which one', async () => {
    const error = captureErrors();
    const listeners = () => [
      process.stdin.listenerCount('end'),
      process.stdin.listenerCount('close'),
    ];
    const before = listeners();
    // Ends the wait on the next tick, as stdin closing would.
    const stop = setTimeout(() => process.stdin.emit('end'), 0);
    const code = await mcpCommand(
      ['--published', file(), '--expect-digest', published.digest],
      load,
    );
    clearTimeout(stop);
    const messages = error.mock.calls.flat().join('\n');
    error.mockRestore();
    expect(code).toBe(0);
    expect(starts[0]).toMatchObject({ published });
    expect(messages).toContain(serving());
    expect(listeners()).toEqual(before);
  });

  test('--http --published reads only the mcp section, no module paths', async () => {
    const calls: unknown[] = [];
    const error = captureErrors();
    const config = join(dir, 'agentic.config.ts');
    await writeFile(
      config,
      `export default { modules: [{ name: 'x', path: 'missing' }], mcp: ${MCP} };\n`,
    );
    const code = await mcpCommand(
      ['--http', '--published', file(), '--config', config],
      httpLoad(calls),
    );
    const messages = error.mock.calls.flat().join('\n');
    error.mockRestore();
    expect(code).toBe(0);
    expect(calls[0]).toMatchObject({
      published,
      mcp: {
        issuer: 'https://auth.example.com',
        resource: 'https://orders.example.com/mcp',
      },
    });
    expect(messages).toContain(serving());

    const failing = captureErrors();
    const working = await mcpCommand(
      ['--http', '--config', config],
      httpLoad([]),
    ).catch((e: { code?: string }) => e);
    failing.mockRestore();
    expect((working as { code?: string }).code).toBe(
      'config.module-path-missing',
    );
  });

  test('--http --published without an mcp section exits 1', async () => {
    const error = captureErrors();
    const code = await mcpCommand(
      ['--http', '--published', file(), '--config', await configFile()],
      httpLoad([]),
    );
    const messages = error.mock.calls.flat().join('\n');
    error.mockRestore();
    expect(code).toBe(1);
    expect(messages).toContain('[cli.mcp-config-missing]');
    expect(messages).not.toContain('serving published lock');
  });

  test('a bind error prints no serving line', async () => {
    const error = captureErrors();
    const code = await mcpCommand(
      ['--http', '--published', file(), '--config', await configFile(MCP)],
      () =>
        Promise.resolve({
          startMcpServer: () => idle(),
          startMcpHttpServer: () =>
            Promise.reject(
              Object.assign(new Error('in use'), { code: 'EADDRINUSE' }),
            ),
        }),
    );
    const messages = error.mock.calls.flat().join('\n');
    error.mockRestore();
    expect(code).toBe(1);
    expect(messages).not.toContain('serving published lock');
  });

  test('a failing config prints no serving line', async () => {
    const error = captureErrors();
    const config = join(dir, 'agentic.config.ts');
    await writeFile(config, `export default { mcp: { issuer: 'x' } };\n`);
    const failure = await mcpCommand(
      ['--http', '--published', file(), '--config', config],
      load,
    ).catch((e: Error) => e);
    const messages = error.mock.calls.flat().join('\n');
    error.mockRestore();
    expect(failure).toBeInstanceOf(Error);
    expect(messages).not.toContain('serving published lock');
  });
});

describe('mcpCommand publish sink', () => {
  const KEYS = ['AGENTIC_GITHUB_TOKEN', 'AGENTIC_GITHUB_REPO'] as const;
  const saved = KEYS.map((k) => process.env[k]);
  afterEach(() => {
    KEYS.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
  });

  const run = async (calls: unknown[], root = dir, config?: string) => {
    const error = captureErrors();
    const code = await mcpCommand(
      ['--http', '--root', root, '--config', config ?? (await configFile(MCP))],
      httpLoad(calls),
    );
    const messages = error.mock.calls.flat().join('\n');
    error.mockRestore();
    return { code, messages };
  };

  test('without the GitHub variables no sink is passed', async () => {
    for (const k of KEYS) delete process.env[k];
    const calls: { publish?: unknown }[] = [];
    expect((await run(calls)).code).toBe(0);
    expect(calls[0]!.publish).toBeUndefined();
  });

  test('with both variables a sink is passed, limited to the module paths and the changes directory', async () => {
    process.env.AGENTIC_GITHUB_TOKEN = 'ghp_SECRET_TOKEN_123';
    process.env.AGENTIC_GITHUB_REPO = 'acme/shop';
    const calls: {
      publish?: { sink: { publish(c: unknown): Promise<unknown> } };
    }[] = [];
    expect((await run(calls)).code).toBe(0);
    const outside = await calls[0]!
      .publish!.sink.publish({
        number: '0001',
        slug: 'x',
        title: 't',
        body: 'b',
        changesDir: 'changes',
        baseRef: 'sha-base',
        files: [{ path: 'elsewhere/a.ts', content: 'x' }],
      })
      .catch((e: { code: string }) => e.code);
    expect(outside).toBe('publish.path-invalid');
  });

  // Windows reports the temp folder by its 8.3 name (RUNNER~1); the config root is expanded, so the two must still agree.
  test(
    'a root given by its 8.3 short name still yields the module prefixes',
    async () => {
      process.env.AGENTIC_GITHUB_TOKEN = 'ghp_SECRET_TOKEN_123';
      process.env.AGENTIC_GITHUB_REPO = 'acme/shop';
      const short = shortPath(dir);
      const calls: unknown[] = [];
      const { code, messages } = await run(calls, short);
      expect(messages).not.toContain('publish.config-invalid');
      expect(code).toBe(0);
    },
    SHORT_PATH_TEST_TIMEOUT_MS,
  );

  test('the publish config is the one of --config, loaded once for the server', async () => {
    process.env.AGENTIC_GITHUB_TOKEN = 'ghp_SECRET_TOKEN_123';
    process.env.AGENTIC_GITHUB_REPO = 'acme/shop';
    const custom = join(dir, 'custom.config.ts');
    await writeFile(
      custom,
      `export default { modules: [{ name: 'other', path: 'models' }], mcp: ${MCP} };
`,
    );
    const calls: { publish?: { config: { modules: { name: string }[] } } }[] =
      [];
    expect((await run(calls, dir, custom)).code).toBe(0);
    expect(calls[0]!.publish!.config.modules.map((m) => m.name)).toEqual([
      'other',
    ]);
  });

  test('a half configuration exits 1 with publish.config-invalid and never prints the token', async () => {
    process.env.AGENTIC_GITHUB_TOKEN = 'ghp_SECRET_TOKEN_123';
    delete process.env.AGENTIC_GITHUB_REPO;
    const calls: unknown[] = [];
    const { code, messages } = await run(calls);
    expect(code).toBe(1);
    expect(messages).toContain('[publish.config-invalid]');
    expect(messages).not.toContain('ghp_SECRET_TOKEN_123');
    expect(calls).toEqual([]);
  });
});
