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
import { join } from 'node:path';
import { mcpCommand } from './mcp';

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

  test('--http starts on 127.0.0.1:3333 with the config mcp section', async () => {
    const calls: unknown[] = [];
    const error = captureErrors();
    const code = await mcpCommand(
      ['--http', '--config', await configFile(MCP)],
      httpLoad(calls),
    );
    const messages = error.mock.calls.flat().join('\n');
    error.mockRestore();
    expect(code).toBe(0);
    expect(calls).toEqual([
      {
        root: process.cwd(),
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
        'agentic-ddd mcp [--root <dir>] [--config <file>] [--http',
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
});
