import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  CORE_RULES,
  approxTokens,
  briefRules,
  composeRules,
  type Rule,
} from '@agentic-ddd/compiler';
import {
  ROLE_CORES,
  assertOutsideGenerated,
  briefFileName,
  main,
  parsePacket,
  renderBrief,
  renderReviewerBrief,
  roleForLayer,
  sha256,
} from '../scripts/agent-briefs';

const ROOT = resolve(import.meta.dir, '..');
const packets = new Map<string, string>();
function packet(item: string): string {
  const cached = packets.get(item);
  if (cached) return cached;
  const run = Bun.spawnSync(
    ['bun', 'src/cli/main.ts', 'packet', item, '--static'],
    { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
  );
  expect(run.exitCode).toBe(0);
  const text = run.stdout.toString();
  packets.set(item, text);
  return text;
}
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

test('brief é determinístico e traz núcleo do papel, arquivos e packet integral', () => {
  const text = packet('entity:Order');
  const brief = renderBrief({ packet: text });
  expect(brief).toBe(renderBrief({ packet: text }));
  expect(brief.startsWith(ROLE_CORES.domain)).toBe(true);
  expect(brief).toContain(text.trimEnd());
  expect(brief).toContain('examples/orders/domain/order.ts');
  // Linhas voláteis (estado de testes e linha do source) não entram no snapshot.
  expect(
    brief
      .replace(/^- Estado:.*$/m, '- Estado: <volátil>')
      .replace(/(source: `[^`]*?):\d+`/, '$1:N`'),
  ).toMatchSnapshot();
});

test('executor de domínio não é mandado ler a skill do módulo nem conhece outras camadas', () => {
  const brief = renderBrief({ packet: packet('entity:Order') });
  const core = ROLE_CORES.domain;
  expect(core).not.toContain('SKILL.md');
  expect(core).not.toContain('orders-dev');
  expect(brief).not.toContain('orders-dev');
  expect(core).toContain('do not know and must not infer other layers');
});

test('o papel vem da camada do item', () => {
  expect(roleForLayer(parsePacket(packet('entity:Order')).layer)).toBe(
    'domain',
  );
  expect(roleForLayer(parsePacket(packet('usecase:create_order')).layer)).toBe(
    'application',
  );
  expect(
    roleForLayer(parsePacket(packet('operator:order-operator')).layer),
  ).toBe('application');
  expect(roleForLayer('infrastructure')).toBe('infrastructure');
  expect(() => roleForLayer('presentation')).toThrow('sem papel');
  expect(renderBrief({ packet: packet('usecase:create_order') })).toContain(
    '# Role: application executor',
  );
});

test('o specHash do packet é preservado e divergência falha', () => {
  const text = packet('entity:Order');
  const { specHash } = parsePacket(text);
  expect(renderBrief({ packet: text, expectedSpecHash: specHash })).toContain(
    `specHash: \`${specHash}\``,
  );
  expect(() =>
    renderBrief({ packet: text, expectedSpecHash: '0'.repeat(64) }),
  ).toThrow('specHash divergente');
  expect(() =>
    parsePacket(
      text
        .replaceAll(specHash, '0'.repeat(64))
        .replace(/^- specHash.*$/m, `- specHash: \`${specHash}\``),
    ),
  ).toThrow('packet inconsistente');
  expect(() => parsePacket('sem campos')).toThrow('packet sem o campo');
});

test('conteúdo fora do packet fica em seção própria com hash próprio', () => {
  const text = packet('entity:Order');
  const archived = 'Given: x\nWhen: y\nThen: z';
  const brief = renderBrief({
    packet: text,
    extras: [{ title: 'Critérios arquivados', content: archived }],
  });
  expect(brief).toContain('## Additional sections (outside the specHash)');
  expect(brief).toContain(`(sha256: \`${sha256(archived)}\`)`);
  expect(brief.indexOf(archived)).toBeGreaterThan(
    brief.indexOf(text.trimEnd()),
  );
  expect(renderBrief({ packet: text })).not.toContain('outside the specHash');
});

test('orçamento de tokens: núcleos curtos e brief acima do limite falha', () => {
  for (const core of Object.values(ROLE_CORES))
    expect(approxTokens(core)).toBeLessThan(600);
  for (const item of [
    'entity:Order',
    'method:Order.cancel',
    'usecase:create_order',
    'operator:order-operator',
  ])
    expect(approxTokens(renderBrief({ packet: packet(item) }))).toBeLessThan(
      6000,
    );
  expect(() =>
    renderBrief({ packet: packet('entity:Order'), maxTokens: 100 }),
  ).toThrow('brief excede o orçamento');
});

test('brief de revisor: packets mais diff e gates em seções com hash próprio', () => {
  const packetsText = [packet('entity:Order'), packet('method:Order.cancel')];
  const brief = renderReviewerBrief({
    packets: packetsText,
    diff: 'diff --git a/x b/x',
    gates: 'I1..I5 ok',
  });
  expect(brief.startsWith(ROLE_CORES.reviewer)).toBe(true);
  for (const p of packetsText) expect(brief).toContain(p.trimEnd());
  expect(brief).toContain(`(sha256: \`${sha256('diff --git a/x b/x')}\`)`);
  expect(brief).toContain('Gate results');
  expect(ROLE_CORES.reviewer).toContain('expect(true)');
});

test('saída nunca cai em caminho gerado', () => {
  for (const bad of [
    '.agentic',
    '.agentic/briefs',
    '.agents/skills/x',
    '.claude/skills',
    '.claude/agents',
    '.cursor/agents',
    '.codex/agents',
  ])
    expect(() => assertOutsideGenerated(ROOT, bad)).toThrow('caminho gerado');
  expect(assertOutsideGenerated(ROOT, '.agentic-tasks/briefs')).toBe(
    join(ROOT, '.agentic-tasks/briefs'),
  );
  expect(briefFileName('method:Order.cancel')).toBe('method-Order-cancel.md');
  expect(briefFileName('usecase:a_b')).not.toBe(briefFileName('usecase:a__b'));
});

test('CLI grava um brief por item e recusa saída em caminho gerado', async () => {
  const out = await mkdtemp(join(tmpdir(), 'agentic-briefs-'));
  dirs.push(out);
  const cwd = process.cwd();
  process.chdir(ROOT);
  try {
    expect(await main(['entity:Order', '--out', out])).toBe(0);
    expect(await readdir(out)).toEqual(['entity-Order.md']);
    expect(await readFile(join(out, 'entity-Order.md'), 'utf8')).toBe(
      renderBrief({ packet: packet('entity:Order') }),
    );
    expect(await main(['entity:Order', '--out', '.agentic/briefs'])).toBe(1);
    expect(await main(['--out', out])).toBe(2);
    expect(await main(['entity:Inexistente', '--out', out])).toBe(1);
  } finally {
    process.chdir(cwd);
  }
});

test('os exemplos de resposta dos papéis são JSON válido com as chaves do contrato', () => {
  const example = (core: string): Record<string, unknown> => {
    const match = /in the format of the example: `(\{.*?\})`\./.exec(core);
    expect(match).not.toBeNull();
    return JSON.parse(match![1]!);
  };
  for (const role of ['domain', 'application', 'infrastructure'] as const)
    expect(Object.keys(example(ROLE_CORES[role]))).toEqual([
      'item',
      'specHash',
      'status',
      'verifyExitCode',
      'changedFiles',
      'findings',
    ]);
  const reviewer = example(ROLE_CORES.reviewer);
  expect(reviewer.status).toBe('changes_requested');
  expect(reviewer.findings).toEqual([
    { ref: 'I4', message: 'the test does not exercise the rule' },
  ]);
});

test('CLI recusa dois itens que gerariam o mesmo arquivo, sem escrever nada', async () => {
  const out = await mkdtemp(join(tmpdir(), 'agentic-briefs-'));
  dirs.push(out);
  const cwd = process.cwd();
  process.chdir(ROOT);
  try {
    expect(await main(['usecase:a-b', 'usecase:a:b', '--out', out])).toBe(1);
    expect(await readdir(out)).toEqual([]);
  } finally {
    process.chdir(cwd);
  }
});

const teamRule = (
  key: string,
  body: string,
  paths: string[] | null = null,
): Rule => ({
  key,
  file: `.ai/rules/${key}.md`,
  paths,
  body,
});

test('brief com regras traz só as aplicáveis e a substituição do time, nunca o texto do núcleo', () => {
  const text = packet('entity:Order');
  const original = CORE_RULES.find((r) => r.key === 'core/done')!.body;
  const all = composeRules(
    [
      teamRule('core/done', '- Versão do time de done.'),
      teamRule('geral', '- Regra geral do time.'),
      teamRule('dominio', '- Só para o domínio.', ['examples/orders/**']),
      teamRule('outro', '- Só para outro lugar.', ['nada/**']),
    ],
    [],
  );
  const rules = briefRules(all, ['examples/orders/domain/order.ts']);
  const brief = renderBrief({ packet: text, rules });
  expect(brief).toContain('Team rules');
  expect(brief).toContain('#### core/done\n\n- Versão do time de done.');
  expect(brief).toContain('- Regra geral do time.');
  expect(brief).toContain('- Só para o domínio.');
  expect(brief).not.toContain('- Só para outro lugar.');
  expect(brief).not.toContain(original);
  expect(renderBrief({ packet: text, rules: [] })).toBe(
    renderBrief({ packet: text }),
  );
  const reviewer = renderReviewerBrief({
    packets: [text],
    diff: 'd',
    gates: 'g',
    rules,
  });
  expect(reviewer).toContain('- Regra geral do time.');
});

test('estouro do sub-orçamento e do teto com regras lista as regras', () => {
  const text = packet('entity:Order');
  const rules = [
    teamRule('grande', `- ${'palavra '.repeat(400)}`),
    teamRule('pequena', '- curta'),
  ];
  expect(() =>
    renderBrief({ packet: text, rules, rulesMaxTokens: 50 }),
  ).toThrow(
    /regras do time excedem o orçamento: ~\d+ > 50 tokens \(grande ~\d+, pequena ~\d+\)/,
  );
  expect(() =>
    renderReviewerBrief({
      packets: [text],
      diff: 'd',
      gates: 'g',
      rules,
      rulesMaxTokens: 50,
    }),
  ).toThrow('regras do time excedem o orçamento');
  expect(() =>
    renderBrief({ packet: text, rules, maxTokens: 1000, rulesMaxTokens: 5000 }),
  ).toThrow(/brief excede o orçamento: .*grande ~\d+, pequena ~\d+/);
});

test('CLI com agentic.config.ts e .ai/rules grava as regras aplicáveis e respeita rules.briefMaxTokens', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentic-briefs-'));
  dirs.push(dir);
  const file = join(dir, 'packet.md');
  await Bun.write(file, packet('entity:Order'));
  await mkdir(join(dir, 'm'));
  // Sem import: defineConfig é identidade e a pasta temporária não resolve @agentic-ddd/*.
  const config = (budget: number) =>
    `export default { modules: [{ name: 'orders', path: 'm' }], rules: { briefMaxTokens: ${budget} } };\n`;
  await Bun.write(join(dir, 'agentic.config.ts'), config(2000));
  await Bun.write(join(dir, 'pequeno.config.ts'), config(1));
  await Bun.write(join(dir, '.ai/rules/geral.md'), '- REGRA-GERAL\n');
  await Bun.write(
    join(dir, '.ai/rules/dominio.md'),
    "---\npaths: ['examples/orders/domain/**']\n---\n- REGRA-DOMINIO\n",
  );
  await Bun.write(
    join(dir, '.ai/rules/fora.md'),
    "---\npaths: ['outro/**']\n---\n- REGRA-FORA\n",
  );
  const out = join(dir, 'out');
  const args = ['entity:Order', '--packet-file', file, '--out', out];
  const cwd = process.cwd();
  const error = console.error;
  const errors: string[] = [];
  console.error = (...a: unknown[]) => void errors.push(a.join(' '));
  process.chdir(dir);
  try {
    expect(await main(args)).toBe(0);
    const brief = await readFile(join(out, 'entity-Order.md'), 'utf8');
    expect(brief).toContain('### Team rules');
    expect(brief).toContain('- REGRA-GERAL');
    expect(brief).toContain('- REGRA-DOMINIO');
    expect(brief).not.toContain('REGRA-FORA');
    expect(await main([...args, '--config', 'pequeno.config.ts'])).toBe(1);
    expect(errors.join('\n')).toContain('regras do time excedem o orçamento');
  } finally {
    process.chdir(cwd);
    console.error = error;
  }
});

