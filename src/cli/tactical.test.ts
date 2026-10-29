import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dir, '../..');

const ALUNO = `import { AggregateRoot } from '@agentic-ddd/core';
import { AgentEntity } from '@agentic-ddd/decorators';
@AgentEntity({ description: 'Aluno.' })
export class Aluno extends AggregateRoot<string> {}`;

const ALUNO_ID = `import { ValueObject } from '@agentic-ddd/core';
import { AgentValueObject } from '@agentic-ddd/decorators';
@AgentValueObject({ description: 'Id de aluno.' })
export class AlunoId extends ValueObject<{ valor: string }> {}`;

// @Invariant empilhado acima de um @AgentEntity de várias linhas; o campo fica na linha 11.
const MATRICULA = (
  field: string,
) => `import { AggregateRoot } from '@agentic-ddd/core';
import { AgentEntity, AgentMethod, Invariant } from '@agentic-ddd/decorators';
import { Aluno } from './aluno';
import { AlunoId } from './aluno-id';
@Invariant({ id: 'ativa', text: 'Matrícula ativa.' })
@AgentEntity({
  description: 'Matrícula.',
  contains: () => [AlunoId],
})
export class Matricula extends AggregateRoot<string> {
  ${field}
  @AgentMethod({ description: 'Cria.' })
  criar() { return this; }
}
void Aluno;`;

interface Report {
  status: string;
  gates: {
    id: string;
    status: string;
    findings: { message: string; source: string }[];
  }[];
}

async function fixture(field: string) {
  const dir = await mkdtemp(join(tmpdir(), 'agentic-tactical-'));
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
    `export default { modules: [{ name: 'app', path: 'app' }], verify: { test: ['bun', 'test', 'app.test.ts'], commands: { typecheck: ['bun', '-e', 'process.exit(0)'] } } };`,
  );
  await writeFile(
    join(dir, 'app.test.ts'),
    `import { test, expect } from 'bun:test';
import { covers } from '@agentic-ddd/testing';
test(covers(['entity:Matricula'], 'matricula'), () => expect(1).toBe(1));`,
  );
  await writeFile(join(dir, 'app/aluno.ts'), ALUNO);
  await writeFile(join(dir, 'app/aluno-id.ts'), ALUNO_ID);
  await writeFile(join(dir, 'app/matricula.ts'), MATRICULA(field));
  const run = (...args: string[]) =>
    Bun.spawnSync(
      [
        'bun',
        join(ROOT, 'src/cli/main.ts'),
        ...args,
        '--config',
        join(dir, 'agentic.config.ts'),
      ],
      { cwd: dir, stdout: 'pipe', stderr: 'pipe' },
    );
  const verify = (item: string) => {
    const packet = run('packet', item).stdout.toString();
    const hash = /specHash: `([a-f0-9]{64})`/.exec(packet)![1]!;
    const out = run('verify', '--item', item, '--spec-hash', hash, '--json');
    return JSON.parse(out.stdout.toString()) as Report;
  };
  return { dir, run, verify };
}

const gateT = (r: Report) => r.gates.find((g) => g.id === 'T');

test('gate T: fails with the root of another aggregate, passes with the id, only on entity and VO', async () => {
  const bad = await fixture('aluno!: Aluno;');
  const good = await fixture('alunoId!: AlunoId;');
  try {
    const failed = bad.verify('entity:Matricula');
    expect(failed.status).toBe('failed');
    const t = gateT(failed)!;
    expect(t.status).toBe('failed');
    expect(t.findings[0]!.message.startsWith('T1:')).toBe(true);
    expect(t.findings[0]!.source).toBe('app/matricula.ts:11');

    expect(gateT(good.verify('entity:Matricula'))!.status).toBe('passed');
    expect(gateT(good.verify('valueobject:AlunoId'))).toBeDefined();
    expect(gateT(good.verify('method:Matricula.criar'))).toBeUndefined();
  } finally {
    await rm(bad.dir, { recursive: true, force: true });
    await rm(good.dir, { recursive: true, force: true });
  }
}, 120_000);
