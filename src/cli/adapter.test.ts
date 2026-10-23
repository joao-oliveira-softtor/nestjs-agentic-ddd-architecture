import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../..');

const DOMAIN = `import { AggregateRoot } from '@agentic-ddd/core';
import { AgentEntity, AgentMethod, AgentPort } from '@agentic-ddd/decorators';
@AgentEntity({ description: 'Matrícula.' })
export class Matricula extends AggregateRoot<string> {
  @AgentMethod({ description: 'Cria.' })
  static criar() { return new Matricula('1'); }
}
@AgentPort({
  description: 'Persistência de matrículas.',
  root: () => Matricula,
  methods: { save: 'Grava a matrícula.', contarPorTurma: 'Conta matrículas da turma.' },
})
export abstract class MatriculaRepository {
  abstract save(m: Matricula): Promise<void>;
  abstract contarPorTurma(turma: string): Promise<number>;
}
`;

const ADAPTER = (
  contar: string,
) => `import { notImplemented } from '@agentic-ddd/core';
import { AgentAdapter } from '@agentic-ddd/decorators';
import { Matricula, MatriculaRepository } from '../matricula';
@AgentAdapter({
  description: 'Repositório em memória.',
  implements: () => MatriculaRepository,
})
export class InMemoryMatriculaRepository extends MatriculaRepository {
  #itens = new Map<string, Matricula>();
  async save(m: Matricula): Promise<void> { this.#itens.set(m.id, m); }
  async contarPorTurma(turma: string): Promise<number> { ${contar} }
}
`;

const SEGUNDO = `import { AgentAdapter } from '@agentic-ddd/decorators';
import { MatriculaRepository } from '../matricula';
@AgentAdapter({
  description: 'Outro repositório.',
  implements: () => MatriculaRepository,
})
export class OutroMatriculaRepository extends MatriculaRepository {
  async save(): Promise<void> {}
  async contarPorTurma(): Promise<number> { return 0; }
}
`;

const REAL = 'return this.#itens.size + turma.length * 0;';

const TESTS = (contar: boolean) => `import { test, expect } from 'bun:test';
import { covers } from '@agentic-ddd/testing';
import { Matricula } from './app/matricula';
import { InMemoryMatriculaRepository } from './app/infrastructure/in-memory';
test(covers(['entity:Matricula', 'method:Matricula.criar'], 'matricula'), () => expect(Matricula.criar()).toBeInstanceOf(Matricula));
test(covers(['port:MatriculaRepository.save'], 'save'), () => expect(new InMemoryMatriculaRepository()).toBeDefined());
${contar ? "test(covers(['port:MatriculaRepository.contarPorTurma'], 'contar'), () => expect(1).toBe(1));" : ''}`;

test('adapter: status, packet, verify, covers faltando, esqueleto e segundo adapter', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentic-adapter-'));
  try {
    await mkdir(join(dir, 'app/infrastructure'), { recursive: true });
    await writeFile(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          experimentalDecorators: true,
          paths: {
            '@agentic-ddd/*': [join(ROOT, 'src/*/index.ts')],
            zod: [join(ROOT, 'node_modules/zod')],
          },
        },
      }),
    );
    await writeFile(
      join(dir, 'agentic.config.ts'),
      `export default { modules: [{ name: 'app', path: 'app' }], verify: { test: ['bun', 'test', 'app.test.ts'], commands: { typecheck: ['bun', '-e', 'process.exit(0)'] } } };`,
    );
    const adapterFile = join(dir, 'app/infrastructure/in-memory.ts');
    await writeFile(join(dir, 'app/matricula.ts'), DOMAIN);
    await writeFile(adapterFile, ADAPTER(REAL));
    await writeFile(join(dir, 'app.test.ts'), TESTS(true));
    const run = (...args: string[]) => {
      const r = Bun.spawnSync(
        [
          'bun',
          join(ROOT, 'src/cli/main.ts'),
          ...args,
          '--config',
          join(dir, 'agentic.config.ts'),
        ],
        { cwd: dir, stdout: 'pipe', stderr: 'pipe' },
      );
      return {
        code: r.exitCode,
        stdout: r.stdout.toString(),
        stderr: r.stderr.toString(),
      };
    };
    const ID = 'adapter:InMemoryMatriculaRepository';
    const itemOf = () =>
      JSON.parse(run('status', '--static', '--json').stdout).items.find(
        (i: { id: string }) => i.id === ID,
      );

    expect(run('compile').code).toBe(0);
    const item = itemOf();
    expect(item.layer).toBe('infrastructure');
    expect(item.dependsOn).toContain('entity:Matricula');

    const packet = run('packet', ID);
    expect(packet.code).toBe(0);
    expect(packet.stdout).toContain('membros #privados da classe deste item');
    expect(packet.stdout).toContain('port:MatriculaRepository.save');
    expect(packet.stdout).toContain('Persistência de matrículas.');
    const hash = /specHash: `([a-f0-9]{64})`/.exec(packet.stdout)![1]!;
    const verify = () =>
      run('verify', '--item', ID, '--spec-hash', hash, '--json');

    const ok = verify();
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.stdout).status).toBe('done');

    await writeFile(join(dir, 'app.test.ts'), TESTS(false));
    const missing = verify();
    expect(missing.code).not.toBe(0);
    expect(missing.stdout).toContain('port:MatriculaRepository.contarPorTurma');

    await writeFile(join(dir, 'app.test.ts'), TESTS(true));
    await writeFile(adapterFile, ADAPTER('return notImplemented();'));
    expect(itemOf().baseState).toBe('declared');

    await writeFile(adapterFile, ADAPTER(REAL));
    await writeFile(join(dir, 'app/infrastructure/outro.ts'), SEGUNDO);
    const dup = run('compile');
    expect(dup.code).not.toBe(0);
    expect(dup.stderr + dup.stdout).toMatch(/adapter|MatriculaRepository/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);
