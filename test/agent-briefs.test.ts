import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { approxTokens } from '@agentic-ddd/compiler';
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
  expect(core).toContain('não conhece nem deve inferir outras camadas');
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
  expect(() => roleForLayer('infrastructure')).toThrow('sem papel');
  expect(renderBrief({ packet: packet('usecase:create_order') })).toContain(
    '# Papel: executor de aplicação',
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
  expect(brief).toContain('## Seções adicionais (fora do specHash)');
  expect(brief).toContain(`(sha256: \`${sha256(archived)}\`)`);
  expect(brief.indexOf(archived)).toBeGreaterThan(
    brief.indexOf(text.trimEnd()),
  );
  expect(renderBrief({ packet: text })).not.toContain('fora do specHash');
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
  expect(brief).toContain('Resultado dos gates');
  expect(ROLE_CORES.reviewer).toContain('expect(true)');
});

test('saída nunca cai em caminho gerado', () => {
  for (const bad of [
    '.agentic',
    '.agentic/briefs',
    '.agents/skills/x',
    '.claude/skills',
    '.cursor/agents',
    '.codex/agents',
  ])
    expect(() => assertOutsideGenerated(ROOT, bad)).toThrow('caminho gerado');
  expect(assertOutsideGenerated(ROOT, '.agentic-tasks/briefs')).toBe(
    join(ROOT, '.agentic-tasks/briefs'),
  );
  expect(briefFileName('method:Order.cancel')).toBe('method-Order-cancel.md');
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
