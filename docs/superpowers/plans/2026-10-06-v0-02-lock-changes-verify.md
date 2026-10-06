# Plano 2 — Lock, changes e `verify`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao compilador memória do domínio (`.agentic/domain.lock.json`), um diff semântico classificado, o ciclo de propostas em `changes/` (code-first com `--draft-change` e proposal-first com reconciliação e arquivamento), o `history.md` por módulo e o comando `agentic-ddd verify <NNNN>` com os gates G1–G6 — e registrar no exemplo os changes `0001` (estado inicial) e `0002` (cancelamento exige motivo).

**Architecture:** Tudo é derivado da IR que o plano 1 já produz. `diff.ts` achata a IR em elementos com hash de conteúdo (sem `source`) e classifica cada diferença; `lock.ts` serializa IR + índice de changes aplicados; `changes/` lê/valida propostas e `reconcile()` decide, de forma pura, o próximo lock e se uma proposta deve ser arquivada; o `compile` só executa essa decisão. O `verify` roda a suíte com reporter JUnit, mapeia os `covers` e avalia os gates numa função pura.

**Tech Stack:** Bun 1.4.2 (`Bun.YAML`, `bun test --reporter=junit`, `Bun.spawn`), TypeScript 6, Zod 4.6, `ajv` 8 (só em teste, para a equivalência Zod ↔ JSON Schema).

**Spec:** [`docs/superpowers/specs/2026-10-06-agentic-ddd-v0-design.md`](../specs/2026-10-06-agentic-ddd-v0-design.md) — este plano cobre §6.4 (`ir`, `--draft-change`, `verify`), §7 inteiro, §8.1, §8.2 (G1–G6; o G7 é do plano 3), §11 (changes de exemplo), §12.1 (diff, reconciliação, `verify`, equivalência Zod ↔ JSON Schema), §12.3 (formato do dataset) e os critérios de aceite 1 (completo) e 4 da §15. Índice: [`2026-10-06-v0-00-index.md`](2026-10-06-v0-00-index.md).

## Global Constraints

- Tudo do plano 1 continua valendo: Bun 1.4.2 e `bun:test`; imports relativos **sem** extensão (`moduleResolution: "bundler"`); `import type` em assinaturas de classes decoradas; aliases `@agentic-ddd/*`; `examples/**` só importa o framework via alias; textos e mensagens em pt-BR; lint (`oxlint`) com **zero warnings**; prettier só nos arquivos tocados; commits Conventional Commits em pt-BR **sem** `Co-Authored-By`; e-mail `joao.oliveira@softtor.com.br`.
- Saída gerada determinística: `stableStringify` (chaves ordenadas, 2 espaços, `\n` final), listas ordenadas por id, caminhos POSIX relativos, sem timestamp.
- Lock em `.agentic/domain.lock.json` (`out.lock`), propostas em `changes/` (`config.changes`, padrão `changes`); **os dois são resolvidos contra `outRoot`** (é onde o `compile` escreve e arquiva).
- Proposta: `changes/NNNN-<slug>/proposal.md` (NNNN de 4 dígitos, slug kebab-case); frontmatter YAML com `id` (string, entre aspas), `title`, `status` (`proposed` | `applied`), `origin` (`proposal-first` | `code-first`), `delta.{added,modified,removed}` (listas de IDs `tipo:caminho`) e `acceptance`; corpo com `## Motivo` obrigatório para aplicar.
- IDs de elementos: `entity:X`, `invariant:X/id`, `method:X.m`, `event:E`, `usecase:u`, `operator:o`, `criterion:NNNN/id` (spec §5.1).
- O lock só muda por reconciliação de proposta ou por diff exclusivamente `docs` (spec §7.3). No máximo **uma** proposta aberta (v0). Proposta arquivada é imutável (hash no lock).
- `verify` exporta `AGENTIC_DDD_VERIFY=1` para os processos filhos; o teste e2e do `verify` é pulado quando essa variável existe (evita recursão infinita: o `verify` roda a suíte, que contém o teste do `verify`).
- `ajv` entra **só como devDependency** e só em teste; geração de JSON Schema continua exclusivamente via `z.toJSONSchema()`.

## Review Focus

1. **Proposta com YAML inválido ou `id: 0002` sem aspas** (YAML lê como número) → erro com o caminho do `proposal.md` e dica de usar aspas, nunca exceção crua. Teste na Task 5.
2. **Proposta arquivada editada à mão** → `compile` (write e check) falha dizendo que propostas arquivadas são imutáveis. Teste na Task 8.
3. **Lock corrompido ou de versão desconhecida** → erro em pt-BR citando `.agentic/domain.lock.json` e o que fazer, nunca `SyntaxError` crua. Teste na Task 4.
4. **Teste com `covers` de um ID que não existe** (erro de digitação) → G4 falha apontando o teste e o arquivo, em vez de o critério parecer coberto. Teste na Task 10.
5. **`verify` rodando dentro da própria suíte** → os filhos recebem `AGENTIC_DDD_VERIFY=1` e o e2e se pula, sem loop. Teste nas Tasks 9 e 11.

---

## Estrutura de arquivos

```
src/cli/
  main.ts                 (modificado: só despacha comandos)
  usage.ts  args.ts  args.test.ts
  commands/ compile.ts  ir.ts  verify.ts
  cli.test.ts             (modificado)  verify.test.ts (e2e)
src/compiler/
  compile.ts              (modificado: analyzeProject, reconciliação, draft, lock)
  config.ts               (modificado: changes, out.lock, verify)
  diff.ts  diff.test.ts
  lock.ts  lock.test.ts
  json-schema.test.ts
  changes/ proposal.ts  proposal.test.ts  reconcile.ts  reconcile.test.ts  draft.ts  apply.ts
  render/ history.ts  history.test.ts  dev-skill.ts (mod.)  agents-md.ts (mod.)  index.ts (mod.)
  verify/ test-run.ts  test-run.test.ts  gates.ts  gates.test.ts  index.ts
  index.ts                (modificado: novos exports)
test/helpers/bootstrap.ts
test/evals.test.ts
examples/orders/          (modificado na Task 12: cancelamento com motivo)
examples/orders/test/operator.test.ts
changes/archive/0001-estado-inicial/proposal.md          (Task 8)
changes/archive/0002-cancelamento-exige-motivo/proposal.md (Task 12)
.agentic/domain.lock.json                                 (gerado)
evals/skills/orders.yaml
```

---

### Task 1: CLI por comandos e comando `ir`

**Files:**
- Create: `src/cli/usage.ts`, `src/cli/args.ts`, `src/cli/args.test.ts`, `src/cli/commands/compile.ts`, `src/cli/commands/ir.ts`
- Modify: `src/cli/main.ts`, `src/compiler/compile.ts`, `src/compiler/index.ts`, `src/cli/cli.test.ts`

**Interfaces:**
- Consumes: `compile`, `loadConfig`, `importModules`, `analyze`, `stableStringify`, `formatReport` (plano 1).
- Produces:
  - `src/cli/args.ts`: `interface ArgSpec { booleans: readonly string[]; values: readonly string[]; positionals: number }`, `interface ParsedArgs { flags: ReadonlySet<string>; values: ReadonlyMap<string, string>; positionals: readonly string[] }`, `parseArgs(args, spec): ParsedArgs | string` (string = mensagem de erro de uso).
  - `src/cli/usage.ts`: `USAGE: string`.
  - `src/cli/commands/compile.ts`: `compileCommand(args: readonly string[]): Promise<number>`; `src/cli/commands/ir.ts`: `irCommand(args): Promise<number>`.
  - `src/compiler/compile.ts`: `interface ProjectAnalysis { config: ResolvedConfig; ir: IR; errors: CompileError[] }`, `analyzeProject(options: { configPath: string; outRoot?: string; registry?: Registry }): Promise<ProjectAnalysis>` (exportado também em `@agentic-ddd/compiler`).
  - CLI: `agentic-ddd ir [--config <arquivo>]` imprime a IR canônica (`stableStringify`) em stdout; exit 0, 1 (erro de declaração/config) ou 2 (uso).

- [ ] **Step 1: Escrever os testes que falham**

Create `src/cli/args.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { parseArgs } from './args';

const spec = { booleans: ['--check'], values: ['--config'], positionals: 1 };

describe('parseArgs', () => {
  test('separa flags, valores e posicionais', () => {
    const parsed = parseArgs(['0002', '--check', '--config', 'x.ts'], spec);
    expect(typeof parsed).toBe('object');
    if (typeof parsed === 'string') return;
    expect([...parsed.flags]).toEqual(['--check']);
    expect(parsed.values.get('--config')).toBe('x.ts');
    expect(parsed.positionals).toEqual(['0002']);
  });

  test('erros de uso viram mensagem', () => {
    expect(parseArgs(['0002', '--nada'], spec)).toBe('opção desconhecida: --nada');
    expect(parseArgs(['0002', '--config'], spec)).toBe('--config exige um valor');
    expect(parseArgs([], spec)).toBe('esperado 1 argumento(s), recebido 0');
    expect(parseArgs(['a', 'b'], spec)).toBe('esperado 1 argumento(s), recebido 2');
  });
});
```

Append to `src/cli/cli.test.ts`, inside the `describe('agentic-ddd compile (CLI)', …)` block:

```ts
  test('ir imprime a IR canônica', () => {
    const result = run('ir');
    expect(result.code).toBe(0);
    const ir = JSON.parse(result.stdout) as { irVersion: number; operators: { id: string }[] };
    expect(ir.irVersion).toBe(1);
    expect(ir.operators.map((o) => o.id)).toEqual(['operator:order-operator']);
    expect(result.stdout.endsWith('}\n')).toBe(true);
  });

  test('ir com erro de declaração sai com 1', () => {
    const result = run('ir', '--config', 'test/fixtures/broken/agentic.config.ts');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('domain/thing.ts:5:');
  });

  test('ir com argumento sobrando sai com 2', () => {
    expect(run('ir', 'extra').code).toBe(2);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test src/cli`
Expected: FAIL — `./args.js` não encontrado; `ir` cai em uso incorreto (exit 2).

- [ ] **Step 3: Implementar**

`src/cli/args.ts`:

```ts
export interface ArgSpec {
  readonly booleans: readonly string[];
  readonly values: readonly string[];
  readonly positionals: number;
}

export interface ParsedArgs {
  readonly flags: ReadonlySet<string>;
  readonly values: ReadonlyMap<string, string>;
  readonly positionals: readonly string[];
}

export function parseArgs(args: readonly string[], spec: ArgSpec): ParsedArgs | string {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (spec.booleans.includes(arg)) {
      flags.add(arg);
    } else if (spec.values.includes(arg)) {
      const value = args[++i];
      if (value === undefined || value.startsWith('--')) return `${arg} exige um valor`;
      values.set(arg, value);
    } else if (arg.startsWith('--')) {
      return `opção desconhecida: ${arg}`;
    } else {
      positionals.push(arg);
    }
  }
  if (positionals.length !== spec.positionals) {
    return `esperado ${spec.positionals} argumento(s), recebido ${positionals.length}`;
  }
  return { flags, values, positionals };
}
```

`src/cli/usage.ts`:

```ts
export const USAGE = [
  'uso:',
  '  agentic-ddd compile [--check] [--report] [--config <arquivo>] [--out-root <dir>]',
  '  agentic-ddd ir [--config <arquivo>]',
].join('\n');
```

`src/cli/commands/compile.ts` (o mesmo comportamento que hoje está em `main.ts`, agora com `parseArgs`):

```ts
import { compile } from '../../compiler/compile';
import { formatReport } from '../../compiler/report';
import { parseArgs } from '../args';
import { USAGE } from '../usage';

export async function compileCommand(args: readonly string[]): Promise<number> {
  const parsed = parseArgs(args, {
    booleans: ['--check', '--report'],
    values: ['--config', '--out-root'],
    positionals: 0,
  });
  if (typeof parsed === 'string') {
    console.error(`${parsed}\n${USAGE}`);
    return 2;
  }
  const check = parsed.flags.has('--check');
  const result = await compile({
    configPath: parsed.values.get('--config') ?? 'agentic.config.ts',
    outRoot: parsed.values.get('--out-root'),
    mode: check ? 'check' : 'write',
  });
  if (parsed.flags.has('--report') && result.rendered) console.log(formatReport(result.rendered, result.lint));
  for (const error of result.errors) console.error(`${error.source ?? '-'}: ${error.message}`);
  for (const item of result.drift) console.error(`desatualizado (${item.reason}): ${item.path}`);
  for (const warning of result.warnings) console.warn(`aviso: ${warning}`);
  if (!result.ok) {
    const blocked = result.drift.filter((item) => item.reason === 'conflict');
    if (result.drift.length > blocked.length) console.error('rode `bun run agentic compile` e commite os arquivos gerados');
    for (const item of blocked) {
      console.error(`para ${item.path}: remova ou renomeie o diretório existente, ou ajuste out/mirrors em agentic.config.ts`);
    }
    return 1;
  }
  console.log(check ? 'agentic-ddd: arquivos gerados estão em dia' : `agentic-ddd: ${result.written.length} arquivo(s) atualizado(s)`);
  return 0;
}
```

`src/cli/commands/ir.ts`:

```ts
import { analyzeProject } from '../../compiler/compile';
import { stableStringify } from '../../compiler/canonical';
import { parseArgs } from '../args';
import { USAGE } from '../usage';

export async function irCommand(args: readonly string[]): Promise<number> {
  const parsed = parseArgs(args, { booleans: [], values: ['--config'], positionals: 0 });
  if (typeof parsed === 'string') {
    console.error(`${parsed}\n${USAGE}`);
    return 2;
  }
  const { ir, errors } = await analyzeProject({ configPath: parsed.values.get('--config') ?? 'agentic.config.ts' });
  for (const error of errors) console.error(`${error.source ?? '-'}: ${error.message}`);
  if (errors.length > 0) return 1;
  process.stdout.write(stableStringify(ir));
  return 0;
}
```

Replace `src/cli/main.ts`:

```ts
import { compileCommand } from './commands/compile';
import { irCommand } from './commands/ir';
import { USAGE } from './usage';

export { USAGE };

const COMMANDS: Readonly<Record<string, (args: readonly string[]) => Promise<number>>> = {
  compile: compileCommand,
  ir: irCommand,
};

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const run = command === undefined ? undefined : COMMANDS[command];
  if (!run) {
    console.error(USAGE);
    return 2;
  }
  try {
    return await run(rest);
  } catch (error) {
    console.error(`agentic-ddd: ${(error as Error).message}`);
    return 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
```

In `src/compiler/compile.ts`, add (after the `CompileResult` interface) and make `compile` use it — replace the first lines of `compile()` (`const config = await loadConfig(...)` … `const { ir, errors } = analyze(...)`) by `const { config, ir, errors } = await analyzeProject(options);`:

```ts
export interface ProjectAnalysis {
  readonly config: ResolvedConfig;
  readonly ir: IR;
  readonly errors: CompileError[];
}

export async function analyzeProject(options: {
  readonly configPath: string;
  readonly outRoot?: string;
  readonly registry?: Registry;
}): Promise<ProjectAnalysis> {
  const config = await loadConfig(options.configPath, { outRoot: options.outRoot });
  await importModules(config);
  const { ir, errors } = analyze(options.registry ?? defaultRegistry, {
    root: config.root,
    modules: config.modules,
  });
  return { config, ir, errors };
}
```

In `src/compiler/index.ts`, change the compile export line to:

```ts
export {
  analyzeProject,
  compile,
  type CompileOptions,
  type CompileResult,
  type ProjectAnalysis,
} from './compile';
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bun test src/cli src/compiler && bun run typecheck && bun run lint`
Expected: todos passam (os testes antigos do CLI continuam verdes); zero warnings.

- [ ] **Step 5: Commit**

```bash
git add src/cli src/compiler/compile.ts src/compiler/index.ts
git commit -m "feat(cli): organiza o CLI por comandos e adiciona agentic-ddd ir"
```

---

### Task 2: Equivalência entre Zod e o JSON Schema gerado

**Files:**
- Modify: `package.json`, `bun.lock` (devDependency `ajv`)
- Test: `src/compiler/json-schema.test.ts`

**Interfaces:**
- Consumes: os schemas exportados pelos use-cases do exemplo (`createOrderInput`, `createOrderOutput`, `confirmOrderInput`, `cancelOrderInput`), o payload de `OrderCreated` via `defaultRegistry`.
- Produces: nenhuma API; garante a spec §12.1 ("o JSON Schema gerado aceita e rejeita as mesmas amostras que o Zod").
- Nota: este teste importa `examples/orders` a partir de `src/compiler` **de propósito** — ele fixa os schemas reais do exemplo, não os da fixture `shop`. O teste de arquitetura só vigia arquivos que não são `*.test.ts`, então não há violação.

- [ ] **Step 1: Instalar o validador (só para teste)**

```bash
bun add -d ajv@8.20.0
```

- [ ] **Step 2: Escrever o teste**

Create `src/compiler/json-schema.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { z, type ZodType } from 'zod';
import { defaultRegistry } from '@agentic-ddd/decorators';
import { confirmOrderInput } from '../../examples/orders/application/confirm-order';
import { createOrderInput, createOrderOutput } from '../../examples/orders/application/create-order';
import { OrderCreated } from '../../examples/orders/domain/order.events';

const ajv = new Ajv2020({ strict: false });

interface Case {
  readonly name: string;
  readonly schema: ZodType;
  readonly io: 'input' | 'output';
  readonly samples: readonly unknown[];
}

const item = { sku: 'SKU-1', quantity: 2, unit_price: 10 };

const cases: Case[] = [
  {
    name: 'create_order input',
    schema: createOrderInput,
    io: 'input',
    samples: [
      { order_id: 'o1', customer_id: 'c1', items: [item] },
      { order_id: 'o1', customer_id: 'c1', items: [item], extra: true },
      { order_id: '', customer_id: 'c1', items: [item] },
      { order_id: 'o1', customer_id: 'c1', items: [] },
      { order_id: 'o1', customer_id: 'c1', items: [{ ...item, quantity: 0 }] },
      { order_id: 'o1', customer_id: 'c1', items: [{ ...item, quantity: 1.5 }] },
      { order_id: 'o1', customer_id: 'c1', items: [{ ...item, unit_price: -1 }] },
      { order_id: 'o1', items: [item] },
      'texto',
      null,
    ],
  },
  {
    name: 'create_order output',
    schema: createOrderOutput,
    io: 'output',
    samples: [
      { order_id: 'o1', status: 'pending', total: 20 },
      { order_id: 'o1', status: 'confirmed', total: 20 },
      { order_id: 'o1', status: 'pending' },
    ],
  },
  {
    name: 'confirm_order input',
    schema: confirmOrderInput,
    io: 'input',
    samples: [{ order_id: 'o1' }, { order_id: '' }, {}, { order_id: 1 }],
  },
  {
    name: 'OrderCreated payload',
    schema: defaultRegistry.events.find((e) => e.target === OrderCreated)!.payload,
    io: 'output',
    samples: [
      { orderId: 'o1', customerId: 'c1', total: 20 },
      { orderId: 'o1', customerId: 'c1' },
      { orderId: 'o1', customerId: 'c1', total: '20' },
    ],
  },
  {
    name: 'input com default e transform',
    schema: z.object({ a: z.string().default('x'), b: z.string().transform((s) => s.length) }),
    io: 'input',
    samples: [{ b: 'abc' }, { a: 'y', b: 'abc' }, { a: 1, b: 'abc' }, {}],
  },
];

describe('JSON Schema gerado ≡ Zod', () => {
  for (const c of cases) {
    test(`${c.name}: aceita e rejeita as mesmas amostras`, () => {
      const validate = ajv.compile(z.toJSONSchema(c.schema, { io: c.io }));
      const disagreements = c.samples.filter((sample) => validate(sample) !== c.schema.safeParse(sample).success);
      expect(disagreements).toEqual([]);
    });
  }
});
```

