import { resolve } from 'node:path';

export interface StdioMcp {
  call(name: string, args?: object): Promise<any>;
  close(): Promise<void>;
}

// A minimal newline-delimited JSON-RPC client over the real `agentic mcp` subprocess.
export async function startStdioMcp(root: string): Promise<StdioMcp> {
  const proc = Bun.spawn(
    [
      'bun',
      resolve(import.meta.dir, '../../src/cli/main.ts'),
      'mcp',
      '--root',
      root,
    ],
    { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
  );
  const waiting = new Map<number, (message: any) => void>();
  const reader = (async () => {
    let buffer = '';
    const decoder = new TextDecoder();
    for await (const chunk of proc.stdout as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        waiting.get(message.id)?.(message);
      }
    }
  })();
  const send = (message: object) =>
    void proc.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`,
    );
  let nextId = 1;
  const request = (method: string, params?: object) => {
    const id = nextId++;
    return new Promise<any>((done, fail) => {
      const timer = setTimeout(
        () => fail(new Error(`stdio timeout in ${method}`)),
        15000,
      );
      waiting.set(id, (message) => {
        clearTimeout(timer);
        done(message);
      });
      send({ id, method, params });
    });
  };
  await request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 't', version: '1' },
  });
  send({ method: 'notifications/initialized' });
  return {
    async call(name, args = {}) {
      return (await request('tools/call', { name, arguments: args })).result;
    },
    async close() {
      void proc.stdin.end();
      await Promise.race([
        proc.exited,
        Bun.sleep(5000).then(() => proc.kill()),
      ]);
      await reader.catch(() => undefined);
    },
  };
}