test('CLI: --packet-file sem agentic.config.ts funciona; --config explícito inexistente falha', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agentic-briefs-'));
  dirs.push(dir);
  const file = join(dir, 'packet.md');
  await Bun.write(file, packet('entity:Order'));
  const out = join(dir, 'out');
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    expect(
      await main(['entity:Order', '--packet-file', file, '--out', out]),
    ).toBe(0);
    expect(
      await main([
        'entity:Order',
        '--packet-file',
        file,
        '--out',
        out,
        '--config',
        'inexistente.ts',
      ]),
    ).toBe(1);
  } finally {
    process.chdir(cwd);
  }
});

test('brief de item de classe troca o escopo de corpo; method: fica igual', () => {
  const method = renderBrief({ packet: packet('method:Order.cancel') });
  expect(method).toContain('Change only the inside of the body given');
  const vo = packet('entity:Order')
    .replaceAll('entity:Order', 'valueobject:Dinheiro')
    .replace(/--item 'valueobject:Dinheiro'/, '--item valueobject:Dinheiro');
  const brief = renderBrief({ packet: vo });
  expect(brief).toContain('Change only the class given');
  expect(brief).not.toContain('inside of the body');
  expect(brief).toContain('only the class of `valueobject:Dinheiro`');
});

test('brief de adapter usa o papel de infraestrutura com escopo de classe', () => {
  const text = packet('entity:Order')
    .replaceAll('entity:Order', 'adapter:Repo')
    .replace('Camada: domain', 'Camada: infrastructure');
  const brief = renderBrief({ packet: text });
  expect(brief.startsWith(ROLE_CORES.infrastructure)).toBe(true);
  expect(brief).toContain('only the class of `adapter:Repo`');
  expect(brief).toContain("covers(['port:<Port>.<method>']");
});