- [ ] **Step 3: Rodar**

Run: `bun test src/compiler/json-schema.test.ts`
Expected: `5 pass`. Se algum caso divergir, NÃO mude o teste para passar: reporte a amostra divergente (é uma diferença real entre o Zod e o JSON Schema que as tools publicam). Se o `ajv` reclamar de alguma palavra-chave, mantenha o `strict: false` já configurado; não acrescente `allErrors`, não remova palavras-chave do schema e não mexa no gerador de JSON Schema.

- [ ] **Step 4: Verificar e commitar**

Run: `bun test && bun run typecheck && bun run lint`
Expected: tudo verde, zero warnings.

```bash
git add package.json bun.lock src/compiler/json-schema.test.ts
git commit -m "test(compiler): prova que o JSON Schema gerado aceita e rejeita o mesmo que o Zod"
```

---

### Task 3: Diff semântico com classificação

**Files:**
- Create: `src/compiler/diff.ts`
- Modify: `src/compiler/index.ts`
- Test: `src/compiler/diff.test.ts`

**Interfaces:**
- Consumes: `IR` e tipos (plano 1), `sha256`, `stableStringify`.
- Produces:
  - `type ElementKind = 'entity' | 'invariant' | 'method' | 'event' | 'usecase' | 'operator'`
  - `interface DomainElement { id: string; kind: ElementKind; module: string; content: Record<string, unknown> }`
  - `type ChangeKind = 'added' | 'modified' | 'removed'`, `type Classification = 'breaking' | 'behavioral' | 'docs'`
  - `interface DiffItem { id: string; kind: ChangeKind; classification: Classification; module: string }`
  - `EMPTY_IR: IR`, `elementsOf(ir): Map<string, DomainElement>`, `contentHash(element): string`, `semanticDiff(before: IR, after: IR): DiffItem[]` (ordenado por id).

Regras (spec §7.1): o conteúdo de cada elemento **não** inclui `source` nem os elementos filhos (a entidade não carrega invariantes/métodos; cada um é um elemento próprio). Classificação:
- `added` → `behavioral`.
- `removed` → `breaking` para use-case e para método que tinha transição; `behavioral` no resto.
- `modified` → `docs` se só mudaram `description`/`whenToUse`/`whenNotToUse`; `breaking` se for use-case com input que quebra (campo removido, campo passou a ser obrigatório, tipo de campo mudou) ou output que quebra (campo removido ou tipo mudou), ou método cuja transição foi removida; `behavioral` no resto.

- [ ] **Step 1: Escrever o teste que falha**

Create `src/compiler/diff.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from './__fixtures__/shop';
import { analyze } from './analyze';
import { EMPTY_IR, contentHash, elementsOf, semanticDiff } from './diff';
import type { IR } from './ir';

const ROOT = resolve(import.meta.dir, '../..');
const base = analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] }).ir;
const clone = (): any => JSON.parse(JSON.stringify(base));
const useCase = (ir: any, name: string): any => ir.useCases.find((u: any) => u.name === name);

describe('semanticDiff', () => {
  test('IR igual não tem diferenças', () => {
    expect(semanticDiff(base, clone() as IR)).toEqual([]);
  });

  test('da IR vazia, tudo é added e behavioral, ordenado por id', () => {
    const diff = semanticDiff(EMPTY_IR, base);
    expect(diff.map((i) => i.id)).toEqual([
      'entity:Product',
      'event:ProductCreated',
      'event:ProductPublished',
      'invariant:Product/preco-positivo',
      'invariant:Product/publicacao-exige-estoque',
      'method:Product.create',
      'method:Product.publish',
      'operator:catalog-operator',
      'usecase:create_product',
      'usecase:publish_product',
    ]);
    expect(new Set(diff.map((i) => `${i.kind}/${i.classification}/${i.module}`))).toEqual(new Set(['added/behavioral/shop']));
  });

  test('mudar só a fonte (arquivo:linha) não é diferença', () => {
    const ir = clone();
    ir.entities[0].source = 'outro.ts:1';
    ir.entities[0].methods[0].source = 'outro.ts:2';
    expect(semanticDiff(base, ir)).toEqual([]);
    expect(contentHash(elementsOf(base).get('entity:Product')!)).toBe(contentHash(elementsOf(ir).get('entity:Product')!));
  });

  test('texto de invariante muda → modified behavioral, sem marcar a entidade', () => {
    const ir = clone();
    ir.entities[0].invariants[0].text = 'Preço sempre acima de um real.';
    expect(semanticDiff(base, ir)).toEqual([
      { id: 'invariant:Product/preco-positivo', kind: 'modified', classification: 'behavioral', module: 'shop' },
    ]);
  });

  test('invariante nova não modifica a entidade nem o método', () => {
    const ir = clone();
    ir.entities[0].invariants.push({ id: 'invariant:Product/nova', text: 'Nova regra.', on: null, source: 'x.ts:1' });
    expect(semanticDiff(base, ir)).toEqual([
      { id: 'invariant:Product/nova', kind: 'added', classification: 'behavioral', module: 'shop' },
    ]);
  });

  test('só description/whenToUse mudam → docs', () => {
    const ir = clone();
    useCase(ir, 'publish_product').description = 'Outra descrição.';
    useCase(ir, 'publish_product').whenToUse = 'Outro quando.';
    expect(semanticDiff(base, ir)).toEqual([
      { id: 'usecase:publish_product', kind: 'modified', classification: 'docs', module: 'shop' },
    ]);
  });

  test('input ganha campo obrigatório → breaking; campo opcional → behavioral', () => {
    const required = clone();
    const input = useCase(required, 'publish_product').inputSchema;
    input.properties.reason = { type: 'string' };
    input.required = [...input.required, 'reason'];
    expect(semanticDiff(base, required)[0]!.classification).toBe('breaking');

    const optional = clone();
    useCase(optional, 'publish_product').inputSchema.properties.note = { type: 'string' };
    expect(semanticDiff(base, optional)[0]!.classification).toBe('behavioral');
  });

  test('input perde campo ou muda tipo → breaking; output perde campo → breaking', () => {
    const removed = clone();
    delete useCase(removed, 'create_product').inputSchema.properties.price;
    expect(semanticDiff(base, removed)[0]!.classification).toBe('breaking');

    const retyped = clone();
    useCase(retyped, 'create_product').inputSchema.properties.price = { type: 'string' };
    expect(semanticDiff(base, retyped)[0]!.classification).toBe('breaking');

    const output = clone();
    delete useCase(output, 'create_product').outputSchema.properties.status;
    expect(semanticDiff(base, output)[0]!.classification).toBe('breaking');
  });

  test('use-case removido → breaking; uses alterado → behavioral', () => {
    const removed = clone();
    removed.useCases = removed.useCases.filter((u: any) => u.name !== 'create_product');
    removed.operators[0].useCases = ['usecase:publish_product'];
    const diff = semanticDiff(base, removed);
    expect(diff.find((i) => i.id === 'usecase:create_product')).toEqual({
      id: 'usecase:create_product',
      kind: 'removed',
      classification: 'breaking',
      module: 'shop',
    });
    expect(diff.find((i) => i.id === 'operator:catalog-operator')!.classification).toBe('behavioral');

    const uses = clone();
    useCase(uses, 'publish_product').uses = ['method:Product.create'];
    expect(semanticDiff(base, uses)[0]!.classification).toBe('behavioral');
  });

  test('método perde a transição → breaking; emits muda → behavioral', () => {
    const noTransition = clone();
    noTransition.entities[0].methods[1].transition = null;
    expect(semanticDiff(base, noTransition)[0]).toEqual({
      id: 'method:Product.publish',
      kind: 'modified',
      classification: 'breaking',
      module: 'shop',
    });

    const emits = clone();
    emits.entities[0].methods[1].emits = [];
    expect(semanticDiff(base, emits)[0]!.classification).toBe('behavioral');
  });

  test('método com transição removido → breaking', () => {
    const ir = clone();
    ir.entities[0].methods = ir.entities[0].methods.filter((m: any) => m.name !== 'publish');
    ir.entities[0].invariants = ir.entities[0].invariants.filter((i: any) => i.on === null);
    expect(semanticDiff(base, ir).find((i) => i.id === 'method:Product.publish')!.classification).toBe('breaking');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test src/compiler/diff.test.ts`
Expected: FAIL — `./diff.js` não encontrado.

- [ ] **Step 3: Implementar**

`src/compiler/diff.ts`:

```ts
import { sha256, stableStringify } from './canonical';
import type { IR, JsonSchema } from './ir';

export type ElementKind = 'entity' | 'invariant' | 'method' | 'event' | 'usecase' | 'operator';
export type ChangeKind = 'added' | 'modified' | 'removed';
export type Classification = 'breaking' | 'behavioral' | 'docs';

export interface DomainElement {
  readonly id: string;
  readonly kind: ElementKind;
  readonly module: string;
  readonly content: Readonly<Record<string, unknown>>;
}

export interface DiffItem {
  readonly id: string;
  readonly kind: ChangeKind;
  readonly classification: Classification;
  readonly module: string;
}

export const EMPTY_IR: IR = { irVersion: 1, modules: [], entities: [], events: [], useCases: [], operators: [] };

const DOC_FIELDS = new Set(['description', 'whenToUse', 'whenNotToUse']);

export function elementsOf(ir: IR): Map<string, DomainElement> {
  const elements = new Map<string, DomainElement>();
  const add = (element: DomainElement): void => {
    elements.set(element.id, element);
  };
  for (const e of ir.entities) {
    add({ id: e.id, kind: 'entity', module: e.module, content: { name: e.name, module: e.module, description: e.description, states: e.states } });
    for (const i of e.invariants) add({ id: i.id, kind: 'invariant', module: e.module, content: { text: i.text, on: i.on } });
    for (const m of e.methods) {
      add({
        id: m.id,
        kind: 'method',
        module: e.module,
        content: { name: m.name, static: m.static, description: m.description, transition: m.transition, emits: m.emits },
      });
    }
  }
  for (const ev of ir.events) {
    add({ id: ev.id, kind: 'event', module: ev.module, content: { name: ev.name, module: ev.module, description: ev.description, payloadSchema: ev.payloadSchema } });
  }
  for (const u of ir.useCases) {
    add({
      id: u.id,
      kind: 'usecase',
      module: u.module,
      content: {
        name: u.name,
        module: u.module,
        description: u.description,
        whenToUse: u.whenToUse,
        whenNotToUse: u.whenNotToUse,
        inputSchema: u.inputSchema,
        outputSchema: u.outputSchema,
        uses: u.uses,
        emits: u.emits,
      },
    });
  }
  for (const o of ir.operators) {
    add({
      id: o.id,
      kind: 'operator',
      module: o.module,
      content: {
        name: o.name,
        module: o.module,
        description: o.description,
        instructions: o.instructions,
        useCases: o.useCases,
        requiresApproval: o.requiresApproval,
        limits: o.limits,
        model: o.model,
      },
    });
  }
  return elements;
}

export function contentHash(element: DomainElement): string {
  return sha256(stableStringify(element.content));
}

const properties = (schema: unknown): Record<string, JsonSchema> =>
  ((schema as JsonSchema | undefined)?.properties ?? {}) as Record<string, JsonSchema>;
const requiredOf = (schema: unknown): Set<string> =>
  new Set(((schema as JsonSchema | undefined)?.required ?? []) as string[]);
const typeOf = (property: JsonSchema | undefined): string =>
  stableStringify(property?.type ?? property?.anyOf ?? property?.enum ?? property?.const ?? null);

function inputBreaks(before: unknown, after: unknown): boolean {
  const old = properties(before);
  const next = properties(after);
  const oldRequired = requiredOf(before);
  if (Object.keys(old).some((key) => !(key in next))) return true;
  if ([...requiredOf(after)].some((key) => !oldRequired.has(key))) return true;
  return Object.keys(old).some((key) => key in next && typeOf(old[key]) !== typeOf(next[key]));
}

function outputBreaks(before: unknown, after: unknown): boolean {
  const old = properties(before);
  const next = properties(after);
  return Object.keys(old).some((key) => !(key in next) || typeOf(old[key]) !== typeOf(next[key]));
}

function classifyModified(before: DomainElement, after: DomainElement): Classification {
  const keys = new Set([...Object.keys(before.content), ...Object.keys(after.content)]);
  const changed = [...keys].filter((key) => stableStringify(before.content[key] ?? null) !== stableStringify(after.content[key] ?? null));
  if (changed.every((key) => DOC_FIELDS.has(key))) return 'docs';
  if (
    after.kind === 'usecase' &&
    (inputBreaks(before.content.inputSchema, after.content.inputSchema) ||
      outputBreaks(before.content.outputSchema, after.content.outputSchema))
  ) {
    return 'breaking';
  }
  if (after.kind === 'method' && before.content.transition !== null && after.content.transition === null) return 'breaking';
  return 'behavioral';
}

function classifyRemoved(before: DomainElement): Classification {
  if (before.kind === 'usecase') return 'breaking';
  if (before.kind === 'method' && before.content.transition !== null) return 'breaking';
  return 'behavioral';
}

export function semanticDiff(before: IR, after: IR): DiffItem[] {
  const old = elementsOf(before);
  const next = elementsOf(after);
  const items: DiffItem[] = [];
  for (const [id, element] of next) {
    const previous = old.get(id);
    if (!previous) items.push({ id, kind: 'added', classification: 'behavioral', module: element.module });
    else if (contentHash(previous) !== contentHash(element)) {
      items.push({ id, kind: 'modified', classification: classifyModified(previous, element), module: element.module });
    }
  }
  for (const [id, element] of old) {
    if (!next.has(id)) items.push({ id, kind: 'removed', classification: classifyRemoved(element), module: element.module });
  }
  return items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
```

In `src/compiler/index.ts`, add:

```ts
export {
  EMPTY_IR,
  contentHash,
  elementsOf,
  semanticDiff,
  type ChangeKind,
  type Classification,
  type DiffItem,
  type DomainElement,
  type ElementKind,
} from './diff';
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bun test src/compiler/diff.test.ts && bun run typecheck && bun run lint`
Expected: `11 pass`; zero warnings.

- [ ] **Step 5: Commit**

```bash
git add src/compiler/diff.ts src/compiler/diff.test.ts src/compiler/index.ts
git commit -m "feat(compiler): diff semântico da IR com classificação breaking/behavioral/docs"
```

---

### Task 4: Lock do domínio

**Files:**
- Create: `src/compiler/lock.ts`
- Modify: `src/compiler/index.ts`
- Test: `src/compiler/lock.test.ts`

**Interfaces:**
- Consumes: `IR`, `DiffItem` (Task 3), `stableStringify`.
- Produces:
  - `LOCK_VERSION = 1`
  - `interface LockChange { id: string; title: string; path: string /* proposta arquivada, POSIX relativo ao outRoot */; summary: string /* 1º parágrafo do Motivo */; hash: string /* sha256 do proposal.md arquivado */; items: DiffItem[] }`
  - `interface DomainLock { lockVersion: 1; ir: IR; changes: LockChange[] }`
  - `serializeLock(lock): string` (= `stableStringify`), `parseLock(text, displayPath): DomainLock` (lança `Error` em pt-BR), `readLock(absolutePath, displayPath): Promise<DomainLock | null>` (`null` se o arquivo não existe).

- [ ] **Step 1: Escrever o teste que falha**

Create `src/compiler/lock.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EMPTY_IR } from './diff';
import { parseLock, readLock, serializeLock, type DomainLock } from './lock';

const lock: DomainLock = {
  lockVersion: 1,
  ir: EMPTY_IR,
  changes: [
    {
      id: '0001',
      title: 'estado inicial',
      path: 'changes/archive/0001-estado-inicial/proposal.md',
      summary: 'Base do histórico.',
      hash: 'abc',
      items: [{ id: 'entity:Order', kind: 'added', classification: 'behavioral', module: 'orders' }],
    },
  ],
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agentic-lock-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('lock', () => {
  test('serializa de forma estável e volta igual', () => {
    const text = serializeLock(lock);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.indexOf('"changes"')).toBeLessThan(text.indexOf('"ir"'));
    expect(parseLock(text, '.agentic/domain.lock.json')).toEqual(lock);
  });

  test('JSON malformado vira erro em pt-BR com o caminho', () => {
    expect(() => parseLock('{', '.agentic/domain.lock.json')).toThrow(
      '.agentic/domain.lock.json: lock inválido (JSON malformado); restaure-o pelo git',
    );
  });

  test('versão desconhecida e lock incompleto viram erro', () => {
    expect(() => parseLock('{"lockVersion":2}', 'l.json')).toThrow('l.json: lockVersion 2 não suportada (esperado 1)');
    expect(() => parseLock('{"lockVersion":1,"changes":[]}', 'l.json')).toThrow('l.json: lock incompleto (faltam ir ou changes)');
  });

  test('readLock devolve null quando o arquivo não existe', async () => {
    expect(await readLock(join(dir, 'nao-existe.json'), 'x')).toBeNull();
    await writeFile(join(dir, 'l.json'), serializeLock(lock));
    expect(await readLock(join(dir, 'l.json'), 'l.json')).toEqual(lock);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test src/compiler/lock.test.ts`
Expected: FAIL — `./lock.js` não encontrado.

- [ ] **Step 3: Implementar**

