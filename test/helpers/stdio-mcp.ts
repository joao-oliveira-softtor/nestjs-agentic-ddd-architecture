import { resolve } from 'node:path';

export interface StdioMcp {
  call(name: string, args?: object): Promise<any>;
  close(): Promise<void>;
}

// A minimal newline-delimited JSON-RPC client over the real `agentic mcp` subprocess.
export async function startStdioMcp(
  root: string,
  args: string[] = ['--root', root],
): Promise<StdioMcp> {
  const proc = Bun.spawn(
    [
      process.execPath,
      resolve(import.meta.dir, '../../src/cli/main.ts'),
      'mcp',
      ...args,
    ],
    { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
  );
  void new Response(proc.stderr).text(); // drained so a chatty child cannot block on a full pipe
  const waiting = new Map<
    number,
    { done: (message: any) => void; fail: (error: Error) => void }
  >();
  const failAll = (error: Error) => {
    for (const w of waiting.values()) w.fail(error);
    waiting.clear();
  };
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
        let message: any;
        try {
          message = JSON.parse(line);
        } catch {
          failAll(
            new Error(`stdio: non-JSON line on stdout: ${line.slice(0, 80)}`),
          );
          continue;
        }
        waiting.get(message.id)?.done(message);
      }
    }
  })().catch((error) => failAll(error as Error));
  void proc.exited.then((code) =>
    failAll(new Error(`stdio: server exited with code ${code}`)),
  );
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
      waiting.set(id, {
        done: (message) => {
          clearTimeout(timer);
          waiting.delete(id);
          done(message);
        },
        fail: (error) => {
          clearTimeout(timer);
          fail(error);
        },
      });
      send({ id, method, params });
    });
  };
  const stop = async () => {
    void proc.stdin.end();
    const timer = setTimeout(() => proc.kill(), 5000);
    try {
      await proc.exited;
    } finally {
      clearTimeout(timer);
    }
    await reader;
  };
  try {
    await request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 't', version: '1' },
    });
  } catch (error) {
    // A failed start-up must not leave a live child that keeps the runner alive.
    proc.kill();
    await stop().catch(() => undefined);
    throw error;
  }
  send({ method: 'notifications/initialized' });
  return {
    async call(name, args = {}) {
      return (await request('tools/call', { name, arguments: args })).result;
    },
    close: stop,
  };
}
