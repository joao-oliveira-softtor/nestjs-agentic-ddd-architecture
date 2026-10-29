import { describe, expect, spyOn, test } from 'bun:test';
import { mcpCommand } from './mcp';

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
});