`src/compiler/lock.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { stableStringify } from './canonical';
import type { DiffItem } from './diff';
import type { IR } from './ir';

export const LOCK_VERSION = 1;

export interface LockChange {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly summary: string;
  readonly hash: string;
  readonly items: DiffItem[];
}

export interface DomainLock {
  readonly lockVersion: 1;
  readonly ir: IR;
  readonly changes: LockChange[];
}

export function serializeLock(lock: DomainLock): string {
  return stableStringify(lock);
}

export function parseLock(text: string, displayPath: string): DomainLock {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${displayPath}: lock inválido (JSON malformado); restaure-o pelo git`);
  }
  const lock = (data ?? {}) as Partial<DomainLock>;
  if (lock.lockVersion !== LOCK_VERSION) {
    throw new Error(`${displayPath}: lockVersion ${String(lock.lockVersion)} não suportada (esperado ${LOCK_VERSION})`);
  }
  if (!lock.ir || lock.ir.irVersion !== 1 || !Array.isArray(lock.changes)) {
    throw new Error(`${displayPath}: lock incompleto (faltam ir ou changes)`);
  }
  return lock as DomainLock;
}

export async function readLock(absolutePath: string, displayPath: string): Promise<DomainLock | null> {
  let text: string;
  try {
    text = await readFile(absolutePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return parseLock(text, displayPath);
}
```

In `src/compiler/index.ts`, add:

```ts
export { LOCK_VERSION, parseLock, readLock, serializeLock, type DomainLock, type LockChange } from './lock';
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bun test src/compiler/lock.test.ts && bun run typecheck && bun run lint`
Expected: `4 pass`; zero warnings.

- [ ] **Step 5: Commit**

```bash
git add src/compiler/lock.ts src/compiler/lock.test.ts src/compiler/index.ts
git commit -m "feat(compiler): lock do domínio com IR canônica e índice de changes"
```

---
### Task 5: Propostas de change (leitura, validação e rascunho)

**Files:**
- Create: `src/compiler/changes/proposal.ts`
- Modify: `src/compiler/index.ts`
- Test: `src/compiler/changes/proposal.test.ts`

**Interfaces:**
- Consumes: `CompileError` (plano 1), `Bun.YAML.parse`.
- Produces:
  - `ELEMENT_ID` (regex dos IDs `tipo:caminho`, sem `criterion`), `MOTIVO_PLACEHOLDER` (comentário HTML do rascunho)
  - `interface Delta { added: string[]; modified: string[]; removed: string[] }`
  - `interface AcceptanceCriterion { id: string; covers: string[]; given: string | null; when: string | null; then: string; manual: boolean }`
  - `interface Proposal { id: string /* '0002' */; slug: string; title: string; status: 'proposed' | 'applied'; origin: 'proposal-first' | 'code-first'; delta: Delta; acceptance: AcceptanceCriterion[]; motivo: string; path: string /* POSIX relativo ao outRoot */; archived: boolean; raw: string }`
  - `parseProposal(raw, dirName, path, archived): { proposal: Proposal | null; errors: CompileError[] }`
  - `listProposals(changesAbs, changesRel): Promise<{ proposals: Proposal[]; errors: CompileError[] }>` (lê `changes/*/proposal.md` e `changes/archive/*/proposal.md`)
  - `extractMotivo(body): string`, `summarize(motivo): string`, `nextChangeId(proposals): string`, `renderDraft({ id, slug, delta }): string`, `markApplied(raw): string`

- [ ] **Step 1: Escrever o teste que falha**

Create `src/compiler/changes/proposal.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MOTIVO_PLACEHOLDER,
  extractMotivo,
  listProposals,
  markApplied,
  nextChangeId,
  parseProposal,
  renderDraft,
  summarize,
} from './proposal';

const VALID = `---
id: "0002"
title: Cancelamento exige motivo
status: proposed
origin: proposal-first
delta:
  added:
    - "invariant:Order/cancelamento-exige-motivo"
  modified:
    - "usecase:cancel_order"
  removed: []
acceptance:
  - id: rejeita-cancelamento-sem-motivo
    covers: ["invariant:Order/cancelamento-exige-motivo"]
    given: pedido pendente
    when: cancelar sem informar motivo
    then: falha com CANCELLATION_REASON_REQUIRED
  - id: revisao-de-copy
    manual: true
    then: mensagem revisada pelo produto
---

## Motivo

O atendimento precisa saber por que o pedido foi cancelado.

Segundo parágrafo com detalhes.
`;

const PATH = 'changes/0002-cancelamento-exige-motivo/proposal.md';
const parse = (raw: string, dir = '0002-cancelamento-exige-motivo') => parseProposal(raw, dir, PATH, false);
const messages = (raw: string, dir?: string) => parse(raw, dir).errors.map((e) => e.message);

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agentic-changes-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parseProposal', () => {
  test('lê uma proposta válida', () => {
    const { proposal, errors } = parse(VALID);
    expect(errors).toEqual([]);
    expect(proposal).toMatchObject({
      id: '0002',
      slug: 'cancelamento-exige-motivo',
      title: 'Cancelamento exige motivo',
      status: 'proposed',
      origin: 'proposal-first',
      delta: {
        added: ['invariant:Order/cancelamento-exige-motivo'],
        modified: ['usecase:cancel_order'],
        removed: [],
      },
      path: PATH,
      archived: false,
    });
    expect(proposal!.acceptance).toEqual([
      {
        id: 'rejeita-cancelamento-sem-motivo',
        covers: ['invariant:Order/cancelamento-exige-motivo'],
        given: 'pedido pendente',
        when: 'cancelar sem informar motivo',
        then: 'falha com CANCELLATION_REASON_REQUIRED',
        manual: false,
      },
      { id: 'revisao-de-copy', covers: [], given: null, when: null, then: 'mensagem revisada pelo produto', manual: true },
    ]);
    expect(proposal!.motivo).toBe('O atendimento precisa saber por que o pedido foi cancelado.\n\nSegundo parágrafo com detalhes.');
  });

  test('sem frontmatter, YAML inválido ou pasta fora do padrão', () => {
    expect(messages('# sem frontmatter\n')).toEqual(['frontmatter YAML ausente (o arquivo deve começar com ---)']);
    expect(messages('---\ndelta: [aberto\n---\n')[0]).toStartWith('frontmatter YAML inválido:');
    expect(messages(VALID, 'cancelamento')).toEqual([
      'nome de pasta "cancelamento" inválido (esperado NNNN-slug-em-kebab-case)',
    ]);
  });

  test('id sem aspas (lido como número) dá erro com dica', () => {
    expect(messages(VALID.replace('id: "0002"', 'id: 0002'))).toEqual([
      'id "2" difere do número da pasta (0002); escreva o id entre aspas: id: "0002"',
    ]);
  });

  test('campos obrigatórios e IDs do delta são validados', () => {
    const raw = VALID.replace('title: Cancelamento exige motivo', 'title: ""')
      .replace('status: proposed', 'status: aberta')
      .replace('"usecase:cancel_order"', '"cancel_order"');
    expect(messages(raw)).toEqual([
      'title é obrigatório',
      'status deve ser proposed ou applied',
      'delta.modified: ID inválido cancel_order (esperado tipo:caminho, ex.: usecase:cancel_order)',
    ]);
  });

  test('critérios: id repetido, automático sem covers/given/when', () => {
    const raw = VALID.replace('id: revisao-de-copy\n    manual: true', 'id: rejeita-cancelamento-sem-motivo').replace(
      '    covers: ["invariant:Order/cancelamento-exige-motivo"]\n',
      '',
    );
    expect(messages(raw)).toEqual([
      'acceptance[0]: critério automático precisa de covers',
      'acceptance[1]: id "rejeita-cancelamento-sem-motivo" repetido',
      'acceptance[1]: critério automático precisa de covers',
      'acceptance[1]: critério automático precisa de given e when',
    ]);
  });
});

describe('Motivo, rascunho e numeração', () => {
  test('extractMotivo ignora comentários HTML e para no próximo ##', () => {
    expect(extractMotivo(`\n## Motivo\n\n${MOTIVO_PLACEHOLDER}\n`)).toBe('');
    expect(extractMotivo('## Motivo\n\nPorque sim.\n\n## Notas\n\nOutra coisa.\n')).toBe('Porque sim.');
    expect(extractMotivo('sem seção\n')).toBe('');
  });

  test('summarize devolve o primeiro parágrafo numa linha', () => {
    expect(summarize('Linha um\ncontinua.\n\nOutro parágrafo.')).toBe('Linha um continua.');
  });

  test('renderDraft gera uma proposta code-first que o parser aceita, com Motivo vazio', () => {
    const raw = renderDraft({ id: '0001', slug: 'estado-inicial', delta: { added: ['entity:Order'], modified: [], removed: [] } });
    const { proposal, errors } = parseProposal(raw, '0001-estado-inicial', 'changes/0001-estado-inicial/proposal.md', false);
    expect(errors).toEqual([]);
    expect(proposal).toMatchObject({
      id: '0001',
      title: 'estado inicial',
      status: 'proposed',
      origin: 'code-first',
      delta: { added: ['entity:Order'], modified: [], removed: [] },
      acceptance: [],
      motivo: '',
    });
    expect(raw).toContain(MOTIVO_PLACEHOLDER);
  });

  test('markApplied troca só a linha de status', () => {
    expect(markApplied(VALID)).toBe(VALID.replace('status: proposed', 'status: applied'));
  });

  test('nextChangeId usa o maior número + 1, com 4 dígitos', () => {
    expect(nextChangeId([])).toBe('0001');
    expect(nextChangeId([{ id: '0001' }, { id: '0009' }] as never)).toBe('0010');
  });
});

describe('listProposals', () => {
  test('lê abertas e arquivadas; acusa proposal.md ausente e número repetido', async () => {
    await mkdir(join(dir, '0002-cancelamento-exige-motivo'), { recursive: true });
    await writeFile(join(dir, '0002-cancelamento-exige-motivo', 'proposal.md'), VALID);
    await mkdir(join(dir, 'archive', '0001-estado-inicial'), { recursive: true });
    await writeFile(
      join(dir, 'archive', '0001-estado-inicial', 'proposal.md'),
      markApplied(renderDraft({ id: '0001', slug: 'estado-inicial', delta: { added: ['entity:Order'], modified: [], removed: [] } })),
    );
    await mkdir(join(dir, '0003-vazia'), { recursive: true });
    await mkdir(join(dir, 'archive', '0002-duplicada'), { recursive: true });
    await writeFile(join(dir, 'archive', '0002-duplicada', 'proposal.md'), markApplied(VALID));

    const { proposals, errors } = await listProposals(dir, 'changes');
    expect(proposals.map((p) => [p.path, p.archived])).toEqual([
      ['changes/0002-cancelamento-exige-motivo/proposal.md', false],
      ['changes/archive/0001-estado-inicial/proposal.md', true],
      ['changes/archive/0002-duplicada/proposal.md', true],
    ]);
    expect(errors).toEqual([
      { message: 'proposal.md ausente', source: 'changes/0003-vazia' },
      {
        message: 'número 0002 repetido (também em changes/0002-cancelamento-exige-motivo/proposal.md)',
        source: 'changes/archive/0002-duplicada/proposal.md',
      },
    ]);
  });

  test('pasta changes inexistente não é erro', async () => {
    expect(await listProposals(join(dir, 'nao-existe'), 'changes')).toEqual({ proposals: [], errors: [] });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test src/compiler/changes/proposal.test.ts`
Expected: FAIL — `./proposal` não encontrado.

- [ ] **Step 3: Implementar**

`src/compiler/changes/proposal.ts`:

```ts
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CompileError } from '../ir';

export const ELEMENT_ID = /^(entity|invariant|method|event|usecase|operator):\S+$/;
export const MOTIVO_PLACEHOLDER =
  '<!-- Escreva aqui por que esta mudança existe (obrigatório). O compilador só aplica a proposta com o Motivo preenchido. -->';

const CHANGE_DIR = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;

export interface Delta {
  readonly added: string[];
  readonly modified: string[];
  readonly removed: string[];
}

export interface AcceptanceCriterion {
  readonly id: string;
  readonly covers: string[];
  readonly given: string | null;
  readonly when: string | null;
  readonly then: string;
  readonly manual: boolean;
}

export interface Proposal {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly status: 'proposed' | 'applied';
  readonly origin: 'proposal-first' | 'code-first';
  readonly delta: Delta;
  readonly acceptance: AcceptanceCriterion[];
  readonly motivo: string;
  readonly path: string;
  readonly archived: boolean;
  readonly raw: string;
}

export interface ParsedProposal {
  readonly proposal: Proposal | null;
  readonly errors: CompileError[];
}

export function extractMotivo(body: string): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Motivo\s*$/.test(line.trim()));
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  return (end === -1 ? rest : rest.slice(0, end))
    .join('\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
}

export function summarize(motivo: string): string {
  return (motivo.split(/\n\s*\n/)[0] ?? '').replace(/\s+/g, ' ').trim();
}

const nonEmpty = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

function stringList(value: unknown, field: string, err: (message: string) => void): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    err(`${field} deve ser uma lista de strings`);
    return [];
  }
  return value as string[];
}

export function parseProposal(raw: string, dirName: string, path: string, archived: boolean): ParsedProposal {
  const errors: CompileError[] = [];
  const err = (message: string): void => {
    errors.push({ message, source: path });
  };
  const dir = CHANGE_DIR.exec(dirName);
  if (!dir) {
    err(`nome de pasta "${dirName}" inválido (esperado NNNN-slug-em-kebab-case)`);
    return { proposal: null, errors };
  }
  const match = FRONTMATTER.exec(raw);
  if (!match) {
    err('frontmatter YAML ausente (o arquivo deve começar com ---)');
    return { proposal: null, errors };
  }
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = Bun.YAML.parse(match[1]!);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('o frontmatter não é um objeto');
    data = parsed as Record<string, unknown>;
  } catch (error) {
    err(`frontmatter YAML inválido: ${(error as Error).message}`);
    return { proposal: null, errors };
  }

  const id = String(data.id ?? '');
  if (id !== dir[1]) err(`id "${id}" difere do número da pasta (${dir[1]!}); escreva o id entre aspas: id: "${dir[1]!}"`);
  const title = nonEmpty(data.title);
  if (!title) err('title é obrigatório');
  const status = data.status;
  if (status !== 'proposed' && status !== 'applied') err('status deve ser proposed ou applied');
  const origin = data.origin;
  if (origin !== 'proposal-first' && origin !== 'code-first') err('origin deve ser proposal-first ou code-first');

  const deltaData = (data.delta ?? {}) as Record<string, unknown>;
  const delta: Delta = {
    added: stringList(deltaData.added, 'delta.added', err),
    modified: stringList(deltaData.modified, 'delta.modified', err),
    removed: stringList(deltaData.removed, 'delta.removed', err),
  };
  for (const [field, ids] of Object.entries(delta) as [string, string[]][]) {
    for (const elementId of ids) {
      if (!ELEMENT_ID.test(elementId)) err(`delta.${field}: ID inválido ${elementId} (esperado tipo:caminho, ex.: usecase:cancel_order)`);
    }
  }

  const acceptance: AcceptanceCriterion[] = [];
  const acceptanceData = data.acceptance ?? [];
  if (!Array.isArray(acceptanceData)) {
    err('acceptance deve ser uma lista');
  } else {
    const seen = new Set<string>();
    acceptanceData.forEach((item: unknown, index: number) => {
      const where = `acceptance[${index}]`;
      if (item === null || typeof item !== 'object') {
        err(`${where} deve ser um objeto`);
        return;
      }
      const c = item as Record<string, unknown>;
      const criterionId = String(c.id ?? '');
      if (!KEBAB.test(criterionId)) err(`${where}: id "${criterionId}" deve ser kebab-case`);
      else if (seen.has(criterionId)) err(`${where}: id "${criterionId}" repetido`);
      seen.add(criterionId);
      const manual = c.manual === true;
      const covered = stringList(c.covers, `${where}.covers`, err);
      for (const elementId of covered) {
        if (!ELEMENT_ID.test(elementId)) err(`${where}.covers: ID inválido ${elementId}`);
      }
      const given = nonEmpty(c.given);
      const when = nonEmpty(c.when);
      const then = nonEmpty(c.then);
      if (!then) err(`${where}: then é obrigatório`);
      if (!manual) {
        if (covered.length === 0) err(`${where}: critério automático precisa de covers`);
        if (!given || !when) err(`${where}: critério automático precisa de given e when`);
      }
      acceptance.push({ id: criterionId, covers: covered, given, when, then: then ?? '', manual });
    });
  }

  if (errors.length > 0) return { proposal: null, errors };
  return {
    proposal: {
      id,
      slug: dir[2]!,
      title: title!,
      status: status as Proposal['status'],
      origin: origin as Proposal['origin'],
      delta,
      acceptance,
      motivo: extractMotivo(match[2]!),
      path,
      archived,
      raw,
    },
    errors,
  };
}

