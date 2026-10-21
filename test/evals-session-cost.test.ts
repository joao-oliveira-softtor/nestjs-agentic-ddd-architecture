import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { match } from 'ts-pattern';
import { loadPricing } from '../scripts/evals/pricing';
import {
  type CostedRow,
  findTranscript,
  renderSessionCost,
  type SessionFile,
  sessionCost,
  subagentLabel,
} from '../scripts/evals/session-cost';

const pricing = await loadPricing();
const HAIKU = 'claude-haiku-5-5';
const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

interface Turn {
  id: string;
  model?: string;
  input?: number;
  write?: number;
  write1h?: number;
  read?: number;
  output?: number;
  text?: string;
}
/** Evento `assistant` sintético (sem conteúdo real); `write1h` vai para `cache_creation`. */
const assistant = ({
  id,
  model = HAIKU,
  input = 0,
  write = 0,
  write1h = 0,
  read = 0,
  output = 0,
  text = '...',
}: Turn) => ({
  type: 'assistant',
  message: {
    id,
    model,
    usage: {
      input_tokens: input,
      cache_creation_input_tokens: write,
      cache_read_input_tokens: read,
      output_tokens: output,
      cache_creation: {
        ephemeral_1h_input_tokens: write1h,
        ephemeral_5m_input_tokens: write - write1h,
      },
    },
    content: [{ type: 'text', text }],
  },
});
const ndjson = (...events: unknown[]) =>
  events.map((event) => JSON.stringify(event)).join('\n');
const main = (text: string): SessionFile => ({
  path: '/sessao/principal.jsonl',
  text,
  kind: 'main',
  label: 'principal',
});
const subagent = (text: string, label = 'scout: pesquisa'): SessionFile => ({
  path: '/sessao/subagents/agent-1.jsonl',
  text,
  kind: 'subagent',
  label,
});
/** Custo de uma linha; lança se estiver indisponível, para o teste falhar com o motivo. */
const priced = (row: CostedRow) =>
  match(row.cost)
    .with({ status: 'available' }, (c) => c)
    .with({ status: 'unavailable' }, (c) => {
      throw Error(c.reason);
    })
    .exhaustive();
/** Mensagem do erro da promessa; `sem erro` se ela resolver, para o `toContain` falhar. */
const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'sem erro',
    (error: unknown) => String(error),
  );
