import { expect, test } from 'bun:test';
import { readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { orderSkeleton } from '../../test/helpers/order-skeleton';

async function generated(dir: string): Promise<Record<string, string>> {
  const files = ['AGENTS.md', '.agentic/domain.lock.json'];
  for (const prefix of ['.agentic/runtime', '.agents/skills'])
    for await (const file of new Bun.Glob('**/*').scan({
      cwd: join(dir, prefix),
      onlyFiles: true,
    }))
      files.push(`${prefix}/${file}`);
  return Object.fromEntries(
    await Promise.all(
      files.sort().map(async (f) => [f, await readFile(join(dir, f), 'utf8')]),
    ),
  );
}

test('Order declarado: quatro ondas, packets, verify item RED→GREEN, gerados estáveis, hash protege decorators e G7 conclui', async () => {
  const { dir, run, stage } = await orderSkeleton();
  try {
    expect(run('compile', '--draft-change', 'pedido').code).toBe(0);
    const proposalPath = join(dir, 'changes/0001-pedido/proposal.md');
    const draft = await readFile(proposalPath, 'utf8');
    await writeFile(
      proposalPath,
      draft.replace(
        '<!-- Escreva aqui por que esta mudança existe (obrigatório). O compilador só aplica a proposta com o Motivo preenchido. -->',
        'Declaração primeiro do pedido.',
      ),
    );
    expect(run('compile').code).toBe(0);
    const initial = await generated(dir);
    const next = run('next', '--json');
    expect(next.code).toBe(0);
    const waves = [
      ['entity:Order'],
      ['method:Order.cancel', 'method:Order.confirm', 'usecase:create_order'],
      ['usecase:cancel_order', 'usecase:confirm_order'],
      ['operator:order-operator'],
    ];
    expect(JSON.parse(next.stdout).waves).toEqual(waves);
    const hashes = new Map<string, string>();
    for (const wave of waves)
      for (const id of wave) {
        const packet = run('packet', id);
        expect(packet.code).toBe(0);
        const hash = /specHash: `([a-f0-9]{64})`/.exec(packet.stdout)![1]!;
        hashes.set(id, hash);
        expect(
          run('verify', '--item', id, '--spec-hash', hash, '--json').code,
        ).toBe(1);
      }
    const failed = run('verify', '0001');
    expect(failed.code).toBe(1);
    expect(
      JSON.parse(failed.stdout).gates.find((g: { id: string }) => g.id === 'G7')
        .findings,
    ).toHaveLength(7);
    for (let n = 0; n < waves.length; n++) {
      const wave = waves[n]!;
      await stage(wave);
      for (const id of wave) {
        const verified = run(
          'verify',
          '--item',
          id,
          '--spec-hash',
          hashes.get(id)!,
          '--json',
        );
        expect({
          id,
          code: verified.code,
          report: JSON.parse(verified.stdout).status,
        }).toEqual({ id, code: 0, report: 'done' });
      }
      expect(JSON.parse(run('next', '--json').stdout).waves).toEqual(
        waves.slice(n + 1),
      );
      expect(run('compile', '--check').code).toBe(0);
      expect(await generated(dir)).toEqual(initial);
    }
    const path = join(dir, 'app/domain/order.ts');
    const original = await readFile(path, 'utf8');
    await writeFile(
      path,
      original.replace(
        'Um pedido precisa ter ao menos um item.',
        'Um pedido deve conter itens.',
      ),
    );
    const altered = run(
      'verify',
      '--item',
      'entity:Order',
      '--spec-hash',
      hashes.get('entity:Order')!,
      '--json',
    );
    expect(altered.code).toBe(1);
    expect(
      JSON.parse(altered.stdout).gates.find(
        (g: { id: string }) => g.id === 'I3',
      ).status,
    ).toBe('failed');
    await writeFile(path, original);
    const final = run('verify', '0001');
    expect(final.code).toBe(0);
    expect(JSON.parse(final.stdout).status).toBe('done');
    expect(
      JSON.parse(final.stdout).gates.find((g: { id: string }) => g.id === 'G7')
        .status,
    ).toBe('passed');
    expect((await readdir(join(dir, '.agentic'))).sort()).toEqual([
      'domain.lock.json',
      'runtime',
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);