export async function listProposals(
  changesAbs: string,
  changesRel: string,
): Promise<{ proposals: Proposal[]; errors: CompileError[] }> {
  const proposals: Proposal[] = [];
  const errors: CompileError[] = [];
  const scan = async (dirAbs: string, dirRel: string, archived: boolean): Promise<void> => {
    let names: string[];
    try {
      names = (await readdir(dirAbs, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name !== 'archive')
        .map((entry) => entry.name)
        .sort();
    } catch {
      return;
    }
    for (const name of names) {
      const raw = await readFile(join(dirAbs, name, 'proposal.md'), 'utf8').catch(() => null);
      if (raw === null) {
        errors.push({ message: 'proposal.md ausente', source: `${dirRel}/${name}` });
        continue;
      }
      const parsed = parseProposal(raw, name, `${dirRel}/${name}/proposal.md`, archived);
      errors.push(...parsed.errors);
      if (parsed.proposal) proposals.push(parsed.proposal);
    }
  };
  await scan(changesAbs, changesRel, false);
  await scan(join(changesAbs, 'archive'), `${changesRel}/archive`, true);
  const byNumber = new Map<string, string>();
  for (const proposal of proposals) {
    const previous = byNumber.get(proposal.id);
    if (previous) errors.push({ message: `número ${proposal.id} repetido (também em ${previous})`, source: proposal.path });
    else byNumber.set(proposal.id, proposal.path);
  }
  return { proposals, errors };
}

export function nextChangeId(proposals: readonly Pick<Proposal, 'id'>[]): string {
  const max = proposals.reduce((current, proposal) => Math.max(current, Number(proposal.id)), 0);
  return String(max + 1).padStart(4, '0');
}

export function renderDraft(input: { readonly id: string; readonly slug: string; readonly delta: Delta }): string {
  const list = (ids: readonly string[]): string =>
    ids.length === 0 ? ' []' : `\n${ids.map((id) => `    - ${JSON.stringify(id)}`).join('\n')}`;
  return [
    '---',
    `id: ${JSON.stringify(input.id)}`,
    `title: ${JSON.stringify(input.slug.replaceAll('-', ' '))}`,
    'status: proposed',
    'origin: code-first',
    'delta:',
    `  added:${list(input.delta.added)}`,
    `  modified:${list(input.delta.modified)}`,
    `  removed:${list(input.delta.removed)}`,
    'acceptance: []',
    '---',
    '',
    '## Motivo',
    '',
    MOTIVO_PLACEHOLDER,
    '',
  ].join('\n');
}

export function markApplied(raw: string): string {
  return raw.replace(/^status:\s*proposed\s*$/m, 'status: applied');
}
```

In `src/compiler/index.ts`, add:

```ts
export {
  ELEMENT_ID,
  MOTIVO_PLACEHOLDER,
  listProposals,
  parseProposal,
  type AcceptanceCriterion,
  type Delta,
  type Proposal,
} from './changes/proposal';
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bun test src/compiler/changes && bun run typecheck && bun run lint`
Expected: `12 pass`; zero warnings. Se a mensagem de YAML inválido do `Bun.YAML` vier diferente, o teste só exige o prefixo `frontmatter YAML inválido:`.

- [ ] **Step 5: Commit**

```bash
git add src/compiler/changes src/compiler/index.ts
git commit -m "feat(compiler): lê, valida e rascunha propostas de change"
```

---

### Task 6: Reconciliação (decisão pura)

**Files:**
- Create: `src/compiler/changes/reconcile.ts`
- Modify: `src/compiler/index.ts`
- Test: `src/compiler/changes/reconcile.test.ts`

**Interfaces:**
- Consumes: `semanticDiff`, `EMPTY_IR`, `DiffItem` (Task 3); `DomainLock`, `LockChange` (Task 4); `Proposal`, `markApplied`, `summarize`, `parseProposal`, `renderDraft` (Task 5); `sha256`.
- Produces:
  - `interface ReconcileInput { ir: IR; lock: DomainLock | null; proposals: readonly Proposal[]; changesDir: string }`
  - `interface ReconcilePlan { diff: DiffItem[]; nextLock: DomainLock | null; apply: Proposal | null; archivedPath: string | null; pending: string[]; errors: CompileError[] }`
  - `archivedPathOf(proposal, changesDir): string` → `<changesDir>/archive/NNNN-slug/proposal.md`
  - `deltaProblems(proposal, diff): string[]` (reaproveitado pelo `verify` na Task 10)
  - `reconcile(input): ReconcilePlan`

Regras (spec §7.3): `errors` = problemas duros (proposta arquivada sem registro ou editada, status incoerente com a pasta, mais de uma proposta aberta) — com eles nada é decidido. `pending` = situações em que o `--check` falha mas o `write` segue (diff sem proposta, proposta divergente, Motivo vazio, proposta aberta sem código). O lock só muda quando a proposta aberta bate com o diff não-`docs` (e então ela é aplicada) ou quando o diff é só `docs`.

- [ ] **Step 1: Escrever o teste que falha**

Create `src/compiler/changes/reconcile.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from '../__fixtures__/shop';
import { analyze } from '../analyze';
import { sha256 } from '../canonical';
import { semanticDiff, EMPTY_IR } from '../diff';
import type { DomainLock } from '../lock';
import { markApplied, parseProposal, renderDraft, type Delta, type Proposal } from './proposal';
import { reconcile } from './reconcile';

const ROOT = resolve(import.meta.dir, '../../..');
const ir = analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] }).ir;
const allAdded: Delta = { added: semanticDiff(EMPTY_IR, ir).map((i) => i.id), modified: [], removed: [] };

function proposal(options: { id?: string; delta?: Delta; motivo?: string; archived?: boolean; applied?: boolean } = {}): Proposal {
  const id = options.id ?? '0001';
  const slug = 'estado-inicial';
  let raw = renderDraft({ id, slug, delta: options.delta ?? allAdded });
  if (options.motivo !== undefined) raw = raw.replace(/<!--[\s\S]*?-->/, options.motivo);
  if (options.applied) raw = markApplied(raw);
  const base = options.archived ? `changes/archive/${id}-${slug}` : `changes/${id}-${slug}`;
  return parseProposal(raw, `${id}-${slug}`, `${base}/proposal.md`, options.archived ?? false).proposal!;
}

const input = (lock: DomainLock | null, proposals: Proposal[], current = ir) => ({ ir: current, lock, proposals, changesDir: 'changes' });