const tempConfig = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'session-cost-'));
  dirs.push(dir);
  return dir;
};
const writeTranscript = async (config: string, project: string, id: string) => {
  const dir = join(config, 'projects', project);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${id}.jsonl`);
  await writeFile(path, '');
  return path;
};

test('mesmo message.id repetido no mesmo arquivo conta uma requisição', () => {
  const event = assistant({
    id: 'msg_1',
    input: 1000,
    write: 2000,
    write1h: 2000,
    read: 10000,
    output: 500,
  });
  const report = sessionCost([main(ndjson(event, event, event))], pricing);
  expect(report.total.requests).toBe(1);
  expect(report.total.uncachedInputTokens).toBe(1000);
  expect(report.total.outputTokens).toBe(500);
});

test('escrita de cache é dividida em 1 h e 5 min conforme o TTL informado', () => {
  const report = sessionCost(
    [main(ndjson(assistant({ id: 'msg_w', write: 3000, write1h: 1000 })))],
    pricing,
  );
  expect(report.total.cacheWriteInputTokens).toBe(3000);
  expect(report.total.cacheWrite1hInputTokens).toBe(1000);
  // Haiku ≤100k: 1000 × 0,2 (1 h) + 2000 × 0,125 (5 min), em US$/MTok.
  const expected = (1000 * 0.2 + 2000 * 0.125) / 1e6;
  const cost = priced(report.total);
  expect(cost.expensive).toBeCloseTo(expected, 10);
  expect(cost.cheap).toBeCloseTo(expected, 10);
});

test('exemplo trabalhado Haiku até 100k: entrada, escrita 1 h, leitura e saída', () => {
  const report = sessionCost(
    [
      main(
        ndjson(
          assistant({
            id: 'msg_1',
            input: 1000,
            write: 2000,
            write1h: 2000,
            read: 10000,
            output: 500,
          }),
        ),
      ),
    ],
    pricing,
  );
  const cost = priced(report.total);
  // (1000×0,1 + 2000×0,2 + 10000×0,01 + 500×0,5) / 1e6
  const expected = (1000 * 0.1 + 2000 * 0.2 + 10000 * 0.01 + 500 * 0.5) / 1e6;
  expect(expected).toBeCloseTo(0.00085, 12);
  expect(cost.expensive).toBeCloseTo(0.00085, 10);
  expect(cost.cheap).toBeCloseTo(0.00085, 10);
});

test('Haiku acima de 100k: entrada na faixa cara; saída cara e barata nas duas pontas', () => {
  const report = sessionCost(
    [
      main(
        ndjson(
          assistant({ id: 'msg_big', input: 10, read: 150000, output: 100 }),
        ),
      ),
    ],
    pricing,
  );
  const cost = priced(report.total);
  // Entrada 150010 > 100k: (10×0,5 + 150000×0,05) / 1e6 nas duas faixas.
  // Saída: 100×2,5 (cara) ou 100×0,5 (barata).
  expect(cost.expensive).toBeCloseTo(
    (10 * 0.5 + 150000 * 0.05) / 1e6 + (100 * 2.5) / 1e6,
    10,
  );
  expect(cost.expensive).toBeCloseTo(0.007755, 10);
  expect(cost.cheap).toBeCloseTo(
    (10 * 0.5 + 150000 * 0.05) / 1e6 + (100 * 0.5) / 1e6,
    10,
  );
  expect(cost.cheap).toBeCloseTo(0.007555, 10);
});

test('toda linha é limite inferior: o transcript não tem as chamadas auxiliares do CLI', () => {
  const report = sessionCost(
    [
      main(ndjson(assistant({ id: 'm1', input: 1000, output: 10 }))),
      subagent(ndjson(assistant({ id: 's1', input: 500, output: 5 }))),
    ],
    pricing,
  );
  expect(report.groups.map((g) => g.kind)).toEqual(['main', 'subagent']);
  for (const group of report.groups) {
    expect(group.total.lowerBound).toBe(true);
    for (const row of Object.values(group.models))
      expect(row.lowerBound).toBe(true);
  }
  for (const row of Object.values(report.byModel))
    expect(row.lowerBound).toBe(true);
  expect(report.total.lowerBound).toBe(true);
});

test('modelo sem preço deixa o custo indisponível, nunca zero', () => {
  const report = sessionCost(
    [
      main(
        ndjson(
          assistant({
            id: 'f1',
            model: 'claude-foo-9',
            input: 100,
            output: 10,
          }),
        ),
      ),
    ],
    pricing,
  );
  expect(report.total.cost).toEqual({
    status: 'unavailable',
    reason: 'model_without_price:claude-foo-9',
  });
});

test('sem nenhuma requisição reconhecida, a leitura falha em vez de somar zero', () => {
  expect(() => sessionCost([main('')], pricing)).toThrow(
    'Nenhuma requisição reconhecida',
  );
  expect(() =>
    sessionCost(
      [
        main(
          ndjson(
            { type: 'user', message: { content: 'oi' } },
            { type: 'system' },
          ),
        ),
      ],
      pricing,
    ),
  ).toThrow('Nenhuma requisição reconhecida');
});

test('requisição <synthetic> sem tokens é descartada e não derruba o custo', () => {
  const report = sessionCost(
    [
      main(
        ndjson(
          assistant({ id: 'syn', model: '<synthetic>' }),
          assistant({ id: 'real', input: 1000, output: 10 }),
        ),
      ),
    ],
    pricing,
  );
  expect(report.total.requests).toBe(1);
  expect(report.total.cost.status).toBe('available');
  expect(Object.keys(report.byModel)).toEqual([HAIKU]);
});

test('mesmo message.id no principal e num subagente conta uma vez, com o valor do principal', () => {
  const report = sessionCost(
    [
      main(ndjson(assistant({ id: 'msg_1', input: 1000, output: 10 }))),
      subagent(
        ndjson(
          assistant({ id: 'msg_1', input: 9999, output: 999 }),
          assistant({ id: 'msg_2', input: 500, output: 5 }),
        ),
      ),
    ],
    pricing,
  );
  expect(report.total.requests).toBe(2);
  expect(report.total.uncachedInputTokens).toBe(1500);
  expect(report.groups[1]!.total.requests).toBe(1);
  expect(report.groups[1]!.total.uncachedInputTokens).toBe(500);
});

test('subagente cujas requisições já estão no principal não gera grupo', () => {
  const report = sessionCost(
    [
      main(ndjson(assistant({ id: 'msg_1', input: 1000, output: 10 }))),
      subagent(ndjson(assistant({ id: 'msg_1', input: 9999, output: 999 }))),
    ],
    pricing,
  );
  expect(report.groups).toHaveLength(1);
  expect(report.total.requests).toBe(1);
});

test('rótulo do subagente: corta a descrição em 60 caracteres e usa o tipo como padrão', () => {
  expect(
    subagentLabel({ agentType: 'scout', description: 'x'.repeat(100) }),
  ).toBe('scout: ' + 'x'.repeat(60));
  expect(subagentLabel({ agentType: 'scout' })).toBe('scout');
  for (const meta of [null, 'texto', 42, []])
    expect(subagentLabel(meta)).toBe('subagente');
});

test('sessionCost usa o rótulo recebido no arquivo do subagente', () => {
  const report = sessionCost(
    [
      main(ndjson(assistant({ id: 'm1', input: 1000, output: 10 }))),
      subagent(
        ndjson(assistant({ id: 's1', input: 500, output: 5 })),
        'scout: pesquisa',
      ),
    ],
    pricing,
  );
  expect(report.groups[1]!.label).toBe('scout: pesquisa');
});

test('findTranscript: id em dois projetos é ambíguo; em um só, devolve o caminho', async () => {
  const config = await tempConfig();
  await writeTranscript(config, 'pa', 'sess-1');
  await writeTranscript(config, 'pb', 'sess-1');
  expect(await errorOf(findTranscript('sess-1', config))).toContain(
    'Mais de um transcript',
  );

  const single = await writeTranscript(config, 'pb', 'sess-2');
  expect(await findTranscript('sess-2', config)).toBe(single);
});

test('findTranscript: id inexistente e id com caracteres inválidos falham com mensagem própria', async () => {
  const config = await tempConfig();
  expect(await errorOf(findTranscript('nao-existe', config))).toContain(
    'não encontrado',
  );
  expect(await errorOf(findTranscript('../x', config))).toContain(
    'Id de sessão inválido',
  );
});

test('findTranscript: argumento .jsonl devolve o caminho resolvido sem procurar', async () => {
  const config = await tempConfig();
  expect(await findTranscript('relativo/sessao.jsonl', config)).toBe(
    resolve('relativo/sessao.jsonl'),
  );
});

test('saída não contém conteúdo de mensagem', () => {
  const secret = 'SEGREDO-MARCA-123';
  const report = sessionCost(
    [
      main(
        ndjson({
          type: 'assistant',
          message: {
            id: 'msg_s',
            model: HAIKU,
            usage: { input_tokens: 100, output_tokens: 5 },
            content: [{ type: 'text', text: secret }],
            marker: secret,
          },
        }),
      ),
    ],
    pricing,
  );
  expect(renderSessionCost(report)).not.toContain(secret);
  expect(JSON.stringify(report)).not.toContain(secret);
});

test('render: cita o caráter derivado, a data do pricing e o prefixo ≥ no total', () => {
  const text = renderSessionCost(
    sessionCost(
      [main(ndjson(assistant({ id: 'r1', input: 1000, output: 10 })))],
      pricing,
    ),
  );
  expect(text).toContain('derivado');
  expect(text).toContain('Custo derivado de evals/pricing.json');
  expect(text).toContain(`preços de ${pricing.retrievedAt}`);
  expect(text).toContain('≥ ');
});

test('contadores: linha assistant sem usage e linha isSidechain no principal viram aviso', () => {
  const report = sessionCost(
    [
      main(
        ndjson(
          {
            type: 'assistant',
            message: { id: 'sem_uso', model: HAIKU, content: [] },
          },
          {
            ...assistant({ id: 'sc1', input: 500, output: 5 }),
            isSidechain: true,
          },
          assistant({ id: 'r1', input: 1000, output: 10 }),
        ),
      ),
    ],
    pricing,
  );
  expect(report.noUsageLines).toBe(1);
  expect(report.sidechainLines).toBe(1);
  // A linha isSidechain com usage entra no grupo principal.
  expect(report.total.requests).toBe(2);
  const text = renderSessionCost(report);
  expect(text).toContain('linhas assistant sem usage');
  expect(text).toContain('linhas isSidechain');
});

test('rótulo do subagente sem caracteres de controle (ANSI) e com o tipo limitado', () => {
  const label = subagentLabel({
    agentType: 'x'.repeat(100),
    description: '\u001b[2J\u001b]0;pwned\u0007 olá',
  });
  expect(label).not.toMatch(/\p{Cc}/u);
  expect(label.startsWith('x'.repeat(40) + ': ')).toBe(true);
  expect(label).toContain('olá');
});

test('rótulo cortado no limite não deixa meio emoji', () => {
  const label = subagentLabel({
    agentType: 'scout',
    description: 'a'.repeat(59) + '😀',
  });
  expect(label).toBe('scout: ' + 'a'.repeat(59));
});

test('<synthetic> com saída é descartado: não derruba a sessão sem preço', () => {
  const report = sessionCost(
    [
      main(
        ndjson(
          assistant({ id: 'm1', input: 1000, output: 10 }),
          assistant({ id: 'syn', model: '<synthetic>', output: 3 }),
        ),
      ),
    ],
    pricing,
  );
  expect(report.total.requests).toBe(1);
  expect(report.total.cost.status).toBe('available');
});

test('o principal vence a dedup mesmo quando o subagente vem primeiro na lista', () => {
  const dup = assistant({ id: 'dup', input: 1000, output: 10 });
  const report = sessionCost(
    [subagent(ndjson(dup)), main(ndjson(dup))],
    pricing,
  );
  expect(report.groups.map((g) => g.kind)).toEqual(['main']);
  expect(report.total.requests).toBe(1);
});

test.each(['__proto__', 'constructor', 'toString'])(
  'nome de modelo hostil (%s) vira indisponível, sem poluir Object.prototype nem lançar',
  (model) => {
    const report = sessionCost(
      [main(ndjson(assistant({ id: 'h1', model, input: 1000, output: 10 })))],
      pricing,
    );
    expect(report.total.cost.status).toBe('unavailable');
    expect(JSON.stringify(report.total.cost)).toContain('model_without_price');
    expect(({} as Record<string, unknown>).uncachedInputTokens).toBeUndefined();
    expect(({} as Record<string, unknown>).outputTokens).toBeUndefined();
  },
);

test('nome de modelo com escape ANSI não chega ao terminal', () => {
  const report = sessionCost(
    [
      main(
        ndjson(
          assistant({ id: 'a1', model: '\u001b[2Jevil\u0007', input: 10 }),
        ),
      ),
    ],
    pricing,
  );
  const text = renderSessionCost(report);
  expect(text).not.toMatch(/(?!\n)\p{Cc}/u);
  expect(text).toContain('evil');
});
