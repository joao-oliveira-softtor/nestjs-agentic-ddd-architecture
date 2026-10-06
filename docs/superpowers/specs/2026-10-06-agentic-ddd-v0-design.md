# `@agentic-ddd` v0 — Design

| | |
|---|---|
| **Status** | Aprovado no brainstorming de 2026-10-06; aguardando revisão da spec escrita |
| **Origem** | [`prompts/#0001-initial.md`](../../../prompts/%230001-initial.md) |
| **Decisões resumidas** | [`docs/adr/ADR-0001.md`](../../adr/ADR-0001.md) |
| **Próximo passo** | plano de implementação via `superpowers:writing-plans` |

---

## 1. Visão

Framework open-source sobre NestJS que combina **DDD** com **agentes de IA**:

- Entidades, use-cases e operators **se autodeclaram** por decorators (descrições, invariantes, transições, schemas, eventos).
- Um **compilador** lê essas declarações e gera, de forma determinística, **skills** no padrão [agentskills.io](https://agentskills.io/specification) e um **`AGENTS.md`**:
  - skills de **runtime**, que o agente operador usa para executar use-cases;
  - skills de **dev**, que agentes de código (Claude Code, Codex, Copilot…) usam para manter e estender o projeto.
- **Não há controllers; há `operators/`.** Um operator é a definição declarativa de um agente de IA que coordena use-cases (as únicas tools que ele enxerga).
- O compilador também mantém o **histórico de mudanças do domínio** (changes) e oferece ao agente de código uma **condição de parada objetiva** (`verify`).

### 1.1 Ciclo de vida que o framework suporta

```
Criação:     código decorado ──▶ documentação gerada ──▶ obrigações de teste (rastreáveis)
Manutenção:  proposta (changes/) ──▶ código ──▶ compile reconcilia ──▶ verify ──▶ done
```

A única documentação escrita à mão é a **proposta de change** (e o texto livre fora do bloco gerado do `AGENTS.md`). Tudo o mais é gerado e nunca editado à mão.

### 1.2 Sucesso do v0

Demonstrar, com um único domínio de exemplo (`orders`), o fluxo ponta a ponta:

```
decorators → compile → skill gerada → operator carrega a skill → LLM fake executa use-case → evento emitido
proposta de change → código → compile reconcilia → verify = done
```

---

## 2. Decisões

| # | Tema | Decisão |
|---|---|---|
| D1 | Persistência no v0 | Repository **in-memory** apenas. TypeORM (já decidido como tecnologia) fica para a fase de infraestrutura. |
| D2 | Test runner | **`bun test`** (substitui Vitest). Um runtime só para dev, teste e produção. |
| D3 | Provider de LLM | **Somente port + fake** no v0. Adapter real fica para depois. O port já nasce compatível com modelos atuais (payload opaco do provider; sem tool choice forçado). |
| D4 | Pacotes | **Pacote único** com fronteiras internas que espelham os pacotes futuros; exemplo em `examples/`; escopo **`@agentic-ddd`**. |
| D5 | Arquivos gerados | **Versionados**, com cabeçalho de arquivo gerado, `linguist-generated`, saída determinística e `compile --check` no CI. |
| D6 | Compilador | **Reflection em runtime**: decorators → registry → IR → validação → diff → renderers. Localização `arquivo:linha` capturada pelo stack no decorator. JSON Schema via `z.toJSONSchema()` nativo do Zod 4. |
| D7 | Snapshot do domínio | IR canônica versionada em `.agentic/domain.lock.json`. |
| D8 | Histórico | **Changes** com delta ADDED/MODIFIED/REMOVED; criação code-first, manutenção proposal-first; `--check` falha em diff sem change; `--draft-change` como válvula. |
| D9 | Testes do domínio | **Rastreabilidade por ID de regra** (`[covers: …]` no nome do teste). Testes gerados da máquina de estados ficam para v0.1. |
| D10 | Conclusão de tarefa | Critérios de aceite **estruturados** (given/when/then com ID) na proposta + **`agentic-ddd verify`** determinístico. |
| D11 | Aprovação humana | `requiresApproval` declarativo, normalizado para política interna `allow/deny/require_approval`, com `ApprovalPort` síncrono. |
| D12 | Eventos e operator | v0: emissão, eventos no `tool_result` e no trace. **`reactsTo` fica para v0.1** (design na §14.2). |
| D13 | Local dos gerados | Pasta canônica por público; `AGENTS.md` com bloco gerado entre marcadores; `CLAUDE.md` com `@AGENTS.md`; skills de dev em `.agents/skills/` + espelho `.claude/skills/`; runtime e lock em `.agentic/`; propostas em `changes/`. |
| — | Já decididos antes | TypeORM, Zod v4, decorators + `reflect-metadata`, licença MIT, Bun + `@nestbun/platform`. |

---

## 3. Layout do repositório

```
src/                              # o framework (futuros pacotes @agentic-ddd/*)
  core/                           # building blocks DDD — sem dependências externas além de zod
  decorators/                     # @AgentEntity, @AgentMethod, @Invariant, @AgentUseCase, @DomainEvent, @Operator + registry
  compiler/                       # IR, validação, lock, diff, changes, renderers
  runtime/                        # LlmPort, FakeLlm, loop do operator, ApprovalPort, EventBus
  nestjs/                         # AgenticModule (integração Nest)
  cli/                            # agentic-ddd compile | ir | verify
  testing/                        # helpers públicos de teste (covers, FakeLlm builders, bus em memória)
examples/
  orders/                         # app de exemplo; importa o framework SÓ via @agentic-ddd/*
    domain/  application/  operators/  infrastructure/  orders.module.ts  test/
agentic.config.ts                 # entrada do compilador (o que importar, onde escrever)
AGENTS.md                         # bloco gerado entre marcadores + conteúdo manual
CLAUDE.md                         # "@AGENTS.md" (criado se não existir)
.agents/skills/<skill-dev>/       # skills de dev (gerado)
.claude/skills/<skill-dev>        # espelho via symlink (gerado, configurável)
.agentic/
  domain.lock.json                # IR canônica (gerado)
  runtime/<operator>/             # skills de runtime (gerado)
changes/
  NNNN-<slug>/proposal.md         # propostas (escritas à mão)
  archive/NNNN-<slug>/            # changes aplicados
evals/skills/                     # dataset da camada 2 (escrito à mão)
docs/adr/  docs/superpowers/specs/
```

Aliases de import (tsconfig `paths`): `@agentic-ddd/core`, `@agentic-ddd/decorators`, `@agentic-ddd/compiler`, `@agentic-ddd/runtime`, `@agentic-ddd/nestjs`, `@agentic-ddd/testing` → `src/*`.

**Regras de dependência** (verificadas por teste de arquitetura):

1. `src/core` não importa nada de `src/*` nem pacotes externos, exceto `zod`; `src/decorators` importa apenas `src/core`, `zod` e `reflect-metadata` (por isso o domínio do exemplo pode usá-lo sem herdar Nest ou LLM).
2. `examples/*/domain` e `examples/*/application` não importam `@nestjs/*` nem nada de `src/runtime`/LLM.
3. `examples/**` só importa o framework via `@agentic-ddd/*` (proibido import relativo para `src/`).
4. `src/compiler` não importa `src/runtime` e vice-versa (ambos dependem de `core`/`decorators`).
5. Nenhum `@Controller` existe no repositório.

O repositório é ao mesmo tempo o framework e o app de exemplo: o `agentic.config.ts` da raiz compila `examples/orders`. As convenções de desenvolvimento **do framework** ficam no texto manual do `AGENTS.md`, fora do bloco gerado.

---

## 4. Building blocks (`src/core`)

| Bloco | Contrato |
|---|---|
| `Entity<Id>` | identidade + igualdade por id |
| `ValueObject<Props>` | igualdade estrutural, imutável |
| `AggregateRoot<Id>` | `protected record(event)`; `pullEvents(): DomainEvent[]` (retorna e limpa) |
| `DomainEvent` | `eventId`, `name`, `occurredAt`, `correlationId`, `causationId`, `payload` |
| `DomainError` | erro de regra de negócio com `code` estável e mensagem acionável |
| `UseCase<In, Out>` | `execute(input, ctx): Promise<Out>`; `ctx` carrega `correlationId`/`causationId` e o publicador de eventos |
| `Repository<T>` (port) | interface por agregado; nenhuma publicação de eventos dentro do repository |

Fluxo de eventos dentro de um use-case: carregar → executar método do agregado (que faz `record`) → `repository.save` → publicar `aggregate.pullEvents()` no `EventBus` via `ctx`. O domínio nunca conhece o barramento.

---

## 5. Decorators e registry (`src/decorators`)

Todos os decorators **só registram metadados explícitos** no registry. Nenhum depende de `design:*`. Cada registro guarda `source` (`caminho/relativo.ts:linha`, POSIX, relativo à raiz), capturado via `new Error().stack` no momento da decoração (verificado em Bun 1.4.2: linha exata do decorator, em `bun test` e `bun run`).

| Decorator | Campos obrigatórios | Opcionais |
|---|---|---|
| `@AgentEntity` | `description` | `states: string[]` (obrigatório se algum método declarar `transition`) |
| `@Invariant` (na **classe**; pode ser empilhado) | `id` (kebab-case, único na entidade), `text` | — |
| `@AgentMethod` | `description` | `emits: EventClass[]`, `transition: { from: State[], to: State }` |
| `@DomainEvent` | `name`, `description`, `payload` (Zod) | — |
| `@AgentUseCase` | `name` (snake_case, `^[a-z][a-z0-9_]{0,63}$`, único), `description`, `whenToUse`, `input` (Zod), `output` (Zod) | `whenNotToUse`, `emits` |
| `@Operator` | `name` (`^[a-z0-9]+(-[a-z0-9]+)*$`, ≤64), `description`, `instructions`, `useCases` | `requiresApproval`, `limits: { maxSteps (default 8), timeoutMs (default 30000) }`, `model` (default `'default'`) |

`whenToUse`/`whenNotToUse` são campos separados (e não prosa dentro de `description`) para que o template da skill seja estruturalmente completo — resposta direta ao achado de que 56% das descrições de tools não declaram o propósito com clareza (Smelly MCP, arXiv:2602.14878).

**Registry injetável:** existe um registry default global (usado pelos decorators) e a API `createRegistry()` / `registry.reset()` para testes isolados por fixture.

### 5.1 IDs de elementos

Toda referência (delta de change, `covers`, mensagens de erro) usa a gramática `tipo:caminho`:

| Elemento | ID |
|---|---|
| Entidade | `entity:Order` |
| Invariante | `invariant:Order/total-nao-negativo` |
| Método (inclui transição e emits) | `method:Order.confirm` |
| Evento | `event:OrderConfirmed` |
| Use-case | `usecase:confirm_order` |
| Operator | `operator:order-operator` |
| Critério de aceite | `criterion:0002/rejeita-cancelamento-sem-motivo` |

---

## 6. Compilador (`src/compiler`)

### 6.1 Pipeline

```
agentic.config.ts ─import─▶ Registry ─▶ IR ─▶ Validação ─▶ Diff (IR × lock) ─▶ Reconciliação de changes ─▶ Renderers ─▶ arquivos
```

1. **Entrada:** `agentic.config.ts` exporta `{ modules: string[] /* globs a importar */, out: {...caminhos}, mirrors: ['.claude/skills'], verify: { commands: { typecheck, lint, test } } }`.
2. **IR:** objeto canônico com `irVersion: 1`, `entities`, `events`, `useCases`, `operators`; cada elemento com `id`, `source` e conteúdo. Schemas Zod convertidos com `z.toJSONSchema()`. O **lock** (`.agentic/domain.lock.json`) = IR canônica + índice dos changes aplicados (`changes: [{ id, hash }]`, hash do `proposal.md` arquivado).
3. **Validação** (erro = mensagem com `arquivo:linha` + exit code 1):
   - campo obrigatório ausente ou vazio (ex.: invariante sem `text`);
   - `id`/`name` fora do padrão ou duplicado;
   - `emits` apontando para classe sem `@DomainEvent`;
   - `transition.from/to` vazio;
   - operator com use-case não decorado; `requiresApproval` fora da allowlist;
   - método público **declarado na própria classe** (de instância ou estático; ignora métodos herdados como `pullEvents`, getters/setters e `constructor`) de `@AgentEntity` sem `@AgentMethod` (convenção: tudo que o agente pode acionar é declarado);
   - `transition.from`/`to` com estado fora de `@AgentEntity({ states })`; entidade com transições sem `states` declarado.
4. **Diff semântico** IR × `domain.lock.json` (ver §7).
5. **Reconciliação** com a proposta aberta (ver §7).
6. **Renderers** puros (IR → `Map<caminho, conteúdo>`); a escrita em disco é uma etapa separada.

### 6.2 Saídas

| Saída | Caminho | Público |
|---|---|---|
| Bloco do índice | `AGENTS.md` entre `<!-- agentic-ddd:begin -->` e `<!-- agentic-ddd:end -->` | agentes de código |
| Ponte Claude | `CLAUDE.md` = `@AGENTS.md` (criado só se não existir; se existir sem a linha `@AGENTS.md`, aviso no `--report`) | Claude Code |
| Skill de dev por módulo | `.agents/skills/<modulo>-dev/SKILL.md` + `references/` | agentes de código |
| Espelho | `.claude/skills/<modulo>-dev` → symlink (fallback: cópia via config) | Claude Code |
| Skill de runtime por operator | `.agentic/runtime/<operator>/SKILL.md` + `references/` | o operator |
| Lock | `.agentic/domain.lock.json` | compilador |
| Histórico | `references/history.md` dentro de cada skill de dev (por entidade) | agentes de código |

**Conteúdo do bloco do `AGENTS.md`** (índice enxuto — Gloaguen et al., arXiv:2602.11988, mostram que visão geral em prosa não ajuda; instruções de prática não-padrão sim):

- mapa: módulos → skill de dev, operators → skill de runtime (só nomes + caminhos);
- convenções não-óbvias: onde criar entidade/use-case/operator, decorators obrigatórios, IDs estáveis de regra;
- fluxo obrigatório de mudança: criar proposta em `changes/`, implementar, `compile`, e **"a tarefa só está concluída quando `agentic-ddd verify <change>` retorna `done` ou `needs-human`"**.

**Skill de runtime** (`metadata.audience: runtime`): `description` do operator; para cada use-case permitido: propósito, quando usar / quando não usar, parâmetros, eventos emitidos, se exige aprovação; invariantes e transições relevantes em **tabelas**. `references/tools.schema.json` com os JSON Schemas; `references/state-machine.md` com a tabela `from → to`.

**Skill de dev** (`metadata.audience: dev`): entidades, invariantes (com ID), métodos, eventos, use-cases e operators do módulo, cada item com `source`; seção "Como estender" com o caminho e o decorator de cada tipo de artefato; obrigações de teste (IDs de regra); link para `references/history.md`.

**Frontmatter** (somente campos da especificação agentskills.io):

```yaml
---
name: orders-dev                 # = nome da pasta
description: …o que faz… Use quando…   # ≤ 1024
metadata:
  agentic-ddd.audience: dev      # dev | runtime
  agentic-ddd.ir-hash: "<sha256 da IR canônica>"
  agentic-ddd.generated: "true"
---
<!-- GERADO por agentic-ddd compile — não edite. Fonte: examples/orders/domain/order.ts -->
```

### 6.3 Determinismo

- Chaves de objeto ordenadas recursivamente (inclusive JSON Schema); listas ordenadas por `id`.
- Caminhos relativos POSIX; LF; newline final; JSON com indentação de 2 espaços.
- Nenhum timestamp, hash de máquina ou caminho absoluto na saída.
- Ordem de chaves do frontmatter fixa.

### 6.4 Comandos (`agentic-ddd …`)

| Comando | Efeito |
|---|---|
| `compile` | valida, reconcilia, escreve tudo; exit 1 em erro |
| `compile --check [--diff]` | não escreve; exit 1 se algo gerado difere do disco, se há diff de domínio sem change, ou se o change aberto não foi reconciliado. É o que roda no CI |
| `compile --report` | árvore gerada com ≈tokens por nível (≈ chars/4) × orçamento; avisos de lint; regras sem teste; cobertura registry → skill |
| `compile --draft-change <slug>` | cria `changes/NNNN-<slug>/proposal.md` a partir do diff atual, com `origin: code-first` e seção Motivo vazia |
| `ir` | imprime a IR canônica (depuração) |
| `verify <NNNN>` | ver §8 |

### 6.5 Lint da saída (avisos no `--report`, erro no `--check` quando marcado como ✱)

- ✱ frontmatter conforme a especificação: `name` = pasta, regex, ≤64; `description` 1–1024.
- ✱ `SKILL.md` ≤ 500 linhas; referências a no máximo um nível de profundidade.
- orçamento de ≈tokens: metadados ~100, corpo < 5000.
- regra de domínio sem nenhum teste com `covers` (ver §8).

---

## 7. Changes: histórico e propostas

### 7.1 Diff semântico

Comparando IR atual com `domain.lock.json`, por ID de elemento:

- **ADDED** — ID novo; **REMOVED** — ID sumiu; **MODIFIED** — mesmo ID, hash do conteúdo canônico diferente.
- O hash de conteúdo **exclui `source`** (`arquivo:linha` é metadado de localização): formatar o código ou mover um decorator de linha não gera diff de domínio, só atualiza os caminhos nos arquivos gerados.
- Classificação de cada item:
  - `breaking` — contrato de tool muda de forma incompatível para quem chama: use-case removido/renomeado; campo de input adicionado como obrigatório, removido ou com tipo alterado; campo de output removido ou com tipo alterado; transição removida;
  - `behavioral` — regra de negócio muda sem quebrar o contrato: invariante adicionada/modificada/removida; transição adicionada; `emits` alterado; allowlist ou aprovação de operator alterada;
  - `docs` — só descrições/`whenToUse` mudaram. **Não exige proposta**: o `compile` aplica direto no lock e o item aparece no `--diff`, mas não entra no histórico (reescrever uma descrição não é mudança de regra).

### 7.2 Formato da proposta

`changes/NNNN-<slug>/proposal.md` (NNNN sequencial de 4 dígitos; slug kebab-case):

```markdown
---
id: "0002"
title: Cancelamento exige motivo
status: proposed            # proposed | applied
origin: proposal-first      # proposal-first | code-first
delta:
  added:
    - invariant:Order/cancelamento-exige-motivo
  modified:
    - usecase:cancel_order
  removed: []
acceptance:
  - id: rejeita-cancelamento-sem-motivo
    covers: [invariant:Order/cancelamento-exige-motivo]
    given: pedido pendente
    when: cancelar sem informar motivo
    then: falha com CancellationReasonRequired e nenhum OrderCancelled é emitido
  - id: revisao-de-copy
    manual: true
    then: mensagem de erro revisada pelo time de produto
---

## Motivo

(obrigatório, texto livre — o "porquê" que o compilador não consegue inferir)
```

### 7.3 Ciclo

- **Criação / code-first:** sem lock ou com diff não coberto, `compile --check` falha e sugere `compile --draft-change`. O rascunho traz o delta preenchido; a pessoa ou o agente preenche Motivo e critérios.
- **Manutenção / proposal-first:** a proposta é escrita antes do código, com `delta` e `acceptance`. O código é implementado.
- **Reconciliação no `compile`:**
  - conjunto de IDs do diff real **igual** ao `delta` da proposta aberta → `status: applied`, pasta movida para `changes/archive/`, lock atualizado, `history.md` regenerado;
  - diferente → divergências listadas (ID no delta sem mudança no código; mudança no código fora do delta). O `compile` **continua renderizando** skills, `AGENTS.md` e `ir-hash` a partir da IR atual (o app e os testes rodam durante o TDD), mas **não** atualiza o lock nem arquiva a proposta, e sai com exit 0 mais aviso; o `--check` falha até reconciliar.
- **Regra do lock:** o lock só muda por reconciliação (ou por diff exclusivamente `docs`). Diff `breaking`/`behavioral` sem proposta segue a mesma regra acima: renderiza, não atualiza o lock, `--check` falha e sugere `--draft-change`.
- **Restrições do v0:**
  - no máximo **uma** proposta com `status: proposed` por vez (mais de uma = erro);
  - Motivo vazio = erro;
  - proposta aplicada é imutável (edição detectada pelo `--check` comparando com o hash registrado no lock);
  - proposta e implementação vão **no mesmo PR**: uma proposta sozinha (diff de código vazio) não reconcilia e o `--check` falha.
- **`history.md`** por entidade: lista cronológica (por NNNN) dos changes que tocaram aquela entidade e seus elementos — id, título, classificação, Motivo resumido (primeiro parágrafo) e link para a proposta arquivada.

---

## 8. Rastreabilidade de testes e `verify`

### 8.1 `covers`

Um teste declara as regras e critérios que cobre **no próprio nome**, via helper de `@agentic-ddd/testing`:

```ts
test(covers(['invariant:Order/cancelamento-exige-motivo', 'criterion:0002/rejeita-cancelamento-sem-motivo'],
            'rejeita cancelamento sem motivo'), () => { … });
// nome resultante: "[covers: criterion:0002/rejeita-cancelamento-sem-motivo, invariant:Order/cancelamento-exige-motivo] rejeita cancelamento sem motivo"
```

O `verify` roda `bun test --reporter=junit --reporter-outfile=<tmp>` e extrai os IDs dos nomes dos `testcase` (verificado: o JUnit do Bun preserva nome, arquivo e linha). IDs desconhecidos em `covers` = falha do gate G3/G4.

### 8.2 Gates

`agentic-ddd verify <NNNN>` (procura a proposta em `changes/` e em `changes/archive/`):

| Gate | Passa quando |
|---|---|
| G1 Delta | o diff real da IR é igual ao `delta` da proposta (ou a proposta já está `applied` e o lock bate) |
| G2 Docs | `compile --check` limpo |
| G3 Critérios | todo critério não-manual tem ≥1 teste com `covers` do seu ID **e** todos esses testes passaram |
| G4 Regras | toda regra ADDED/MODIFIED do delta tem ≥1 teste que a cobre e passou; testes de regras MODIFIED são listados como "revisar" (aviso) |
| G5 Qualidade | os comandos `verify.commands` (typecheck, lint, test) saem com 0; o teste de arquitetura está incluído na suíte |
| G6 Manual | critérios `manual: true` listados como pendentes |

Saída: JSON em stdout `{ change, status, gates: [{ id, status, findings: [{ message, fix, source? }] }] }` e exit code:

- `done` (0) — G1–G5 passam e não há critério manual;
- `needs-human` (0) — G1–G5 passam e há critérios manuais;
- `failed` (1) — qualquer gate G1–G5 falhou. Cada finding traz uma ação concreta (ex.: `"crie um teste com covers(['criterion:0002/rejeita-cancelamento-sem-motivo'], …)"`).

---

## 9. Runtime (`src/runtime`)

### 9.1 `LlmPort`

```ts
interface LlmPort {
  complete(req: LlmRequest): Promise<LlmResponse>;
}
type LlmRequest = {
  model: string;                       // chave lógica ('default'), resolvida pelo adapter
  system: string;
  messages: LlmMessage[];
  tools: { name: string; description: string; inputSchema: JsonSchema }[];
  toolChoice: 'auto' | 'none';         // sem 'any'/'tool': modelos atuais rejeitam forçar tool
};
type LlmMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; content: AssistantBlock[]; providerPayload?: unknown }  // devolvido intacto no turno seguinte
  | { role: 'tool'; results: { toolCallId: string; content: unknown; isError: boolean }[] };
type AssistantBlock = { type: 'text'; text: string } | { type: 'tool_call'; id: string; name: string; input: unknown };
type LlmResponse = { content: AssistantBlock[]; stopReason: 'end' | 'tool_calls' | 'max_tokens' | 'refusal'; providerPayload?: unknown };
```

`providerPayload` existe para que adapters futuros preservem conteúdo nativo (ex.: blocos de raciocínio que precisam voltar inalterados). Todos os resultados de tool de um turno voltam numa única mensagem `tool`.

### 9.2 `FakeLlm` (`@agentic-ddd/testing`)

Roteirizável e determinístico: recebe uma lista de respostas (ou funções `req => LlmResponse`) consumidas em ordem; registra cada `LlmRequest` recebido para asserções (ex.: o `system` contém o corpo da skill gerada; as tools são exatamente a allowlist). Esgotar o roteiro = erro explícito do fake.

### 9.3 Montagem do operator

- Ao registrar um operator, o runtime lê `.agentic/runtime/<operator>/SKILL.md` e compara `metadata.agentic-ddd.ir-hash` com o hash da IR do registry em memória; divergente ou ausente → erro de inicialização ("rode `agentic-ddd compile`").
- Prompt de sistema = `instructions` + corpo do SKILL.md de runtime.
- Tools = use-cases da allowlist, com `description` composta (propósito + quando usar/não usar) e `inputSchema` da IR.

### 9.4 Loop

`run(operator, { message, context? })`:

1. Monta a requisição e chama `LlmPort.complete`.
2. Para cada `tool_call`, em ordem:
   - tool fora da allowlist → resultado de erro `unknown_tool`;
   - input inválido no Zod → erro `invalid_input` com os issues do Zod;
   - política de aprovação: `allow` executa; `require_approval` chama `ApprovalPort.request({ operator, runId, useCase, input })` e só executa se aprovado; negado → erro `approval_denied` com o motivo;
   - executa o use-case com `ctx` (`correlationId = runId`, `causationId = id do passo`);
   - `DomainError` → erro `{ code, message }`;
   - sucesso → `{ output, events: [{ name, payload }] }` (eventos publicados durante essa execução);
   - output que não valida no schema de saída → o run termina `failed` (bug do use-case).
3. Devolve todos os resultados numa mensagem `tool` e repete.

### 9.5 Término

| Situação | Resultado |
|---|---|
| resposta sem `tool_call` (`stopReason: end`) | `completed` com o texto final |
| `maxSteps` atingido (passo = uma chamada ao LLM) | `step_limit` |
| `timeoutMs` estourado | `timeout` |
| `stopReason: max_tokens` | `failed` (`reason: max_tokens`) |
| `stopReason: refusal` | `failed` (`reason: refused`) |
| erro lançado pelo `LlmPort` | `failed` (`reason: provider_error`) |
| exceção que não é `DomainError` dentro do use-case, ou output inválido | `failed` (`reason: use_case_error`) — não deixamos o modelo improvisar em cima de bug |
| `unknown_tool`, `invalid_input`, `approval_denied`, `DomainError` | **não termina**: vira `tool_result` com `isError: true` |

`OperatorRunResult = { runId, operator, status, reason?, output?, steps: Step[], events: DomainEvent[] }`, onde cada `Step` registra a requisição resumida, a resposta, as chamadas de tool, a decisão de aprovação e os eventos daquele passo.

### 9.6 Ports auxiliares

- `ApprovalPort.request(req): Promise<{ approved: boolean; reason?: string }>` — fake configurável (aprova tudo / nega tudo / função).
- `EventBus` — `publish(events)`, `subscribe(handler)`; adapter in-memory com ordem de entrega determinística (ordem de publicação).

---

## 10. Integração Nest (`src/nestjs`)

- `AgenticModule.forRoot({ llm, approval?, eventBus?, runtimeDir? })` registra os ports (providers com tokens) e o `OperatorRuntime`.
- `AgenticModule.forFeature({ operators, useCases })` registra operators e use-cases do módulo.
- Use-cases e domínio **não importam Nest**: o módulo do exemplo (`orders.module.ts`, camada de composição) cria os use-cases com `useFactory`, injetando os repositories.
- `OperatorRuntime.run(name, input)` é a porta de entrada para qualquer canal (teste, CLI; HTTP no v0.1).
- `main.ts` continua com `BunAdapter`, sem controllers.

---

## 11. Exemplo `examples/orders`

- **Estados:** `pending`, `confirmed`, `cancelled`.
- **Métodos:** `Order.create` (fábrica, emite `OrderCreated`); `confirm` (`pending → confirmed`, emite `OrderConfirmed`); `cancel` (`pending|confirmed → cancelled`, emite `OrderCancelled`).
- **Invariantes:** `total-nao-negativo`, `ao-menos-um-item`.
- **Use-cases:** `create_order`, `confirm_order`, `cancel_order`.
- **Operator:** `order-operator` com os três use-cases; `cancel_order` em `requiresApproval`.
- **Infra:** `InMemoryOrderRepository`.
- **Changes de exemplo:**
  - `0001-estado-inicial` (code-first, gerado por `--draft-change`), arquivado;
  - `0002-cancelamento-exige-motivo` (proposal-first): `cancel_order` ganha `reason` obrigatório (**breaking**) + invariante `cancelamento-exige-motivo` (**behavioral**) + critério de aceite; usado no e2e de manutenção.

---

## 12. Estratégia de testes

### 12.1 Camada 1 — compilador determinístico (CI)

- Golden/snapshot (`toMatchSnapshot`) da IR e de cada arquivo renderizado, por fixture.
- Idempotência: compilar duas vezes produz bytes idênticos.
- Independência de ordem: construir o registry **programaticamente** com os registros inseridos em ordem embaralhada produz a mesma IR e a mesma saída (reimportar módulos ESM em outra ordem não funciona por causa do cache de módulos, e os decorators só rodam uma vez).
- Os golden das fixtures compilam pelo **CLI em subprocesso** (`bun src/cli/main.ts compile` sobre a fixture), testando também o ponto de entrada real.
- Fidelidade: todo elemento do registry aparece na IR e em ao menos uma skill; o JSON Schema gerado aceita e rejeita as mesmas amostras que o Zod.
- Uma fixture por regra de validação, verificando mensagem e `arquivo:linha`.
- `--check` detecta edição manual em arquivo gerado e no bloco do `AGENTS.md` (e ignora o texto fora do bloco).
- Diff e reconciliação: fixtures antes/depois para ADDED/MODIFIED/REMOVED, classificação breaking/behavioral/docs, proposta que bate, proposta que diverge, duas propostas abertas.
- `verify`: proposta com tudo coberto (`done`), com critério manual (`needs-human`), sem teste (`failed` com finding acionável).

### 12.2 Domínio e runtime

- Unitários do `core` e do exemplo (invariantes, transições, eventos), com `covers`.
- Runtime com `FakeLlm`: cada linha da tabela de término (§9.5) tem um teste.
- Teste de arquitetura: regras de dependência da §3, por varredura de imports.

### 12.3 Camada 2 — consistência entre LLMs (formato no v0, runner no v0.1)

`evals/skills/*.yaml`, 3 a 5 perguntas sobre o exemplo, com resposta verificável:

```yaml
- id: confirmar-pedido
  audience: runtime
  question: "Qual tool confirma o pedido 7f…, e com quais argumentos?"
  expect: { type: tool_call, name: confirm_order, input: { order_id: "7f…" } }
- id: onde-criar-use-case
  audience: dev
  question: "Em que caminho e com qual decorator crio o use-case RefundOrder?"
  expect: { type: exact, value: "examples/orders/application/refund-order.ts @AgentUseCase" }
```

Correção determinística (sem LLM-juiz). Métricas previstas para o runner: acurácia por modelo, concordância entre modelos (percentual e Fleiss' κ), tokens lidos.

---

## 13. Escopo

### 13.1 Entra no v0

Higiene do repo (Vitest → `bun test`; remover supertest, `@nestjs/platform-express`, `vite-tsconfig-paths`, `AppController`, `AppService`, `test/app.e2e-spec.ts`; `LICENSE` MIT e `"license": "MIT"`; aliases), §4 a §12.2, formato da §12.3, README (visão, conceito, quickstart, roadmap), CONTRIBUTING curto, `.gitattributes`, CI (lint, typecheck, test, build, `compile --check`).

### 13.2 Fora do v0

| Item | Destino |
|---|---|
| `reactsTo` | v0.1 (§14.2) |
| Testes de contrato gerados da máquina de estados | v0.1 |
| Runner da camada 2 (CLIs leitores `claude -p`, `codex exec`…) | v0.1 |
| Canal HTTP genérico `POST /operators/:name/runs` | v0.1 |
| Mais de uma proposta aberta simultânea | v0.1 |
| Adapter real de LLM | fase de infraestrutura |
| TypeORM + driver (sugestão: `sqljs`, validado no Bun 1.4.2) | fase de infraestrutura |
| Aprovação durável (pausar/retomar), políticas dinâmicas | depois |
| Multi-agente, memória/RAG, UI, auth/multi-tenancy, publicação npm | depois |

---

## 14. Roadmap

### 14.1 v0.1

`reactsTo`; testes de contrato gerados; runner da camada 2; canal HTTP; múltiplas propostas abertas.

### 14.2 Design registrado de `reactsTo`

- `@Operator({ reactsTo: [OrderCreated] })`; o runtime assina esses eventos no `EventBus`.
- Ao receber um evento, **enfileira** (nunca aninha) um run com `trigger: { type: 'event', event }`.
- Proteção contra cascata: profundidade máxima pela cadeia de `causationId` (default 3); por padrão um operator não reage a eventos causados pelo próprio run.
- `bus.drain()` em testes processa a fila até esvaziar, de forma determinística.
- A skill de runtime documenta os eventos que disparam o operator.

---

## 15. Critérios de aceite do v0

1. `bun run build`, `bun run lint`, `bun test` e `agentic-ddd compile --check` passam no CI.
2. **E2E runtime:** `compile` gera a skill do `order-operator` → o runtime a carrega (hash confere) e a usa no prompt de sistema → o `FakeLlm` chama `confirm_order` → status `completed` e `OrderConfirmed` presente em `OperatorRunResult.events` e no bus.
3. **E2E aprovação:** `cancel_order` com `ApprovalPort` negando → o modelo recebe `approval_denied` e nenhum `OrderCancelled` é emitido.
4. **E2E manutenção:** proposta `0002` → código implementado → `compile` reconcilia e arquiva → `verify 0002` retorna `needs-human` (o critério manual `revisao-de-copy` fica pendente); a mesma proposta sem o teste do critério retorna `failed` com finding acionável.
5. Snapshots provam que as skills descrevem fielmente métodos, invariantes, transições e eventos; idempotência e independência de ordem passam.
6. Nenhum `@Controller` no repositório.
7. Teste de arquitetura (§3) passa.
8. O `AGENTS.md` indica caminho e decorator para criar um novo use-case; verificado por revisão manual e pelo dataset da camada 2 (versionado para o runner do v0.1).

---

## 16. Referências que embasaram o design

- Hsieh et al., *Tool Documentation Enables Zero-Shot Tool-Usage with LLMs* — arXiv:2308.00675.
- Yuan et al., *EASYTOOL: Enhancing LLM-based Agents with Concise Tool Instruction* — arXiv:2401.06201.
- *Model Context Protocol (MCP) Tool Descriptions Are Smelly!* — arXiv:2602.14878.
- *From Docs to Descriptions: Smell-Aware Evaluation of MCP Server Descriptions* — arXiv:2602.18914.
- *Understanding and Measuring MCP Behavior under Misleading Tool Descriptions* — arXiv:2602.03580.
- Gloaguen et al., *Evaluating AGENTS.md* — arXiv:2602.11988.
- Lulla et al., *On the Impact of AGENTS.md Files on the Efficiency of AI Coding Agents* — arXiv:2601.20404.
- *Instruction Adherence in Coding Agent Configuration Files: A Factorial Study* — arXiv:2605.10039.
- Sclar et al., *Quantifying Language Models' Sensitivity to Spurious Features in Prompt Design* (FormatSpread) — arXiv:2310.11324.
- Anthropic, *Equipping agents for the real world with Agent Skills* e *Writing effective tools for agents*.
- Especificação Agent Skills — https://agentskills.io/specification.
- Prior art comparado: `irzix/nestjs-agentic` (runtime governado, sem DDD/compilador), `@rekog/mcp-nest`, Laravel AI SDK, Laravel Boost, OpenSpec (changes com delta ADDED/MODIFIED/REMOVED), Changesets.
