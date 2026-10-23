import { describe, expect, spyOn, test } from 'bun:test';
import { mcpCommand } from './mcp';

describe('mcpCommand', () => {
  test('SDK ausente: explica a instalação e sai com 1', async () => {
    const error = spyOn(console, 'error').mockImplementation(() => {});
    const code = await mcpCommand([], () =>
      Promise.reject(
        new Error("Cannot find package '@modelcontextprotocol/server'"),
      ),
    );
    const messages = error.mock.calls.flat().join('\n');
    error.mockRestore();
    expect(code).toBe(1);
    expect(messages).toContain('@modelcontextprotocol/server@2.3.1');
  });

  test('outro erro de carga é relançado', async () => {
    const failure = await mcpCommand([], () =>
      Promise.reject(new Error('boom')),
    ).catch((e: Error) => e);
    expect((failure as Error).message).toBe('boom');
  });
});
