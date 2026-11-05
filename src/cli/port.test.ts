import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { MOTIVO_PLACEHOLDER } from '@agentic-ddd/compiler';

const ROOT = resolve(import.meta.dir, '../..');

const PORT = (top: string, contar: string) => `import { z } from 'zod';
import { AggregateRoot } from '@agentic-ddd/core';
import { AgentEntity, AgentMethod, AgentPort, AgentUseCase } from '@agentic-ddd/decorators';
@AgentEntity({ description: 'Matrícula.' })
export class Matricula extends AggregateRoot<string> {
  @AgentMethod({ description: 'Cria.' })
  static criar() { return new Matricula('1'); }
}
@AgentPort({
  description: '${top}',
  root: () => Matricula,
  methods: { save: 'Grava a matrícula.', contarPorTurma: '${contar}' },
})
export abstract class MatriculaRepository {
  abstract save(m: Matricula): Promise<void>;
  abstract contarPorTurma(turma: string): Promise<number>;
}
@AgentUseCase({
  name: 'matricular_aluno',
  description: 'Matricula um aluno.',
  whenToUse: 'Ao matricular.',
  input: z.object({ turma: z.string() }),
  output: z.object({ id: z.string() }),
  uses: ['method:Matricula.criar'],
  ports: () => [MatriculaRepository],
})
export class MatricularAluno {}
`;

test('port: appears in the packet, changing the description requires a proposal and changes the specHash', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentic-port-'));
  try {
    await mkdir(join(dir, 'app'));
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
      `export default { modules: [{ name: 'app', path: 'app' }] };`,
    );
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
    const hashOf = () => {
      const p = run('packet', 'usecase:matricular_aluno');
      expect(p.stderr).toBe('');
      expect(p.code).toBe(0);
      return {
        out: p.stdout,
        hash: /specHash: `([a-f0-9]{64})`/.exec(p.stdout)![1]!,
      };
    };
    const write = (top: string, contar: string) =>
      writeFile(join(dir, 'app/matricula.ts'), PORT(top, contar));

    await write('Persistência de matrículas.', 'Conta matrículas da turma.');
    const base = hashOf();
    expect(base.out).toContain('save');
    expect(base.out).toContain('contarPorTurma');
    expect(run('compile', '--draft-change', 'inicial').code).toBe(0);
    const proposal = join(dir, 'changes/0001-inicial/proposal.md');
    await writeFile(
      proposal,
      (await readFile(proposal, 'utf8')).replace(
        MOTIVO_PLACEHOLDER,
        'Estado inicial.',
      ),
    );
    expect(run('compile').code).toBe(0);
    expect(run('compile', '--check').code).toBe(0);

    await write('Persistência alterada.', 'Conta matrículas da turma.');
    const top = run('compile', '--check');
    expect(top.code).toBe(1);
    expect(top.stderr).toContain('pending: there are ');
    expect(hashOf().hash).not.toBe(base.hash);

    await write('Persistência de matrículas.', 'Conta alunos da turma.');
    const method = run('compile', '--check');
    expect(method.code).toBe(1);
    expect(method.stderr).toContain('pending: there are ');
    expect(hashOf().hash).not.toBe(base.hash);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