describe('reconcile', () => {
  test('sem lock e sem proposta: nada é aplicado e fica pendente', () => {
    const plan = reconcile(input(null, []));
    expect(plan.nextLock).toBeNull();
    expect(plan.apply).toBeNull();
    expect(plan.errors).toEqual([]);
    expect(plan.pending).toEqual([
      'há 10 mudança(s) de domínio sem proposta; escreva changes/NNNN-<slug>/proposal.md ou rode `bun run agentic compile --draft-change <slug>`',
    ]);
  });

  test('proposta que bate com o diff é aplicada e entra no lock', () => {
    const open = proposal({ motivo: 'Base do histórico.\n\nDetalhe.' });
    const plan = reconcile(input(null, [open]));
    expect(plan.pending).toEqual([]);
    expect(plan.apply?.id).toBe('0001');
    expect(plan.archivedPath).toBe('changes/archive/0001-estado-inicial/proposal.md');
    expect(plan.nextLock?.ir).toEqual(ir);
    expect(plan.nextLock?.changes).toEqual([
      {
        id: '0001',
        title: 'estado inicial',
        path: 'changes/archive/0001-estado-inicial/proposal.md',
        summary: 'Base do histórico.',
        hash: sha256(markApplied(open.raw)),
        items: semanticDiff(EMPTY_IR, ir),
      },
    ]);
  });

  test('Motivo vazio e divergências de delta ficam pendentes', () => {
    const delta: Delta = { added: [...allAdded.added.filter((id) => id !== 'entity:Product'), 'entity:Fantasma'], modified: [], removed: [] };
    const plan = reconcile(input(null, [proposal({ delta })]));
    expect(plan.apply).toBeNull();
    expect(plan.nextLock).toBeNull();
    expect(plan.pending).toEqual([
      'proposta 0001: mudança no código fora do delta: added entity:Product',
      'proposta 0001: ID no delta sem mudança correspondente no código: added entity:Fantasma',
      'proposta 0001: a seção ## Motivo está vazia',
    ]);
  });

  test('diff só de docs atualiza o lock sem proposta', () => {
    const applied = proposal({ motivo: 'Base.', archived: true, applied: true });
    const lock: DomainLock = {
      lockVersion: 1,
      ir,
      changes: [{ id: '0001', title: 'estado inicial', path: applied.path, summary: 'Base.', hash: sha256(applied.raw), items: [] }],
    };
    const current = JSON.parse(JSON.stringify(ir));
    current.useCases[0].description = 'Descrição nova.';
    const plan = reconcile(input(lock, [applied], current));
    expect(plan.errors).toEqual([]);
    expect(plan.pending).toEqual([]);
    expect(plan.apply).toBeNull();
    expect(plan.nextLock).toEqual({ lockVersion: 1, ir: current, changes: lock.changes });
  });

  test('proposta aberta sem mudança no código fica pendente', () => {
    const applied = proposal({ motivo: 'Base.', archived: true, applied: true });
    const lock: DomainLock = {
      lockVersion: 1,
      ir,
      changes: [{ id: '0001', title: 'estado inicial', path: applied.path, summary: 'Base.', hash: sha256(applied.raw), items: [] }],
    };
    const open = proposal({ id: '0002', delta: { added: ['invariant:Product/nova'], modified: [], removed: [] }, motivo: 'X.' });
    const plan = reconcile(input(lock, [applied, open]));
    expect(plan.pending).toEqual(['a proposta 0002 está aberta, mas o código ainda não tem as mudanças de domínio do delta']);
    expect(plan.nextLock).toEqual(lock);
  });

  test('proposta arquivada editada, ausente ou não registrada é erro duro', () => {
    const applied = proposal({ motivo: 'Base.', archived: true, applied: true });
    const lock: DomainLock = {
      lockVersion: 1,
      ir,
      changes: [{ id: '0001', title: 'estado inicial', path: applied.path, summary: 'Base.', hash: 'outro-hash', items: [] }],
    };
    expect(reconcile(input(lock, [applied])).errors.map((e) => e.message)).toEqual([
      'a proposta aplicada 0001 foi editada depois de aplicada; propostas arquivadas são imutáveis (restaure-a pelo git e abra uma nova proposta)',
    ]);
    expect(reconcile(input(lock, [])).errors.map((e) => e.message)).toEqual([
      'a proposta aplicada 0001 não está em changes/archive',
    ]);
    expect(reconcile(input(null, [applied])).errors.map((e) => e.message)).toEqual([
      'a proposta arquivada 0001 não está registrada no lock',
    ]);
  });

  test('duas propostas abertas e status incoerente são erro duro', () => {
    const plan = reconcile(input(null, [proposal({ id: '0001' }), proposal({ id: '0002' })]));
    expect(plan.errors.map((e) => e.message)).toEqual(['há 2 propostas abertas (0001, 0002); o v0 aceita uma por vez']);
    expect(reconcile(input(null, [proposal({ applied: true })])).errors.map((e) => e.message)).toEqual([
      'proposta com status applied fora de archive',
    ]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test src/compiler/changes/reconcile.test.ts`
Expected: FAIL — `./reconcile` não encontrado.

- [ ] **Step 3: Implementar**

`src/compiler/changes/reconcile.ts`:

```ts
import { sha256 } from '../canonical';
import { EMPTY_IR, semanticDiff, type DiffItem } from '../diff';
import type { CompileError, IR } from '../ir';
import type { DomainLock, LockChange } from '../lock';
import { markApplied, summarize, type Proposal } from './proposal';

export interface ReconcileInput {
  readonly ir: IR;
  readonly lock: DomainLock | null;
  readonly proposals: readonly Proposal[];
  readonly changesDir: string;
}

export interface ReconcilePlan {
  readonly diff: DiffItem[];
  readonly nextLock: DomainLock | null;
  readonly apply: Proposal | null;
  readonly archivedPath: string | null;
  readonly pending: string[];
  readonly errors: CompileError[];
}

const entry = (kind: string, id: string): string => `${kind} ${id}`;

export function archivedPathOf(proposal: Proposal, changesDir: string): string {
  return `${changesDir}/archive/${proposal.id}-${proposal.slug}/proposal.md`;
}

export function deltaProblems(proposal: Proposal, diff: readonly DiffItem[]): string[] {
  const declared = new Set([
    ...proposal.delta.added.map((id) => entry('added', id)),
    ...proposal.delta.modified.map((id) => entry('modified', id)),
    ...proposal.delta.removed.map((id) => entry('removed', id)),
  ]);
  const actual = new Set(diff.map((item) => entry(item.kind, item.id)));
  const problems: string[] = [];
  for (const item of diff) {
    if (item.classification !== 'docs' && !declared.has(entry(item.kind, item.id))) {
      problems.push(`mudança no código fora do delta: ${item.kind} ${item.id}`);
    }
  }
  for (const declaredEntry of [...declared].sort()) {
    if (!actual.has(declaredEntry)) problems.push(`ID no delta sem mudança correspondente no código: ${declaredEntry}`);
  }
  return problems;
}

export function reconcile(input: ReconcileInput): ReconcilePlan {
  const { lock, proposals } = input;
  const errors: CompileError[] = [];
  const pending: string[] = [];
  const recorded = lock?.changes ?? [];

  for (const change of recorded) {
    const archived = proposals.find((p) => p.archived && p.id === change.id);
    if (!archived) {
      errors.push({ message: `a proposta aplicada ${change.id} não está em ${input.changesDir}/archive`, source: change.path });
    } else if (sha256(archived.raw) !== change.hash) {
      errors.push({
        message: `a proposta aplicada ${change.id} foi editada depois de aplicada; propostas arquivadas são imutáveis (restaure-a pelo git e abra uma nova proposta)`,
        source: archived.path,
      });
    }
  }
  for (const proposal of proposals) {
    if (proposal.archived && proposal.status !== 'applied') {
      errors.push({ message: `proposta em archive com status ${proposal.status}; deveria ser applied`, source: proposal.path });
    }
    if (!proposal.archived && proposal.status === 'applied') {
      errors.push({ message: 'proposta com status applied fora de archive', source: proposal.path });
    }
    if (proposal.archived && !recorded.some((change) => change.id === proposal.id)) {
      errors.push({ message: `a proposta arquivada ${proposal.id} não está registrada no lock`, source: proposal.path });
    }
  }
  const open = proposals.filter((p) => !p.archived && p.status === 'proposed');
  if (open.length > 1) {
    errors.push({ message: `há ${open.length} propostas abertas (${open.map((p) => p.id).join(', ')}); o v0 aceita uma por vez`, source: null });
  }

  const diff = semanticDiff(lock?.ir ?? EMPTY_IR, input.ir);
  const unchanged = (): ReconcilePlan => ({ diff, nextLock: lock, apply: null, archivedPath: null, pending, errors });
  if (errors.length > 0) return unchanged();

  const required = diff.filter((item) => item.classification !== 'docs');
  const proposal = open[0] ?? null;

  if (required.length === 0) {
    if (proposal) pending.push(`a proposta ${proposal.id} está aberta, mas o código ainda não tem as mudanças de domínio do delta`);
    const nextLock = lock === null && diff.length === 0 ? null : { lockVersion: 1 as const, ir: input.ir, changes: recorded };
    return { diff, nextLock, apply: null, archivedPath: null, pending, errors };
  }

  if (!proposal) {
    pending.push(
      `há ${required.length} mudança(s) de domínio sem proposta; escreva ${input.changesDir}/NNNN-<slug>/proposal.md ou rode \`bun run agentic compile --draft-change <slug>\``,
    );
    return unchanged();
  }

  const problems = deltaProblems(proposal, diff);
  if (proposal.motivo === '') problems.push('a seção ## Motivo está vazia');
  if (problems.length > 0) {
    pending.push(...problems.map((problem) => `proposta ${proposal.id}: ${problem}`));
    return unchanged();
  }

  const archivedPath = archivedPathOf(proposal, input.changesDir);
  const change: LockChange = {
    id: proposal.id,
    title: proposal.title,
    path: archivedPath,
    summary: summarize(proposal.motivo),
    hash: sha256(markApplied(proposal.raw)),
    items: diff,
  };
  return {
    diff,
    nextLock: { lockVersion: 1, ir: input.ir, changes: [...recorded, change] },
    apply: proposal,
    archivedPath,
    pending,
    errors,
  };
}
```

In `src/compiler/index.ts`, add:

```ts
export { archivedPathOf, deltaProblems, reconcile, type ReconcileInput, type ReconcilePlan } from './changes/reconcile';
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bun test src/compiler/changes && bun run typecheck && bun run lint`
Expected: `19 pass` (12 da Task 5 + 7); zero warnings.

- [ ] **Step 5: Commit**

```bash
git add src/compiler/changes src/compiler/index.ts
git commit -m "feat(compiler): reconciliação pura entre diff, lock e proposta aberta"
```

---

### Task 7: `history.md` e opções do `renderAll`

**Files:**
- Create: `src/compiler/render/history.ts`
- Modify: `src/compiler/render/dev-skill.ts`, `src/compiler/render/index.ts`
- Test: `src/compiler/render/history.test.ts`; Modify: `src/compiler/dev-skill.test.ts`, `src/compiler/render-all.test.ts` (listas de arquivos e snapshots)
- Regenerate: `.agents/skills/orders-dev/**`

**Interfaces:**
- Consumes: `IR`, `IRModule`, `LockChange` (Task 4), `GENERATED_HEADER`, `code`, `table`.
- Produces:
  - `renderHistory(ir: IR, module: IRModule, changes: readonly LockChange[], historyPath: string): string` — por entidade do módulo, os changes que tocaram a entidade, suas invariantes ou métodos; seção extra para eventos, use-cases e operators; link relativo para a proposta arquivada.
  - `renderDevSkill(ir, module, hash, options?: { history?: readonly LockChange[]; devSkillsDir?: string })` — passa a gerar também `references/history.md` e lista o link em "Referências".
  - `interface RenderOptions { history?: readonly LockChange[]; changesDir?: string }`; `renderAll(ir, out, options?: RenderOptions)`.

- [ ] **Step 1: Escrever o teste que falha**

Create `src/compiler/render/history.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { SHOP_MODULE, defineShop } from '../__fixtures__/shop';
import { analyze } from '../analyze';
import type { LockChange } from '../lock';
import { renderHistory } from './history';

const ROOT = resolve(import.meta.dir, '../../..');
const { ir } = analyze(defineShop(), { root: ROOT, modules: [SHOP_MODULE] });
const module = ir.modules[0]!;
const HISTORY = '.agents/skills/shop-dev/references/history.md';

const changes: LockChange[] = [
  {
    id: '0001',
    title: 'estado inicial',
    path: 'changes/archive/0001-estado-inicial/proposal.md',
    summary: 'Base do histórico.',
    hash: 'h1',
    items: [
      { id: 'entity:Product', kind: 'added', classification: 'behavioral', module: 'shop' },
      { id: 'usecase:publish_product', kind: 'added', classification: 'behavioral', module: 'shop' },
    ],
  },
  {
    id: '0002',
    title: 'Publicação exige estoque',
    path: 'changes/archive/0002-publicacao-exige-estoque/proposal.md',
    summary: 'Evitar vender sem estoque.',
    hash: 'h2',
    items: [
      { id: 'invariant:Product/publicacao-exige-estoque', kind: 'added', classification: 'behavioral', module: 'shop' },
      { id: 'entity:Outro', kind: 'added', classification: 'behavioral', module: 'outro' },
    ],
  },
];

describe('renderHistory', () => {
  test('sem changes', () => {
    expect(renderHistory(ir, module, [], HISTORY)).toContain('_Nenhuma mudança registrada._');
  });

  test('agrupa por entidade, ignora outros módulos e linka a proposta arquivada', () => {
    const text = renderHistory(ir, module, changes, HISTORY);
    expect(text).toContain('# Histórico do módulo `shop`');
    expect(text).toContain(
      '| [0001](../../../../changes/archive/0001-estado-inicial/proposal.md) | estado inicial | added `entity:Product` (behavioral) | Base do histórico. |',
    );
    expect(text).toContain(
      '| [0002](../../../../changes/archive/0002-publicacao-exige-estoque/proposal.md) | Publicação exige estoque | added `invariant:Product/publicacao-exige-estoque` (behavioral) | Evitar vender sem estoque. |',
    );
    expect(text).toContain('## Eventos, use-cases e operators');
    expect(text).toContain('added `usecase:publish_product` (behavioral)');
    expect(text).not.toContain('entity:Outro');
    expect(text).toMatchSnapshot();
  });
});
```

Update `src/compiler/dev-skill.test.ts`: the test `'gera SKILL.md e references'` passa a esperar `['SKILL.md', 'references/history.md', 'references/schemas.json', 'references/state-machine.md']`, e acrescente no `describe`:

```ts
  test('lista o histórico de mudanças nas referências', () => {
    expect(skill).toContain('- [Histórico de mudanças](references/history.md)');
  });
```

Update `src/compiler/render-all.test.ts`: o primeiro teste passa a esperar também `'.agents/skills/shop-dev/references/history.md'` na lista (logo depois de `'.agents/skills/shop-dev/SKILL.md'`).

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test src/compiler/render src/compiler/dev-skill.test.ts src/compiler/render-all.test.ts`
Expected: FAIL — `./history` não encontrado; listas de arquivos sem `history.md`.

- [ ] **Step 3: Implementar**

`src/compiler/render/history.ts`:

```ts
import { posix } from 'node:path';
import type { DiffItem } from '../diff';
import type { IR, IRModule } from '../ir';
import type { LockChange } from '../lock';
import { GENERATED_HEADER } from './frontmatter';
import { code, table } from './markdown';

const HEADERS = ['Change', 'Título', 'Mudanças', 'Motivo'];

function entityOf(id: string): string | null {
  const match = /^(?:entity:([^/.]+)$|invariant:([^/]+)\/|method:([^.]+)\.)/.exec(id);
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}

export function renderHistory(ir: IR, module: IRModule, changes: readonly LockChange[], historyPath: string): string {
  const lines = [GENERATED_HEADER(module.path), '', `# Histórico do módulo ${code(module.name)}`, ''];
  const relevant = changes
    .map((change) => ({ change, items: change.items.filter((item) => item.module === module.name) }))
    .filter((entry) => entry.items.length > 0);
  if (relevant.length === 0) {
    lines.push('_Nenhuma mudança registrada._', '');
    return lines.join('\n');
  }
  const link = (change: LockChange): string =>
    `[${change.id}](${posix.relative(posix.dirname(historyPath), change.path)})`;
  const rowsFor = (predicate: (item: DiffItem) => boolean): string[][] =>
    relevant
      .map(({ change, items }) => ({ change, items: items.filter(predicate) }))
      .filter((entry) => entry.items.length > 0)
      .map(({ change, items }) => [
        link(change),
        change.title,
        items.map((item) => `${item.kind} ${code(item.id)} (${item.classification})`).join('; '),
        change.summary || '—',
      ]);

  const entities = [
    ...new Set([
      ...ir.entities.filter((entity) => entity.module === module.name).map((entity) => entity.name),
      ...relevant.flatMap(({ items }) => items.map((item) => entityOf(item.id)).filter((name): name is string => name !== null)),
    ]),
  ].sort();
  for (const name of entities) {
    const rows = rowsFor((item) => entityOf(item.id) === name);
    lines.push(`## ${name}`, '', rows.length > 0 ? table(HEADERS, rows) : '_Nenhuma mudança registrada._', '');
  }
  const others = rowsFor((item) => entityOf(item.id) === null);
  if (others.length > 0) lines.push('## Eventos, use-cases e operators', '', table(HEADERS, others), '');
  return lines.join('\n');
}
```

In `src/compiler/render/dev-skill.ts`:
1. Add imports: `import type { LockChange } from '../lock';` and `import { renderHistory } from './history';`.
2. Change the signature to:

```ts
export function renderDevSkill(
  ir: IR,
  module: IRModule,
  hash: string,
  options: { readonly history?: readonly LockChange[]; readonly devSkillsDir?: string } = {},
): Map<string, string> {
```

3. In the "Referências" list, add the line `'- [Histórico de mudanças](references/history.md)',` right after `'## Referências', '',`.
4. Return the map with the history entry in sorted position:

```ts
  const historyPath = `${options.devSkillsDir ?? '.agents/skills'}/${module.name}-dev/references/history.md`;
  return new Map([
    ['SKILL.md', lines.join('\n')],
    ['references/history.md', renderHistory(ir, module, options.history ?? [], historyPath)],
    ['references/schemas.json', stableStringify(schemas)],
    ['references/state-machine.md', renderStateMachine(entities, module.path)],
  ]);
```

In `src/compiler/render/index.ts`, add `import type { LockChange } from '../lock';`, export the options type and pass them down:

```ts
export interface RenderOptions {
  readonly history?: readonly LockChange[];
  readonly changesDir?: string;
}

export function renderAll(ir: IR, out: OutputPaths, options: RenderOptions = {}): Rendered {
  const hash = irHash(ir);
  const entries: [string, string][] = [];
  for (const module of ir.modules) {
    for (const [rel, content] of renderDevSkill(ir, module, hash, { history: options.history, devSkillsDir: out.devSkills })) {
      entries.push([`${out.devSkills}/${module.name}-dev/${rel}`, content]);
    }
  }
  for (const operator of ir.operators) {
    for (const [rel, content] of renderRuntimeSkill(ir, operator, hash)) {
      entries.push([`${out.runtimeSkills}/${operator.name}/${rel}`, content]);
    }
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    files: new Map(entries),
    agentsBlock: renderAgentsBlock(ir, { ...out, changesDir: options.changesDir ?? 'changes' }),
    devSkillDirs: ir.modules.map((m) => `${m.name}-dev`),
    runtimeSkillDirs: ir.operators.map((o) => o.name),
  };
}
```

In `src/compiler/render/agents-md.ts`, add the optional field `readonly changesDir?: string;` to `AgentsPaths` (it is used in Task 11; nothing else changes now).

Export in `src/compiler/index.ts`: change the render line to `export { DEFAULT_OUT, renderAll, type OutputPaths, type RenderOptions, type Rendered } from './render/index';`.

- [ ] **Step 4: Rodar, atualizar snapshots e regenerar o repositório**

```bash
bun test src/compiler --update-snapshots
bun test && bun run typecheck && bun run lint
bun run agentic compile
bun run agentic compile --check
```

Expected: tudo verde; o `compile` gera `.agents/skills/orders-dev/references/history.md` ("_Nenhuma mudança registrada._", porque o lock só entra na Task 8) e o link no SKILL.md de dev; `--check` em dia. Conferir no diff dos snapshots que só mudaram o link e o arquivo novo.

- [ ] **Step 5: Commit**

```bash
git add src/compiler .agents/skills
git commit -m "feat(compiler): gera history.md por módulo a partir dos changes aplicados"
```

---

### Task 8: Reconciliação no `compile`, `--draft-change` e o change 0001 do exemplo

**Files:**
- Create: `src/compiler/changes/draft.ts`, `src/compiler/changes/apply.ts`, `test/helpers/bootstrap.ts`
- Modify: `src/compiler/config.ts`, `src/compiler/render/index.ts` (`DEFAULT_OUT.lock`), `src/compiler/compile.ts`, `src/cli/commands/compile.ts`, `src/cli/usage.ts`, `src/compiler/index.ts`, `src/compiler/compile.test.ts`, `src/cli/cli.test.ts`, `src/compiler/config.test.ts` (se fixar `ResolvedConfig` inteiro)
- Create (repositório): `changes/archive/0001-estado-inicial/proposal.md`, `.agentic/domain.lock.json`; Regenerate: `.agents/skills/orders-dev/references/history.md`

**Interfaces:**
- Consumes: Tasks 3–7; `analyzeProject` (Task 1).
- Produces:
  - `OutputPaths.lock` (padrão `.agentic/domain.lock.json`); `AgenticConfig.changes?: string` (padrão `changes`); `ResolvedConfig.changesDir: string` (POSIX, relativo ao `outRoot`).
  - `writeDraft(config, ir, lock, proposals, slug): Promise<{ path: string; proposal: Proposal }>` (lança `Error` em pt-BR: slug inválido, proposta já aberta, nada para propor).
  - `archiveProposal(config, proposal, archivedPath): Promise<void>` (move a pasta para `archive/` e grava `status: applied`).
  - `CompileOptions.draftChange?: string`; `CompileResult` ganha `diff: DiffItem[]`, `pending: string[]`, `applied: string | null`, `drafted: string | null`.
  - CLI: `compile --draft-change <slug>`; linhas `pendente: <msg>` em stderr (em `--check`, pendência ⇒ exit 1); mensagens `proposta criada em …` e `proposta NNNN aplicada e arquivada`.
  - `test/helpers/bootstrap.ts`: `bootstrapChanges(out, configPath?)` — cria e aplica o change `0001` num `outRoot` temporário (usado pelos testes que precisam de `--check` limpo).

- [ ] **Step 1: Escrever o helper e os testes que falham**

Create `test/helpers/bootstrap.ts`:

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { MOTIVO_PLACEHOLDER, compile } from '@agentic-ddd/compiler';

export const ROOT_CONFIG = resolve(import.meta.dir, '../../agentic.config.ts');

export async function bootstrapChanges(out: string, configPath = ROOT_CONFIG): Promise<void> {
  const draft = await compile({ configPath, outRoot: out, mode: 'write', draftChange: 'estado-inicial' });
  if (!draft.drafted) throw new Error('bootstrapChanges: o rascunho não foi criado');
  const path = join(out, draft.drafted);
  await writeFile(path, (await readFile(path, 'utf8')).replace(MOTIVO_PLACEHOLDER, 'Estado inicial do domínio.'));
  const applied = await compile({ configPath, outRoot: out, mode: 'write' });
  if (applied.applied !== '0001') throw new Error(`bootstrapChanges: 0001 não foi aplicada (${applied.pending.join('; ')})`);
}
```

In `src/compiler/compile.test.ts`:
1. Add imports: `import { access, readFile } from 'node:fs/promises';` (merge with the existing import) and `import { bootstrapChanges } from '../../test/helpers/bootstrap';`.
2. In the test `'é idempotente e o check passa depois de escrever'`, add `await bootstrapChanges(out);` as the first line.
3. Append these tests inside the `describe`:

```ts
  test('sem lock e sem proposta: write segue com pendência; check falha', async () => {
    const write = await compile({ configPath, outRoot: out, mode: 'write' });
    expect(write.ok).toBe(true);
    expect(write.pending[0]).toContain('mudança(s) de domínio sem proposta');
    const check = await compile({ configPath, outRoot: out, mode: 'check' });
    expect(check.ok).toBe(false);
    expect(check.pending[0]).toContain('--draft-change');
  });

  test('--draft-change cria a proposta; sem Motivo ela não é aplicada', async () => {
    const draft = await compile({ configPath, outRoot: out, mode: 'write', draftChange: 'estado-inicial' });
    expect(draft.drafted).toBe('changes/0001-estado-inicial/proposal.md');
    expect(draft.pending).toEqual(['proposta 0001: a seção ## Motivo está vazia']);
    expect(draft.applied).toBeNull();
    const raw = await readFile(join(out, draft.drafted!), 'utf8');
    expect(raw).toContain('origin: code-first');
    expect(raw).toContain('    - "usecase:cancel_order"');
  });

  test('proposta com Motivo é aplicada: arquivo arquivado, lock e histórico', async () => {
    await bootstrapChanges(out);
    const archived = await readFile(join(out, 'changes/archive/0001-estado-inicial/proposal.md'), 'utf8');
    expect(archived).toContain('status: applied');
    await expect(access(join(out, 'changes/0001-estado-inicial'))).rejects.toThrow();
    const lock = JSON.parse(await readFile(join(out, '.agentic/domain.lock.json'), 'utf8')) as {
      changes: { id: string; path: string; summary: string }[];
    };
    expect(lock.changes.map((c) => [c.id, c.path, c.summary])).toEqual([
      ['0001', 'changes/archive/0001-estado-inicial/proposal.md', 'Estado inicial do domínio.'],
    ]);
    const history = await readFile(join(out, '.agents/skills/orders-dev/references/history.md'), 'utf8');
    expect(history).toContain('[0001](../../../../changes/archive/0001-estado-inicial/proposal.md)');
    const check = await compile({ configPath, outRoot: out, mode: 'check' });
    expect(check.pending).toEqual([]);
    expect(check.drift).toEqual([]);
    expect(check.ok).toBe(true);
  });

  test('diff só de docs atualiza o lock sem proposta', async () => {
    await bootstrapChanges(out);
    const lockPath = join(out, '.agentic/domain.lock.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    lock.ir.useCases[0].description = 'Descrição antiga.';
    await writeFile(lockPath, JSON.stringify(lock));
    const write = await compile({ configPath, outRoot: out, mode: 'write' });
    expect(write.pending).toEqual([]);
    expect(write.diff.map((i) => i.classification)).toEqual(['docs']);
    expect((await compile({ configPath, outRoot: out, mode: 'check' })).ok).toBe(true);
  });

  test('proposta arquivada editada à mão quebra o write e o check', async () => {
    await bootstrapChanges(out);
    const path = join(out, 'changes/archive/0001-estado-inicial/proposal.md');
    await writeFile(path, `${await readFile(path, 'utf8')}\nEditado.\n`);
    for (const mode of ['write', 'check'] as const) {
      const result = await compile({ configPath, outRoot: out, mode });
      expect(result.ok).toBe(false);
      expect(result.errors[0]!.message).toContain('propostas arquivadas são imutáveis');
    }
  });

  test('--draft-change sem mudança ou com proposta aberta é recusado', async () => {
    await bootstrapChanges(out);
    await expect(compile({ configPath, outRoot: out, mode: 'write', draftChange: 'nada' })).rejects.toThrow(
      'não há mudança de domínio para propor',
    );
    const otherOut = await mkdtemp(join(tmpdir(), 'agentic-compile-'));
    try {
      await compile({ configPath, outRoot: otherOut, mode: 'write', draftChange: 'a' });
      await expect(compile({ configPath, outRoot: otherOut, mode: 'write', draftChange: 'b' })).rejects.toThrow(
        'já existe uma proposta aberta',
      );
    } finally {
      await rm(otherOut, { recursive: true, force: true });
    }
    await expect(compile({ configPath, outRoot: out, mode: 'write', draftChange: 'Slug Ruim' })).rejects.toThrow(
      '--draft-change: o slug "Slug Ruim" deve ser kebab-case',
    );
  });
```

In `src/cli/cli.test.ts`:
1. Add `import { bootstrapChanges } from '../../test/helpers/bootstrap';`.
2. In `'escreve e depois --check sai com 0'`, `'--check com diretório real no lugar do link do espelho dá dica de remover/renomear'` and `'--check com link do espelho ausente manda rodar o compile'`, make each test `async` (if it is not) and call `await bootstrapChanges(out);` before the first `run(...)` — assim esses testes não dependem do texto da pendência "mudança sem proposta".
3. Append:

```ts
  test('--check com mudança sem proposta imprime pendente e sai com 1', () => {
    run('compile', '--out-root', out);
    const check = run('compile', '--check', '--out-root', out);
    expect(check.code).toBe(1);
    expect(check.stderr).toContain('pendente: há ');
    expect(check.stderr).toContain('--draft-change <slug>');
  });

  test('--draft-change pelo CLI cria a proposta e orienta o próximo passo', () => {
    const result = run('compile', '--draft-change', 'estado-inicial', '--out-root', out);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('proposta criada em changes/0001-estado-inicial/proposal.md');
    expect(result.stderr).toContain('pendente: proposta 0001: a seção ## Motivo está vazia');
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test src/compiler/compile.test.ts src/cli`
Expected: FAIL — `draftChange`/`pending`/`MOTIVO_PLACEHOLDER` inexistentes no fluxo do `compile`.

- [ ] **Step 3: Config e caminhos**

In `src/compiler/render/index.ts`, add `readonly lock: string;` to `OutputPaths` and `lock: '.agentic/domain.lock.json',` to `DEFAULT_OUT`.

In `src/compiler/config.ts`:
- `AgenticConfig`: add `readonly changes?: string;`
- `ResolvedConfig`: add `readonly changesDir: string;`
- In `resolveConfig`, add to the returned object: `changesDir: toPosix(config.changes ?? 'changes').replace(/^\.\//, '').replace(/\/+$/, ''),`

If `src/compiler/config.test.ts` compares a whole `ResolvedConfig`, add `changesDir: 'changes'` and the `lock` path to the expected object.

- [ ] **Step 4: Rascunho e arquivamento**

`src/compiler/changes/draft.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResolvedConfig } from '../config';
import { EMPTY_IR, semanticDiff } from '../diff';
import type { IR } from '../ir';
import type { DomainLock } from '../lock';
import { nextChangeId, parseProposal, renderDraft, type Proposal } from './proposal';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function writeDraft(
  config: ResolvedConfig,
  ir: IR,
  lock: DomainLock | null,
  proposals: readonly Proposal[],
  slug: string,
): Promise<{ path: string; proposal: Proposal }> {
  if (!SLUG.test(slug)) throw new Error(`--draft-change: o slug "${slug}" deve ser kebab-case`);
  if (proposals.some((p) => !p.archived)) {
    throw new Error(`já existe uma proposta aberta em ${config.changesDir}/; aplique-a ou remova-a antes de criar outra`);
  }
  const required = semanticDiff(lock?.ir ?? EMPTY_IR, ir).filter((item) => item.classification !== 'docs');
  if (required.length === 0) throw new Error('não há mudança de domínio para propor');
  const id = nextChangeId(proposals);
  const pick = (kind: string): string[] => required.filter((item) => item.kind === kind).map((item) => item.id);
  const raw = renderDraft({ id, slug, delta: { added: pick('added'), modified: pick('modified'), removed: pick('removed') } });
  const dirName = `${id}-${slug}`;
  const path = `${config.changesDir}/${dirName}/proposal.md`;
  await mkdir(join(config.outRoot, config.changesDir, dirName), { recursive: true });
  await writeFile(join(config.outRoot, path), raw);
  return { path, proposal: parseProposal(raw, dirName, path, false).proposal! };
}
```

`src/compiler/changes/apply.ts`:

```ts
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ResolvedConfig } from '../config';
import { markApplied, type Proposal } from './proposal';

export async function archiveProposal(config: ResolvedConfig, proposal: Proposal, archivedPath: string): Promise<void> {
  const from = join(config.outRoot, dirname(proposal.path));
  const to = join(config.outRoot, dirname(archivedPath));
  await mkdir(dirname(to), { recursive: true });
  await rename(from, to);
  await writeFile(join(config.outRoot, archivedPath), markApplied(proposal.raw));
}
```

- [ ] **Step 5: Reescrever o `compile`**

Replace `src/compiler/compile.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { defaultRegistry, type Registry } from '@agentic-ddd/decorators';
import { analyze } from './analyze';
import { archiveProposal } from './changes/apply';
import { writeDraft } from './changes/draft';
import { listProposals } from './changes/proposal';
import { reconcile } from './changes/reconcile';
import { loadConfig, type ResolvedConfig } from './config';
import type { DiffItem } from './diff';
import type { CompileError, IR } from './ir';
import { lintRendered, type LintFinding } from './lint';
import { importModules } from './load';
import { readLock, serializeLock } from './lock';
import { renderAll, type Rendered } from './render/index';
import { checkOutputs, writeOutputs, type Drift } from './write';

export interface CompileOptions {
  readonly configPath: string;
  readonly outRoot?: string;
  readonly mode: 'write' | 'check';
  readonly registry?: Registry;
  readonly draftChange?: string;
}

export interface CompileResult {
  readonly ok: boolean;
  readonly errors: CompileError[];
  readonly drift: Drift[];
  readonly written: string[];
  readonly warnings: string[];
  readonly lint: LintFinding[];
  readonly ir: IR | null;
  readonly rendered: Rendered | null;
  readonly config: ResolvedConfig;
  readonly diff: DiffItem[];
  readonly pending: string[];
  readonly applied: string | null;
  readonly drafted: string | null;
}

export interface ProjectAnalysis {
  readonly config: ResolvedConfig;
  readonly ir: IR;
  readonly errors: CompileError[];
}

export async function analyzeProject(options: {
  readonly configPath: string;
  readonly outRoot?: string;
  readonly registry?: Registry;
}): Promise<ProjectAnalysis> {
  const config = await loadConfig(options.configPath, { outRoot: options.outRoot });
  await importModules(config);
  const { ir, errors } = analyze(options.registry ?? defaultRegistry, { root: config.root, modules: config.modules });
  return { config, ir, errors };
}

async function claudeWarnings(config: ResolvedConfig): Promise<string[]> {
  const content = await readFile(join(config.outRoot, config.out.claudeMd), 'utf8').catch(() => null);
  return content !== null && !content.includes('@AGENTS.md') ? [`${config.out.claudeMd} existe mas não contém @AGENTS.md`] : [];
}

const byPath = (a: Drift, b: Drift): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export async function compile(options: CompileOptions): Promise<CompileResult> {
  const { config, ir, errors } = await analyzeProject(options);
  const empty = {
    drift: [],
    written: [],
    warnings: [],
    lint: [],
    rendered: null,
    config,
    ir,
    diff: [],
    pending: [],
    applied: null,
    drafted: null,
  };
  if (errors.length > 0) return { ...empty, ok: false, errors };

  const lockAbs = join(config.outRoot, config.out.lock);
  const lock = await readLock(lockAbs, config.out.lock);
  const listed = await listProposals(join(config.outRoot, config.changesDir), config.changesDir);
  if (listed.errors.length > 0) return { ...empty, ok: false, errors: listed.errors };
  let proposals = listed.proposals;

  let drafted: string | null = null;
  if (options.draftChange !== undefined) {
    if (options.mode !== 'write') throw new Error('--draft-change não pode ser usado com --check');
    const draft = await writeDraft(config, ir, lock, proposals, options.draftChange);
    drafted = draft.path;
    proposals = [...proposals, draft.proposal];
  }

  const plan = reconcile({ ir, lock, proposals, changesDir: config.changesDir });
  if (plan.errors.length > 0) return { ...empty, ok: false, errors: plan.errors, diff: plan.diff, drafted };

  const rendered = renderAll(ir, config.out, { history: plan.nextLock?.changes ?? [], changesDir: config.changesDir });
  const lint = lintRendered(rendered);
  const lintErrors: CompileError[] = lint
    .filter((f) => f.severity === 'error')
    .map((f) => ({ message: `lint: ${f.message}`, source: f.path }));
  const warnings = [
    ...(await claudeWarnings(config)),
    ...lint.filter((f) => f.severity === 'warning').map((f) => `${f.path}: ${f.message}`),
  ];
  const lockText = plan.nextLock ? serializeLock(plan.nextLock) : null;

  if (options.mode === 'check') {
    const drift = await checkOutputs(config, rendered);
    const current = await readFile(lockAbs, 'utf8').catch(() => null);
    if (lockText !== null && current !== lockText) {
      drift.push({ path: config.out.lock, reason: current === null ? 'missing' : 'changed' });
    }
    drift.sort(byPath);
    const pending = plan.apply
      ? [...plan.pending, `a proposta ${plan.apply.id} está pronta para ser aplicada; rode \`bun run agentic compile\``]
      : plan.pending;
    return {
      ...empty,
      ok: drift.length === 0 && lintErrors.length === 0 && pending.length === 0,
      errors: lintErrors,
      drift,
      warnings,
      lint,
      rendered,
      diff: plan.diff,
      pending,
    };
  }

  const result = await writeOutputs(config, rendered);
  const written = [...result.written];
  if (plan.apply && plan.archivedPath) {
    await archiveProposal(config, plan.apply, plan.archivedPath);
    written.push(plan.archivedPath);
  }
  if (lockText !== null) {
    await mkdir(dirname(lockAbs), { recursive: true });
    await writeFile(lockAbs, lockText);
    written.push(config.out.lock);
  }
  return {
    ...empty,
    ok: lintErrors.length === 0,
    errors: lintErrors,
    written,
    warnings: [...warnings, ...result.warnings],
    lint,
    rendered,
    diff: plan.diff,
    pending: plan.pending,
    applied: plan.apply?.id ?? null,
    drafted,
  };
}
```

In `src/compiler/index.ts`, add: `export { archiveProposal } from './changes/apply';` and `export { writeDraft } from './changes/draft';`.

- [ ] **Step 6: CLI**

In `src/cli/usage.ts`, the compile line becomes:
`'  agentic-ddd compile [--check] [--report] [--draft-change <slug>] [--config <arquivo>] [--out-root <dir>]',`

In `src/cli/commands/compile.ts`:
- `values: ['--config', '--out-root', '--draft-change'],`
- pass `draftChange: parsed.values.get('--draft-change'),` to `compile`;
- right after printing warnings, add:

```ts
  for (const item of result.pending) console.error(`pendente: ${item}`);
  if (result.drafted) {
    console.log(
      `agentic-ddd: proposta criada em ${result.drafted}; preencha o ## Motivo (e os critérios de aceite) e rode \`bun run agentic compile\``,
    );
  }
  if (result.applied) console.log(`agentic-ddd: proposta ${result.applied} aplicada e arquivada`);
```

- in the `!result.ok` branch nothing else changes; additionally, in `--check`, a non-empty `result.pending` already makes `result.ok` false.

- [ ] **Step 7: Rodar e ver passar**

Run: `bun test && bun run typecheck && bun run lint`
Expected: tudo verde; zero warnings. (O `--check` do próprio repositório ainda falha neste ponto — não há lock nem `changes/` — e é resolvido no próximo step.)

- [ ] **Step 8: Registrar o change 0001 do exemplo**

```bash
bun run agentic compile --draft-change estado-inicial
```

Expected: `proposta criada em changes/0001-estado-inicial/proposal.md` e `pendente: proposta 0001: a seção ## Motivo está vazia`.

Em `changes/0001-estado-inicial/proposal.md`, troque a linha do comentário `<!-- Escreva aqui por que esta mudança existe … -->` por:

```markdown
Registra o estado inicial do domínio `orders` — pedido com criação, confirmação e cancelamento, três use-cases e o `order-operator` — como base do histórico. A partir daqui, toda mudança de regra de negócio passa por uma proposta em `changes/`.
```

e troque `title: "estado inicial"` por `title: "Estado inicial do domínio orders"`. Então:

```bash
bun run agentic compile
bun run agentic compile --check
```

Expected: `proposta 0001 aplicada e arquivada`; o `--check` imprime `arquivos gerados estão em dia`; existem `changes/archive/0001-estado-inicial/proposal.md` (com `status: applied`) e `.agentic/domain.lock.json`; `history.md` de `orders-dev` lista o 0001.

- [ ] **Step 9: Commit**

```bash
git add src test changes .agentic .agents/skills
git commit -m "feat(compiler): reconcilia propostas no compile, adiciona --draft-change e registra o change 0001"
```

---
### Task 9: Execução da suíte com JUnit e mapeamento de `covers`

**Files:**
- Create: `src/compiler/verify/test-run.ts`
- Test: `src/compiler/verify/test-run.test.ts`

**Interfaces:**
- Consumes: `parseCovers` de `@agentic-ddd/testing` (plano 1).
- Produces:
  - `VERIFY_ENV = 'AGENTIC_DDD_VERIFY'`
  - `type TestStatus = 'passed' | 'failed' | 'skipped'`, `interface TestCaseResult { name: string; file: string; line: number; status: TestStatus; covers: string[] }`, `interface TestRun { exitCode: number; cases: TestCaseResult[] }`
  - `unescapeXml(text): string`, `parseJUnit(xml): TestCaseResult[]`, `runTests(command: readonly string[], cwd: string): Promise<TestRun>` — acrescenta `--reporter=junit --reporter-outfile=<tmp>` ao comando e roda com `AGENTIC_DDD_VERIFY=1` no ambiente.

- [ ] **Step 1: Escrever o teste que falha**

Create `src/compiler/verify/test-run.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseJUnit, runTests, unescapeXml } from './test-run';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="3" failures="1" skipped="1">
  <testsuite name="a/x.test.ts" file="a/x.test.ts" tests="3">
    <testsuite name="Order" file="a/x.test.ts" line="1">
      <testcase name="[covers: method:A.b] passa &amp; &quot;ok&quot; &lt;x&gt;" classname="Order" time="0.1" file="a/x.test.ts" line="2" assertions="1" />
    </testsuite>
    <testcase name="[covers: method:A.c, criterion:0002/x] falha" classname="" time="0.2" file="a/x.test.ts" line="5" assertions="1">
      <failure type="AssertionError" message="expect(received).toBe(expected)&#10;">AssertionError&#10;</failure>
    </testcase>
    <testcase name="sem covers pulado" classname="" time="0" file="a/x.test.ts" line="8" assertions="0">
      <skipped />
    </testcase>
  </testsuite>
</testsuites>`;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agentic-testrun-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parseJUnit', () => {
  test('extrai nome, arquivo, linha, status e covers, inclusive em describe aninhado', () => {
    expect(parseJUnit(XML)).toEqual([
      { name: '[covers: method:A.b] passa & "ok" <x>', file: 'a/x.test.ts', line: 2, status: 'passed', covers: ['method:A.b'] },
      {
        name: '[covers: method:A.c, criterion:0002/x] falha',
        file: 'a/x.test.ts',
        line: 5,
        status: 'failed',
        covers: ['method:A.c', 'criterion:0002/x'],
      },
      { name: 'sem covers pulado', file: 'a/x.test.ts', line: 8, status: 'skipped', covers: [] },
    ]);
  });

  test('unescapeXml trata entidades nomeadas e numéricas', () => {
    expect(unescapeXml('a &amp; b &#10;c &#x41; &apos;d&apos;')).toBe("a & b \nc A 'd'");
  });

  test('XML vazio dá lista vazia', () => {
    expect(parseJUnit('')).toEqual([]);
  });
});

describe('runTests', () => {
  test('roda a suíte num diretório, devolve o exit code e marca o ambiente do verify', async () => {
    await writeFile(
      join(dir, 'a.test.ts'),
      [
        "import { expect, test } from 'bun:test';",
        "test('[covers: method:A.ok] passa', () => { expect(1).toBe(1); });",
        "test('[covers: method:A.no] falha', () => { expect(1).toBe(2); });",
        "test('[covers: method:A.env] vê o ambiente do verify', () => { expect(process.env.AGENTIC_DDD_VERIFY).toBe('1'); });",
        '',
      ].join('\n'),
    );
    const run = await runTests(['bun', 'test'], dir);
    expect(run.exitCode).toBe(1);
    expect(run.cases.map((c) => [c.covers[0], c.status])).toEqual([
      ['method:A.ok', 'passed'],
      ['method:A.no', 'failed'],
      ['method:A.env', 'passed'],
    ]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test src/compiler/verify`
Expected: FAIL — `./test-run` não encontrado.

- [ ] **Step 3: Implementar**

`src/compiler/verify/test-run.ts`:

```ts
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCovers } from '@agentic-ddd/testing';

export const VERIFY_ENV = 'AGENTIC_DDD_VERIFY';

export type TestStatus = 'passed' | 'failed' | 'skipped';

export interface TestCaseResult {
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly status: TestStatus;
  readonly covers: string[];
}

export interface TestRun {
  readonly exitCode: number;
  readonly cases: TestCaseResult[];
}

const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const TESTCASE = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
const ATTRIBUTE = /(\w+)="([^"]*)"/g;

export function unescapeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_match, entity: string) => {
    if (/^#x/i.test(entity)) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
    return NAMED[entity.toLowerCase()] ?? '';
  });
}

export function parseJUnit(xml: string): TestCaseResult[] {
  const cases: TestCaseResult[] = [];
  for (const match of xml.matchAll(TESTCASE)) {
    const attributes = Object.fromEntries([...match[1]!.matchAll(ATTRIBUTE)].map((a) => [a[1]!, unescapeXml(a[2]!)]));
    const body = match[2] ?? '';
    const status: TestStatus = /<(failure|error)\b/.test(body) ? 'failed' : /<skipped\b/.test(body) ? 'skipped' : 'passed';
    const name = attributes.name ?? '';
    cases.push({ name, file: attributes.file ?? '', line: Number(attributes.line ?? 0), status, covers: parseCovers(name) });
  }
  return cases;
}

export async function runTests(command: readonly string[], cwd: string): Promise<TestRun> {
  const dir = await mkdtemp(join(tmpdir(), 'agentic-verify-'));
  const outfile = join(dir, 'junit.xml');
  try {
    const proc = Bun.spawn([...command, '--reporter=junit', `--reporter-outfile=${outfile}`], {
      cwd,
      env: { ...process.env, [VERIFY_ENV]: '1' },
      stdout: 'ignore',
      stderr: 'ignore',
    });
    const exitCode = await proc.exited;
    const xml = await readFile(outfile, 'utf8').catch(() => '');
    return { exitCode, cases: parseJUnit(xml) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bun test src/compiler/verify && bun run typecheck && bun run lint`
Expected: `4 pass`; zero warnings.

- [ ] **Step 5: Commit**

```bash
git add src/compiler/verify
git commit -m "feat(compiler): roda a suíte com JUnit e mapeia os covers de cada teste"
```

---

### Task 10: Gates G1–G6 (avaliação pura)

**Files:**
- Create: `src/compiler/verify/gates.ts`
- Test: `src/compiler/verify/gates.test.ts`

**Interfaces:**
- Consumes: `Proposal`, `parseProposal`, `markApplied` (Task 5); `deltaProblems` (Task 6); `DomainLock` (Task 4); `DiffItem` (Task 3); `TestRun`, `TestCaseResult` (Task 9); `sha256`.
- Produces:
  - `type GateId = 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6'`, `type GateStatus = 'passed' | 'failed' | 'pending'`
  - `interface Finding { message: string; fix: string | null; source: string | null }`
  - `interface GateResult { id: GateId; name: string; status: GateStatus; findings: Finding[]; warnings: Finding[] }`
  - `type VerifyStatus = 'done' | 'needs-human' | 'failed'`, `interface VerifyReport { change: string; title: string; status: VerifyStatus; gates: GateResult[] }`
  - `interface CommandResult { name: string; command: readonly string[]; exitCode: number }`
  - `interface GateInput { proposal: Proposal; lock: DomainLock | null; diff: readonly DiffItem[]; checkOk: boolean; checkProblems: readonly string[]; tests: TestRun; commands: readonly CommandResult[]; knownIds: ReadonlySet<string> }`
  - `evaluateGates(input): VerifyReport`

Regras (spec §8.2): G1 delta (arquivada: registrada no lock, hash confere e nenhuma mudança de domínio depois dela; aberta: `deltaProblems` vazio); G2 `compile --check` limpo; G3 todo critério não-manual tem teste com `covers('criterion:NNNN/id')` e todos passam; G4 toda regra (`invariant:`, `method:`, `usecase:`, `operator:`) de `delta.added`/`delta.modified` tem teste que a cobre e passa, testes de regra modificada viram aviso "revisar", e `covers` com ID desconhecido falha; G5 comandos e suíte com exit 0; G6 critérios manuais ficam `pending`. Status: `failed` se G1–G5 falhar; `needs-human` se só G6 estiver pendente; senão `done`.

- [ ] **Step 1: Escrever o teste que falha**

Create `src/compiler/verify/gates.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { sha256 } from '../canonical';
import { EMPTY_IR } from '../diff';
import { markApplied, parseProposal } from '../changes/proposal';
import type { DomainLock } from '../lock';
import { evaluateGates, type GateInput } from './gates';
import type { TestCaseResult } from './test-run';

const RAW = markApplied(`---
id: "0002"
title: Cancelamento exige motivo
status: proposed
origin: proposal-first
delta:
  added: ["invariant:Order/cancelamento-exige-motivo"]
  modified: ["usecase:cancel_order"]
  removed: []
acceptance:
  - id: rejeita-sem-motivo
    covers: ["invariant:Order/cancelamento-exige-motivo"]
    given: pedido pendente
    when: cancelar sem motivo
    then: falha com CANCELLATION_REASON_REQUIRED
  - id: revisao-de-copy
    manual: true
    then: mensagem revisada
---

## Motivo

Saber por que cancelaram.
`);

const PATH = 'changes/archive/0002-cancelamento-exige-motivo/proposal.md';
const archived = parseProposal(RAW, '0002-cancelamento-exige-motivo', PATH, true).proposal!;
const automaticOnly = parseProposal(
  RAW.replace(/ {2}- id: revisao-de-copy\n {4}manual: true\n {4}then: mensagem revisada\n/, ''),
  '0002-cancelamento-exige-motivo',
  PATH,
  true,
).proposal!;

const lock = (raw = RAW): DomainLock => ({
  lockVersion: 1,
  ir: EMPTY_IR,
  changes: [{ id: '0002', title: 'x', path: PATH, summary: 'x', hash: sha256(raw), items: [] }],
});

const testCase = (covers: string[], status: TestCaseResult['status'] = 'passed', line = 1): TestCaseResult => ({
  name: `[covers: ${covers.join(', ')}] teste ${line}`,
  file: 'examples/orders/test/order.test.ts',
  line,
  status,
  covers,
});

const goodTests = [
  testCase(['criterion:0002/rejeita-sem-motivo', 'invariant:Order/cancelamento-exige-motivo'], 'passed', 10),
  testCase(['usecase:cancel_order'], 'passed', 20),
];

const knownIds = new Set([
  'invariant:Order/cancelamento-exige-motivo',
  'usecase:cancel_order',
  'criterion:0002/rejeita-sem-motivo',
  'criterion:0002/revisao-de-copy',
]);

function input(overrides: Partial<GateInput> = {}): GateInput {
  return {
    proposal: archived,
    lock: lock(),
    diff: [],
    checkOk: true,
    checkProblems: [],
    tests: { exitCode: 0, cases: goodTests },
    commands: [
      { name: 'typecheck', command: ['bun', 'run', 'typecheck'], exitCode: 0 },
      { name: 'lint', command: ['bun', 'run', 'lint'], exitCode: 0 },
    ],
    knownIds,
    ...overrides,
  };
}

const statusOf = (report: ReturnType<typeof evaluateGates>) => Object.fromEntries(report.gates.map((g) => [g.id, g.status]));

describe('evaluateGates', () => {
  test('tudo coberto e sem critério manual → done', () => {
    const report = evaluateGates(input({ proposal: automaticOnly, lock: lock(automaticOnly.raw) }));
    expect(report.status).toBe('done');
    expect(statusOf(report)).toEqual({ G1: 'passed', G2: 'passed', G3: 'passed', G4: 'passed', G5: 'passed', G6: 'passed' });
  });

  test('com critério manual → needs-human e G6 lista o critério', () => {
    const report = evaluateGates(input());
    expect(report.status).toBe('needs-human');
    expect(report.gates.find((g) => g.id === 'G6')!.findings[0]!.message).toBe(
      'critério manual pendente: criterion:0002/revisao-de-copy — mensagem revisada',
    );
  });

  test('critério sem teste → failed com instrução acionável', () => {
    const report = evaluateGates(input({ tests: { exitCode: 0, cases: [testCase(['usecase:cancel_order']), testCase(['invariant:Order/cancelamento-exige-motivo'])] } }));
    expect(report.status).toBe('failed');
    const g3 = report.gates.find((g) => g.id === 'G3')!;
    expect(g3.status).toBe('failed');
    expect(g3.findings).toEqual([
      {
        message: 'critério criterion:0002/rejeita-sem-motivo sem teste',
        fix: `crie um teste com covers(['criterion:0002/rejeita-sem-motivo'], "falha com CANCELLATION_REASON_REQUIRED")`,
        source: PATH,
      },
    ]);
  });

  test('teste do critério falhando aparece com arquivo:linha', () => {
    const cases = [testCase(['criterion:0002/rejeita-sem-motivo', 'invariant:Order/cancelamento-exige-motivo'], 'failed', 42), goodTests[1]!];
    const g3 = evaluateGates(input({ tests: { exitCode: 1, cases } })).gates.find((g) => g.id === 'G3')!;
    expect(g3.findings[0]).toMatchObject({ message: expect.stringContaining('teste falhou: '), source: 'examples/orders/test/order.test.ts:42' });
  });

  test('G4: regra sem teste, regra modificada vira aviso e covers com ID desconhecido falha', () => {
    const cases = [goodTests[0]!, testCase(['usecase:cancel_ordr'], 'passed', 7)];
    const g4 = evaluateGates(input({ tests: { exitCode: 0, cases } })).gates.find((g) => g.id === 'G4')!;
    expect(g4.status).toBe('failed');
    expect(g4.findings.map((f) => f.message)).toEqual([
      'usecase:cancel_order não tem teste com covers',
      'covers cita usecase:cancel_ordr, que não existe',
    ]);
    expect(g4.findings[1]!.source).toBe('examples/orders/test/order.test.ts:7');

    const ok = evaluateGates(input()).gates.find((g) => g.id === 'G4')!;
    expect(ok.status).toBe('passed');
    expect(ok.warnings.map((w) => w.message)).toEqual(['revisar: [covers: usecase:cancel_order] teste 20 cobre usecase:cancel_order, que foi modificado']);
  });

  test('G1: proposta arquivada editada ou com mudança de domínio depois dela', () => {
    const edited = evaluateGates(input({ lock: lock('outro conteúdo') })).gates.find((g) => g.id === 'G1')!;
    expect(edited.findings[0]!.message).toBe('a proposta 0002 foi editada depois de aplicada');
    const later = evaluateGates(
      input({ diff: [{ id: 'method:Order.confirm', kind: 'modified', classification: 'behavioral', module: 'orders' }] }),
    ).gates.find((g) => g.id === 'G1')!;
    expect(later.findings[0]!.message).toBe('o código tem mudança de domínio depois da proposta: modified method:Order.confirm');
  });

  test('G1: proposta aberta compara delta e diff', () => {
    const open = parseProposal(RAW.replace('status: applied', 'status: proposed'), '0002-cancelamento-exige-motivo', PATH.replace('archive/', ''), false).proposal!;
    const g1 = evaluateGates(input({ proposal: open, lock: null, diff: [] })).gates.find((g) => g.id === 'G1')!;
    expect(g1.findings.map((f) => f.message)).toEqual([
      'ID no delta sem mudança correspondente no código: added invariant:Order/cancelamento-exige-motivo',
      'ID no delta sem mudança correspondente no código: modified usecase:cancel_order',
    ]);
  });

  test('G2 e G5: check sujo, comando e suíte falhando', () => {
    const report = evaluateGates(
      input({
        checkOk: false,
        checkProblems: ['desatualizado (changed): AGENTS.md'],
        commands: [{ name: 'lint', command: ['bun', 'run', 'lint'], exitCode: 1 }],
        tests: { exitCode: 1, cases: goodTests },
      }),
    );
    expect(report.status).toBe('failed');
    expect(report.gates.find((g) => g.id === 'G2')!.findings[0]).toEqual({
      message: 'desatualizado (changed): AGENTS.md',
      fix: 'rode `bun run agentic compile` e commite os arquivos gerados',
      source: null,
    });
    expect(report.gates.find((g) => g.id === 'G5')!.findings.map((f) => f.message)).toEqual([
      'lint saiu com 1',
      'a suíte de testes saiu com 1',
    ]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test src/compiler/verify/gates.test.ts`
Expected: FAIL — `./gates` não encontrado.

- [ ] **Step 3: Implementar**

`src/compiler/verify/gates.ts`:

```ts
import { sha256 } from '../canonical';
import type { Proposal } from '../changes/proposal';
import { deltaProblems } from '../changes/reconcile';
import type { DiffItem } from '../diff';
import type { DomainLock } from '../lock';
import type { TestCaseResult, TestRun } from './test-run';

export type GateId = 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6';
export type GateStatus = 'passed' | 'failed' | 'pending';

export interface Finding {
  readonly message: string;
  readonly fix: string | null;
  readonly source: string | null;
}

export interface GateResult {
  readonly id: GateId;
  readonly name: string;
  readonly status: GateStatus;
  readonly findings: Finding[];
  readonly warnings: Finding[];
}

export type VerifyStatus = 'done' | 'needs-human' | 'failed';

export interface VerifyReport {
  readonly change: string;
  readonly title: string;
  readonly status: VerifyStatus;
  readonly gates: GateResult[];
}

export interface CommandResult {
  readonly name: string;
  readonly command: readonly string[];
  readonly exitCode: number;
}

export interface GateInput {
  readonly proposal: Proposal;
  readonly lock: DomainLock | null;
  readonly diff: readonly DiffItem[];
  readonly checkOk: boolean;
  readonly checkProblems: readonly string[];
  readonly tests: TestRun;
  readonly commands: readonly CommandResult[];
  readonly knownIds: ReadonlySet<string>;
}

const RULE_PREFIXES = ['invariant:', 'method:', 'usecase:', 'operator:'];
const at = (testCase: TestCaseResult): string => `${testCase.file}:${testCase.line}`;
const failure = (testCase: TestCaseResult): Finding => ({
  message: `teste ${testCase.status === 'skipped' ? 'pulado' : 'falhou'}: ${testCase.name}`,
  fix: 'corrija o código ou o teste até ele passar',
  source: at(testCase),
});
const gate = (id: GateId, name: string, findings: Finding[], warnings: Finding[] = []): GateResult => ({
  id,
  name,
  status: findings.length > 0 ? 'failed' : 'passed',
  findings,
  warnings,
});

export function evaluateGates(input: GateInput): VerifyReport {
  const { proposal } = input;
  const covering = (id: string): TestCaseResult[] => input.tests.cases.filter((c) => c.covers.includes(id));

  const g1: Finding[] = [];
  if (proposal.archived) {
    const recorded = input.lock?.changes.find((change) => change.id === proposal.id);
    if (!recorded) {
      g1.push({ message: `a proposta ${proposal.id} está em archive mas não está no lock`, fix: 'restaure o lock pelo git', source: proposal.path });
    } else if (recorded.hash !== sha256(proposal.raw)) {
      g1.push({
        message: `a proposta ${proposal.id} foi editada depois de aplicada`,
        fix: 'restaure-a pelo git; propostas arquivadas são imutáveis',
        source: proposal.path,
      });
    }
    for (const item of input.diff.filter((i) => i.classification !== 'docs')) {
      g1.push({
        message: `o código tem mudança de domínio depois da proposta: ${item.kind} ${item.id}`,
        fix: 'abra uma nova proposta para essa mudança',
        source: null,
      });
    }
  } else {
    for (const problem of deltaProblems(proposal, input.diff)) {
      g1.push({ message: problem, fix: 'ajuste o delta da proposta ou o código para que coincidam', source: proposal.path });
    }
  }

  const g2: Finding[] = input.checkOk
    ? []
    : (input.checkProblems.length > 0 ? input.checkProblems : ['compile --check falhou']).map((message) => ({
        message,
        fix: 'rode `bun run agentic compile` e commite os arquivos gerados',
        source: null,
      }));

  const g3: Finding[] = [];
  for (const criterion of proposal.acceptance.filter((c) => !c.manual)) {
    const id = `criterion:${proposal.id}/${criterion.id}`;
    const cases = covering(id);
    if (cases.length === 0) {
      g3.push({ message: `critério ${id} sem teste`, fix: `crie um teste com covers(['${id}'], ${JSON.stringify(criterion.then)})`, source: proposal.path });
    }
    g3.push(...cases.filter((c) => c.status !== 'passed').map(failure));
  }

  const g4: Finding[] = [];
  const g4Warnings: Finding[] = [];
  const rules = [...new Set([...proposal.delta.added, ...proposal.delta.modified])]
    .filter((id) => RULE_PREFIXES.some((prefix) => id.startsWith(prefix)))
    .sort();
  for (const id of rules) {
    const cases = covering(id);
    if (cases.length === 0) g4.push({ message: `${id} não tem teste com covers`, fix: `crie um teste com covers(['${id}'], '…')`, source: null });
    g4.push(...cases.filter((c) => c.status !== 'passed').map(failure));
    if (proposal.delta.modified.includes(id)) {
      for (const c of cases) g4Warnings.push({ message: `revisar: ${c.name} cobre ${id}, que foi modificado`, fix: null, source: at(c) });
    }
  }
  for (const c of input.tests.cases) {
    for (const id of c.covers) {
      if (!input.knownIds.has(id)) g4.push({ message: `covers cita ${id}, que não existe`, fix: 'corrija o ID no covers do teste', source: at(c) });
    }
  }

  const g5: Finding[] = input.commands
    .filter((c) => c.exitCode !== 0)
    .map((c) => ({ message: `${c.name} saiu com ${c.exitCode}`, fix: `rode ${c.command.join(' ')} e corrija`, source: null }));
  if (input.tests.exitCode !== 0) {
    g5.push({ message: `a suíte de testes saiu com ${input.tests.exitCode}`, fix: 'rode bun test e corrija as falhas', source: null });
  }

  const g6: Finding[] = proposal.acceptance
    .filter((c) => c.manual)
    .map((c) => ({
      message: `critério manual pendente: criterion:${proposal.id}/${c.id} — ${c.then}`,
      fix: 'peça a validação de uma pessoa',
      source: proposal.path,
    }));

  const gates: GateResult[] = [
    gate('G1', 'Delta', g1),
    gate('G2', 'Docs', g2),
    gate('G3', 'Critérios', g3),
    gate('G4', 'Regras', g4, g4Warnings),
    gate('G5', 'Qualidade', g5),
    { id: 'G6', name: 'Manual', status: g6.length > 0 ? 'pending' : 'passed', findings: g6, warnings: [] },
  ];
  const status: VerifyStatus = gates.some((g) => g.status === 'failed') ? 'failed' : g6.length > 0 ? 'needs-human' : 'done';
  return { change: proposal.id, title: proposal.title, status, gates };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bun test src/compiler/verify && bun run typecheck && bun run lint`
Expected: `12 pass` (4 da Task 9 + 8); zero warnings.

- [ ] **Step 5: Commit**

```bash
git add src/compiler/verify
git commit -m "feat(compiler): avalia os gates G1–G6 do verify"
```

---

### Task 11: Comando `verify`, convenções no `AGENTS.md` e verificação do change 0001

**Files:**
- Create: `src/compiler/verify/index.ts`, `src/cli/commands/verify.ts`, `src/cli/verify.test.ts`, `examples/orders/test/operator.test.ts`
- Modify: `src/compiler/config.ts`, `src/compiler/index.ts`, `src/cli/main.ts`, `src/cli/usage.ts`, `src/compiler/render/agents-md.ts`, `src/compiler/render-all.test.ts` (asserção + snapshot)
- Regenerate: `AGENTS.md`

**Interfaces:**
- Consumes: `compile`, `readLock`, `listProposals`, `semanticDiff`, `EMPTY_IR`, `elementsOf`, `runTests`, `VERIFY_ENV`, `evaluateGates`.
- Produces:
  - `AgenticConfig.verify?: { test?: readonly string[]; commands?: Readonly<Record<string, readonly string[]>> }`; `ResolvedConfig.verify: { test: readonly string[]; commands: readonly { name: string; command: readonly string[] }[] }` (padrão: test `['bun', 'test']`; commands `lint: ['bun','run','lint']`, `typecheck: ['bun','run','typecheck']`, ordenados por nome).
  - `verify(options: { configPath: string; change: string }): Promise<VerifyReport>` em `@agentic-ddd/compiler`.
  - CLI: `agentic-ddd verify <NNNN> [--config <arquivo>]` → relatório JSON em stdout, resumo por gate em stderr; exit 0 para `done`/`needs-human`, 1 para `failed` ou erro, 2 para uso incorreto.
  - Bloco do `AGENTS.md` com o fluxo de mudança e a condição de conclusão.

- [ ] **Step 1: Escrever os testes que falham**

Create `examples/orders/test/operator.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { defaultRegistry } from '@agentic-ddd/decorators';
import { covers } from '@agentic-ddd/testing';
import { CancelOrder } from '../application/cancel-order';
import { ConfirmOrder } from '../application/confirm-order';
import { CreateOrder } from '../application/create-order';
import { OrderOperator } from '../operators/order.operator';

describe('order-operator', () => {
  test(covers(['operator:order-operator'], 'expõe os três use-cases e exige aprovação para cancelar'), () => {
    const record = defaultRegistry.operators.find((o) => o.target === OrderOperator)!;
    expect(record.useCases).toEqual([CreateOrder, ConfirmOrder, CancelOrder]);
    expect(record.requiresApproval).toEqual([CancelOrder]);
  });
});
```

Create `src/cli/verify.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../..');
const insideVerify = process.env.AGENTIC_DDD_VERIFY === '1';

function run(...args: string[]) {
  const result = Bun.spawnSync(['bun', 'src/cli/main.ts', ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

describe('agentic-ddd verify', () => {
  test('uso incorreto sai com 2', () => {
    expect(run('verify').code).toBe(2);
  });

  test('número inválido ou proposta inexistente sai com 1 e explica', () => {
    const invalid = run('verify', 'abc');
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain('verify: número de change inválido "abc" (esperado NNNN)');
    const missing = run('verify', '9999');
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('verify: proposta 9999 não encontrada');
  });

  test.skipIf(insideVerify)(
    'verify 0001 do exemplo retorna done',
    () => {
      const result = run('verify', '0001');
      const report = JSON.parse(result.stdout) as { status: string; gates: { id: string; status: string; findings: unknown[] }[] };
      expect(report.gates.filter((g) => g.status !== 'passed')).toEqual([]);
      expect(report.status).toBe('done');
      expect(result.code).toBe(0);
      expect(result.stderr).toContain('G4 Regras: passed');
    },
    300_000,
  );
});
```

In `src/compiler/render-all.test.ts`, inside the test `'o bloco do AGENTS.md tem marcadores, mapa e convenções'`, add:

```ts
    expect(rendered.agentsBlock).toContain('`bun run agentic verify <NNNN>` retorna `done` ou `needs-human`');
    expect(rendered.agentsBlock).toContain('`changes/NNNN-<slug>/proposal.md`');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test src/cli/verify.test.ts src/compiler/render-all.test.ts`
Expected: FAIL — `verify` é comando desconhecido (exit 2 em todos); o bloco não cita o fluxo.

- [ ] **Step 3: Config e orquestração**

In `src/compiler/config.ts`:

```ts
export interface VerifyConfig {
  readonly test?: readonly string[];
  readonly commands?: Readonly<Record<string, readonly string[]>>;
}
```

- `AgenticConfig`: add `readonly verify?: VerifyConfig;`
- `ResolvedConfig`: add `readonly verify: { readonly test: readonly string[]; readonly commands: readonly { readonly name: string; readonly command: readonly string[] }[] };`
- In `resolveConfig`, add to the returned object:

```ts
    verify: {
      test: [...(config.verify?.test ?? ['bun', 'test'])],
      commands: Object.entries(config.verify?.commands ?? { typecheck: ['bun', 'run', 'typecheck'], lint: ['bun', 'run', 'lint'] })
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([name, command]) => ({ name, command: [...command] })),
    },
```

If `src/compiler/config.test.ts` compares a whole `ResolvedConfig`, add the default `verify` to the expected object.

`src/compiler/verify/index.ts`:

```ts
import { join } from 'node:path';
import { listProposals } from '../changes/proposal';
import { compile } from '../compile';
import { EMPTY_IR, elementsOf, semanticDiff } from '../diff';
import { readLock } from '../lock';
import { evaluateGates, type CommandResult, type VerifyReport } from './gates';
import { VERIFY_ENV, runTests } from './test-run';

export interface VerifyOptions {
  readonly configPath: string;
  readonly change: string;
}

export async function verify(options: VerifyOptions): Promise<VerifyReport> {
  if (!/^\d{4}$/.test(options.change)) throw new Error(`verify: número de change inválido "${options.change}" (esperado NNNN)`);
  const check = await compile({ configPath: options.configPath, mode: 'check' });
  const { config } = check;
  if (check.ir === null) throw new Error('verify: não foi possível analisar o domínio');
  const lock = await readLock(join(config.outRoot, config.out.lock), config.out.lock);
  const { proposals } = await listProposals(join(config.outRoot, config.changesDir), config.changesDir);
  const proposal = proposals.find((p) => p.id === options.change);
  if (!proposal) {
    throw new Error(`verify: proposta ${options.change} não encontrada em ${config.changesDir}/ nem em ${config.changesDir}/archive/`);
  }
  const tests = await runTests(config.verify.test, config.root);
  const commands: CommandResult[] = [];
  for (const { name, command } of config.verify.commands) {
    const proc = Bun.spawn([...command], { cwd: config.root, env: { ...process.env, [VERIFY_ENV]: '1' }, stdout: 'ignore', stderr: 'ignore' });
    commands.push({ name, command, exitCode: await proc.exited });
  }
  const checkProblems = [
    ...check.errors.map((e) => `${e.source ?? '-'}: ${e.message}`),
    ...check.drift.map((d) => `desatualizado (${d.reason}): ${d.path}`),
    ...check.pending,
  ];
  const knownIds = new Set([
    ...elementsOf(check.ir).keys(),
    ...proposals.flatMap((p) => p.acceptance.map((c) => `criterion:${p.id}/${c.id}`)),
  ]);
  return evaluateGates({
    proposal,
    lock,
    diff: semanticDiff(lock?.ir ?? EMPTY_IR, check.ir),
    checkOk: check.ok,
    checkProblems,
    tests,
    commands,
    knownIds,
  });
}
```

In `src/compiler/index.ts`, add:

```ts
export { verify, type VerifyOptions } from './verify/index';
export { evaluateGates, type Finding, type GateResult, type VerifyReport, type VerifyStatus } from './verify/gates';
export { VERIFY_ENV, parseJUnit, runTests, type TestCaseResult, type TestRun } from './verify/test-run';
export type { VerifyConfig } from './config';
```

- [ ] **Step 4: CLI**

`src/cli/commands/verify.ts`:

```ts
import { verify } from '../../compiler/verify/index';
import { parseArgs } from '../args';
import { USAGE } from '../usage';

export async function verifyCommand(args: readonly string[]): Promise<number> {
  const parsed = parseArgs(args, { booleans: [], values: ['--config'], positionals: 1 });
  if (typeof parsed === 'string') {
    console.error(`${parsed}\n${USAGE}`);
    return 2;
  }
  const report = await verify({ configPath: parsed.values.get('--config') ?? 'agentic.config.ts', change: parsed.positionals[0]! });
  for (const gate of report.gates) {
    console.error(`${gate.id} ${gate.name}: ${gate.status}`);
    for (const finding of [...gate.findings, ...gate.warnings]) {
      const source = finding.source ? ` (${finding.source})` : '';
      const fix = finding.fix ? ` → ${finding.fix}` : '';
      console.error(`  - ${finding.message}${source}${fix}`);
    }
  }
  console.error(`agentic-ddd: change ${report.change} — ${report.status}`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.status === 'failed' ? 1 : 0;
}
```

In `src/cli/usage.ts`, append the line `'  agentic-ddd verify <NNNN> [--config <arquivo>]',` to the array.
In `src/cli/main.ts`, import `verifyCommand` from `./commands/verify` and add `verify: verifyCommand,` to `COMMANDS`.

- [ ] **Step 5: Convenções no bloco do `AGENTS.md`**

In `src/compiler/render/agents-md.ts`, inside `renderAgentsBlock`, compute `const changes = paths.changesDir ?? 'changes';` and insert these two lines right before the line that starts with `` `- Gerados (não edite): ``:

```ts
    `- Mudança de regra de negócio: escreva antes a proposta em ${code(`${changes}/NNNN-<slug>/proposal.md`)} (delta, critérios de aceite e \`## Motivo\`), implemente e rode \`bun run agentic compile\`; para mudança já feita no código, \`bun run agentic compile --draft-change <slug>\` gera o rascunho.`,
    '- Uma tarefa só está concluída quando `bun run agentic verify <NNNN>` retorna `done` ou `needs-human`.',
```

- [ ] **Step 6: Rodar, regenerar e verificar o 0001**

```bash
bun test src/compiler --update-snapshots
bun run agentic compile
bun test && bun run typecheck && bun run lint
bun run agentic compile --check
bun run agentic verify 0001
```

Expected: tudo verde (o e2e `verify 0001` dentro da suíte passa e demora mais que os outros); o `AGENTS.md` regenerado tem as duas convenções; `verify 0001` imprime `change 0001 — done`, todos os gates `passed`, e sai com 0.

Se o G4 falhar, **não relaxe o gate**. Diagnóstico esperado:
- O delta do 0001 lista todas as regras do exemplo. Cada uma precisa de um teste com `covers`: as duas invariantes de classe, `method:Order.create`, `method:Order.confirm` e `method:Order.cancel` (em `order.test.ts`), os três use-cases (em `use-cases.test.ts`) e `operator:order-operator` (o `operator.test.ts` desta task). Se faltar algum, acrescente o teste em `examples/orders/test/`.
- O achado "covers cita X, que não existe" só aparece se o **nome** de algum teste do repositório começar com `[covers: …]` citando um ID fora da IR. `src/testing/testing.test.ts` chama `covers()` só como valor dentro do teste, não como nome; `test-run.test.ts` grava os testes num diretório temporário; `gates.test.ts` usa resultados falsos. Nenhum deles aparece no JUnit da suíte.

- [ ] **Step 7: Commit**

```bash
git add src examples AGENTS.md
git commit -m "feat(cli): adiciona agentic-ddd verify e o fluxo de mudança no AGENTS.md"
```

---

### Task 12: Change 0002 (proposal-first): cancelamento exige motivo

**Files:**
- Create: `changes/0002-cancelamento-exige-motivo/proposal.md` (vira `changes/archive/…` no fim)
- Modify: `examples/orders/domain/order.ts`, `examples/orders/application/cancel-order.ts`, `examples/orders/test/order.test.ts`, `examples/orders/test/use-cases.test.ts`, `src/cli/verify.test.ts`
- Regenerate: `.agentic/domain.lock.json`, `.agentic/runtime/order-operator/**`, `.agents/skills/orders-dev/**`

**Interfaces:**
- Consumes: todo o fluxo das Tasks 3–11.
- Produces: `Order.cancel(reason: string)`; input de `cancel_order` com `reason` obrigatório; invariante `invariant:Order/cancelamento-exige-motivo` declarada no método `cancel`; `DomainError` com code `CANCELLATION_REASON_REQUIRED`; change 0002 aplicado e arquivado.

- [ ] **Step 1: Escrever a proposta antes do código**

Create `changes/0002-cancelamento-exige-motivo/proposal.md`:

```markdown
---
id: "0002"
title: Cancelamento exige motivo
status: proposed
origin: proposal-first
delta:
  added:
    - "invariant:Order/cancelamento-exige-motivo"
  modified:
    - "usecase:cancel_order"
  removed: []
acceptance:
  - id: rejeita-cancelamento-sem-motivo
    covers: ["invariant:Order/cancelamento-exige-motivo"]
    given: pedido pendente
    when: cancelar sem informar motivo ou com motivo em branco
    then: falha com CANCELLATION_REASON_REQUIRED, o pedido continua pendente e nenhum OrderCancelled é emitido
  - id: cancela-com-motivo
    covers: ["usecase:cancel_order"]
    given: pedido pendente
    when: cancel_order é chamado com reason
    then: o pedido fica cancelado e OrderCancelled é publicado
  - id: revisao-de-copy
    manual: true
    then: a mensagem de erro do cancelamento sem motivo foi revisada pelo time de produto
---

## Motivo

O atendimento precisa saber por que cada pedido foi cancelado para tratar reclamações e medir desistências. Hoje `cancel_order` aceita cancelar sem nenhuma justificativa.
```

- [ ] **Step 2: Ver a proposta pendente**

```bash
bun run agentic compile
bun run agentic compile --check
```

Expected: o `compile` sai com 0 e imprime `pendente: a proposta 0002 está aberta, mas o código ainda não tem as mudanças de domínio do delta`; o `--check` sai com 1 pelo mesmo motivo. (É o estado normal de uma proposta proposal-first antes do código.)

- [ ] **Step 3: Escrever os testes (falham)**

In `examples/orders/test/order.test.ts`:
1. Every call `order.cancel()` / `pending.cancel()` / `confirmed.cancel()` becomes `.cancel('cliente desistiu')`.
2. Add inside the `describe`:

```ts
  test(
    covers(
      ['invariant:Order/cancelamento-exige-motivo', 'criterion:0002/rejeita-cancelamento-sem-motivo'],
      'rejeita cancelamento sem motivo ou com motivo em branco',
    ),
    () => {
      const order = newOrder();
      expectDomainError(() => order.cancel(''), 'CANCELLATION_REASON_REQUIRED');
      expectDomainError(() => order.cancel('   '), 'CANCELLATION_REASON_REQUIRED');
      expect(order.status).toBe('pending');
      expect(order.pullEvents()).toEqual([]);
    },
  );
```

In `examples/orders/test/use-cases.test.ts`, replace the test `'cancela pedido e publica OrderCancelled'` by:

```ts
  test(
    covers(['usecase:cancel_order', 'criterion:0002/cancela-com-motivo'], 'cancela pedido com motivo e publica OrderCancelled'),
    async () => {
      await new CreateOrder(orders).execute(input, createTestContext());
      const ctx = createTestContext();
      expect(await new CancelOrder(orders).execute({ order_id: 'o1', reason: 'cliente desistiu' }, ctx)).toEqual({
        order_id: 'o1',
        status: 'cancelled',
      });
      expect(ctx.published.map((e) => e.name)).toEqual(['OrderCancelled']);
    },
  );
```

Run: `bun test examples`
Expected: FAIL — `CANCELLATION_REASON_REQUIRED` não é lançado; `reason` não existe no input de `cancel_order` (erro de tipo no typecheck).

- [ ] **Step 4: Implementar**

In `examples/orders/domain/order.ts`, replace the `cancel` method (keep its `@AgentMethod` exactly as is and add the `@Invariant` below it):

```ts
  @AgentMethod({
    description: 'Cancela um pedido pendente ou confirmado.',
    transition: { from: ['pending', 'confirmed'], to: 'cancelled' },
    emits: [OrderCancelled],
  })
  @Invariant({ id: 'cancelamento-exige-motivo', text: 'Todo cancelamento precisa de um motivo não vazio.' })
  cancel(reason: string): void {
    if (reason.trim() === '') {
      throw new DomainError('CANCELLATION_REASON_REQUIRED', 'Informe o motivo do cancelamento.');
    }
    this.#ensureStatus(['pending', 'confirmed'], 'cancelar');
    this.#status = 'cancelled';
    this.record(new OrderCancelled({ orderId: this.id }));
  }
```

In `examples/orders/application/cancel-order.ts`:

```ts
export const cancelOrderInput = z.object({
  order_id: z.string().min(1).describe('Id do pedido a cancelar'),
  reason: z.string().min(1).describe('Motivo do cancelamento informado pelo cliente'),
});
```

and in `execute`, `order.cancel();` becomes `order.cancel(input.reason);`.

- [ ] **Step 5: Rodar e ver passar**

Run: `bun test examples && bun run typecheck && bun run lint`
Expected: verde; zero warnings.

- [ ] **Step 6: Aplicar a proposta**

```bash
bun run agentic compile
bun run agentic compile --check
```

Expected: `proposta 0002 aplicada e arquivada`; `--check` em dia. Conferir:
- `changes/archive/0002-cancelamento-exige-motivo/proposal.md` com `status: applied`;
- `.agentic/runtime/order-operator/SKILL.md` com a linha `| \`reason\` | string | sim | Motivo do cancelamento informado pelo cliente |` e a invariante `invariant:Order/cancelamento-exige-motivo` garantida por `Order.cancel`;
- `.agents/skills/orders-dev/references/history.md` com o 0002 (`added invariant:…` e `modified usecase:cancel_order (breaking)`).

- [ ] **Step 7: e2e do `verify 0002`**

Append inside the `describe` of `src/cli/verify.test.ts`:

```ts
  test.skipIf(insideVerify)(
    'verify 0002 do exemplo retorna needs-human por causa do critério manual',
    () => {
      const result = run('verify', '0002');
      const report = JSON.parse(result.stdout) as {
        status: string;
        gates: { id: string; status: string; findings: { message: string }[]; warnings: { message: string }[] }[];
      };
      expect(report.gates.filter((g) => g.status === 'failed')).toEqual([]);
      expect(report.status).toBe('needs-human');
      const g6 = report.gates.find((g) => g.id === 'G6')!;
      expect(g6.findings.map((f) => f.message)).toEqual([
        'critério manual pendente: criterion:0002/revisao-de-copy — a mensagem de erro do cancelamento sem motivo foi revisada pelo time de produto',
      ]);
      expect(report.gates.find((g) => g.id === 'G4')!.warnings.length).toBeGreaterThan(0);
      expect(result.code).toBe(0);
    },
    300_000,
  );
```

Run: `bun test && bun run agentic verify 0002`
Expected: tudo verde; o `verify 0002` imprime `change 0002 — needs-human` e sai com 0.

- [ ] **Step 8: Commit**

```bash
git add examples changes .agentic .agents/skills src/cli/verify.test.ts
git commit -m "feat(orders): cancelamento exige motivo (change 0002, proposal-first)"
```

---

### Task 13: Formato do dataset de avaliação e documentação

**Files:**
- Create: `evals/skills/orders.yaml`, `test/evals.test.ts`
- Modify: `README.md`, `CONTRIBUTING.md`, `docs/superpowers/plans/2026-10-06-v0-00-index.md`

**Interfaces:**
- Consumes: `analyzeProject` (Task 1); a IR do exemplo depois do change 0002.
- Produces: o formato de `evals/skills/*.yaml` (spec §12.3), validado por teste; o runner que executa o dataset com LLMs fica para o v0.1.

- [ ] **Step 1: Escrever o teste que falha**

Create `test/evals.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { analyzeProject } from '@agentic-ddd/compiler';

const ROOT = resolve(import.meta.dir, '..');

type Expectation =
  | { readonly type: 'tool_call'; readonly name: string; readonly input: Record<string, unknown> }
  | { readonly type: 'exact'; readonly value: string };

interface EvalCase {
  readonly id: string;
  readonly audience: 'runtime' | 'dev';
  readonly question: string;
  readonly expect: Expectation;
}

const cases = Bun.YAML.parse(await readFile(resolve(ROOT, 'evals/skills/orders.yaml'), 'utf8')) as EvalCase[];
const { ir, errors } = await analyzeProject({ configPath: resolve(ROOT, 'agentic.config.ts') });

describe('evals/skills/orders.yaml', () => {
  test('o domínio do exemplo compila', () => {
    expect(errors).toEqual([]);
  });

  test('tem de 3 a 5 casos com id kebab-case único, audience e pergunta', () => {
    expect(cases.length).toBeGreaterThanOrEqual(3);
    expect(cases.length).toBeLessThanOrEqual(5);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      expect(c.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(['runtime', 'dev']).toContain(c.audience);
      expect(c.question.trim().length).toBeGreaterThan(0);
    }
  });

  test('tool_call cita uma tool existente e só parâmetros do input dela', () => {
    for (const c of cases) {
      if (c.expect.type !== 'tool_call') continue;
      const tool = ir.useCases.find((u) => u.name === (c.expect as { name: string }).name);
      expect(tool, c.id).toBeDefined();
      const properties = Object.keys((tool!.inputSchema.properties ?? {}) as Record<string, unknown>);
      for (const key of Object.keys(c.expect.input)) expect(properties, c.id).toContain(key);
    }
  });

  test('respostas exatas não são vazias e só existem os tipos tool_call e exact', () => {
    for (const c of cases) {
      expect(['tool_call', 'exact']).toContain(c.expect.type);
      if (c.expect.type === 'exact') expect(c.expect.value.trim().length).toBeGreaterThan(0);
    }
  });
});
```

Run: `bun test test/evals.test.ts`
Expected: FAIL — `evals/skills/orders.yaml` não existe.

- [ ] **Step 2: Criar o dataset**

Create `evals/skills/orders.yaml`:

```yaml
# Dataset da camada 2 (spec §12.3): perguntas com resposta verificável sobre as
# skills geradas do exemplo orders. O runner que pergunta a LLMs reais é do v0.1.
- id: confirmar-pedido
  audience: runtime
  question: "Qual tool confirma o pedido 7f3c, e com quais argumentos?"
  expect: { type: tool_call, name: confirm_order, input: { order_id: "7f3c" } }
- id: cancelar-com-motivo
  audience: runtime
  question: "O cliente pediu para cancelar o pedido 7f3c porque desistiu. Qual tool e quais argumentos?"
  expect: { type: tool_call, name: cancel_order, input: { order_id: "7f3c", reason: "desistiu" } }
- id: cancelar-exige-aprovacao
  audience: runtime
  question: "Cancelar um pedido exige aprovação humana? Responda sim ou não."
  expect: { type: exact, value: "sim" }
- id: confirmar-cancelado
  audience: dev
  question: "Um pedido cancelled pode ser confirmado? Responda sim ou não."
  expect: { type: exact, value: "não" }
- id: onde-criar-use-case
  audience: dev
  question: "Em que caminho e com qual decorator crio o use-case refund_order?"
  expect: { type: exact, value: "examples/orders/application/refund-order.ts @AgentUseCase" }
```

Run: `bun test test/evals.test.ts`
Expected: `4 pass`.

- [ ] **Step 3: Documentação**

In `README.md`, add after the "Quickstart" section:

````markdown
## Mudanças de domínio e conclusão de tarefas

Toda mudança de regra de negócio fica registrada em `changes/`, e o compilador mantém um snapshot do domínio em `.agentic/domain.lock.json`.

```bash
# proposal-first: escreva changes/NNNN-<slug>/proposal.md (delta, critérios de aceite, ## Motivo), implemente e:
bun run agentic compile                          # aplica e arquiva a proposta quando o código bate com o delta
# code-first: depois de mudar o código decorado
bun run agentic compile --draft-change <slug>    # gera o rascunho com o delta preenchido; escreva o Motivo
bun run agentic verify 0002                      # gates G1–G6 em JSON; done | needs-human | failed
bun run agentic ir                               # IR canônica (depuração)
```

O `verify` roda a suíte com reporter JUnit e cruza cada teste marcado com `covers([...])` com as regras e os critérios de aceite da proposta. O histórico por módulo fica em `.agents/skills/<módulo>-dev/references/history.md`.
````

In `CONTRIBUTING.md`, add under "Como trabalhamos":

```markdown
- **Mudança de regra de negócio:** abra a proposta em `changes/NNNN-<slug>/proposal.md` antes do código (ou gere o rascunho com `bun run agentic compile --draft-change <slug>`), implemente com testes `covers` para as regras e os critérios, rode `bun run agentic compile` e só considere a tarefa pronta quando `bun run agentic verify <NNNN>` retornar `done` ou `needs-human`.
```

In `docs/superpowers/plans/2026-10-06-v0-00-index.md`, set the Status column: plano 1 → `implementado`; plano 2 → `implementado`.

- [ ] **Step 4: Verificação completa e commit**

```bash
bun run typecheck && bun run lint && bun test && bun run build && bun run agentic compile --check
bun run agentic verify 0001 && bun run agentic verify 0002
```

Expected: tudo verde; `0001 — done`; `0002 — needs-human`.

```bash
git add evals test/evals.test.ts README.md CONTRIBUTING.md docs/superpowers/plans/2026-10-06-v0-00-index.md
git commit -m "docs: formato do dataset de avaliação e fluxo de changes e verify"
```
