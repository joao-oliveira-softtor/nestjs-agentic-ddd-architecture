import { describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseLock } from '../src/compiler/lock';
import { SNAPSHOT_PATH, writeSnapshot } from '../src/compiler/snapshot';
import { DEFAULT_CONVENTIONS } from '../src/compiler/conventions';

const REPO = resolve(import.meta.dir, '..');
const LOCK = '.agentic/domain.lock.json';

describe('agentic mcp (subprocesso)', () => {
  test('protocolo, tools somente leitura e recusa de snapshot desatualizado', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'agentic-mcp-'));
    try {
      await mkdir(join(tmp, '.agentic'), { recursive: true });
      await mkdir(join(tmp, 'examples/orders'), { recursive: true });
      await cp(join(REPO, LOCK), join(tmp, LOCK));
      await writeFile(join(tmp, 'agentic.config.ts'), 'config\n');
      await writeFile(join(tmp, 'examples/orders/a.ts'), 'a\n');
      const lockText = await readFile(join(tmp, LOCK), 'utf8');
      const lock = parseLock(lockText, LOCK);
      await writeSnapshot(tmp, {
        root: '.',
        config: 'agentic.config.ts',
        lock: LOCK,
        rulesDir: '.ai/rules',
        conventions: DEFAULT_CONVENTIONS,
        rules: [
          {
            key: 'r',
            file: '.ai/rules/r.md',
            paths: ['examples/**'],
            body: 'R',
          },
        ],
        modules: lock.ir.modules,
      });
      const snapshotText = await readFile(join(tmp, SNAPSHOT_PATH), 'utf8');
      const entity = lock.ir.entities[0]!.id;

      const proc = Bun.spawn(
        ['bun', resolve(REPO, 'src/cli/main.ts'), 'mcp', '--root', tmp],
        { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      );
      const lines: string[] = [];
      const waiting = new Map<number, (m: any) => void>();
      const pending = new Map<number, any>();
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
            lines.push(line);
            const msg = JSON.parse(line);
            if (msg.id !== undefined) {
              const w = waiting.get(msg.id);
              if (w) w(msg);
              else pending.set(msg.id, msg);
            }
          }
        }
      })();
      let nextId = 1;
      const send = (message: object) =>
        void proc.stdin.write(
          `${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`,
        );
      const request = async (method: string, params?: object) => {
        const id = nextId++;
        const reply = new Promise<any>((done) => {
          const early = pending.get(id);
          if (early) done(early);
          else waiting.set(id, done);
        });
        send({ id, method, params });
        return Promise.race([
          reply,
          new Promise<never>((_, no) =>
            setTimeout(() => no(new Error(`timeout em ${method}`)), 15000),
          ),
        ]);
      };
      const call = (name: string, args: object = {}) =>
        request('tools/call', { name, arguments: args });

      const init = await request('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 't', version: '1' },
      });
      expect(init.result.serverInfo).toBeDefined();
      send({ method: 'notifications/initialized' });

      const list = await request('tools/list');
      const tools = list.result.tools as {
        name: string;
        annotations: { readOnlyHint: boolean };
      }[];
      expect(tools.map((t) => t.name).sort()).toEqual([
        'authoring_guide',
        'domain_changes',
        'domain_element',
        'domain_overview',
        'domain_source',
        'rules_for_path',
      ]);
      for (const t of tools) expect(t.annotations.readOnlyHint).toBe(true);

      const text = (r: any) => r.result.content[0].text as string;
      for (const [name, args] of [
        ['domain_overview', {}],
        ['domain_element', { id: entity }],
        ['domain_changes', {}],
        ['rules_for_path', { path: 'examples/orders/a.ts' }],
      ] as const) {
        const r = await call(name, args);
        expect(r.result.isError).toBeFalsy();
        const parsed = JSON.parse(text(r));
        if (name === 'rules_for_path')
          expect(JSON.stringify(parsed)).toContain('"r"');
      }

      const absolute = await call('rules_for_path', {
        path: join(tmp, 'examples/orders/a.ts'),
      });
      expect(text(absolute)).toContain('"r"');
      const outside = (await call('rules_for_path', { path: '/etc/passwd' }))
        .result;
      expect(outside.isError).toBe(true);
      expect(outside.content[0].text).toContain('[mcp.path-outside-root]');
      // Separador do Windows, `./` inicial e `..` interno também não escapam da raiz (#128).
      for (const path of [
        '..\\fora\\a.ts',
        './../fora/a.ts',
        'x/../../fora/a.ts',
      ])
        expect((await call('rules_for_path', { path })).result.isError).toBe(
          true,
        );

      await writeFile(join(tmp, LOCK), `${lockText} `);
      const stale = (await call('domain_overview')).result;
      expect(stale.isError).toBe(true);
      expect(stale.content[0].text).toContain('[snapshot.stale]');

      await writeFile(join(tmp, LOCK), lockText);
      expect((await call('domain_overview')).result.isError).toBeFalsy();
      const unknown = (await call('domain_element', { id: 'entity:Nope' }))
        .result;
      expect(unknown.isError).toBe(true);
      expect(unknown.content[0].text).toContain('[mcp.element-unknown]');

      await writeFile(join(tmp, 'examples/orders/a.ts'), 'changed\n');
      expect((await call('domain_overview')).result.isError).toBe(true);
      await writeFile(join(tmp, 'examples/orders/a.ts'), 'a\n');

      await rm(join(tmp, SNAPSHOT_PATH));
      expect((await call('domain_overview')).result.isError).toBe(true);
      await writeFile(join(tmp, SNAPSHOT_PATH), snapshotText);

      void proc.stdin.end();
      expect(await proc.exited).toBe(0);
      await reader;
      for (const line of lines) expect(JSON.parse(line).jsonrpc).toBe('2.0');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 60000);
});
