# #0001 — Inicialização do `nestjs-agentic-ddd-architecture`

## 1. Contexto

Estamos iniciando um **framework open-source** sobre NestJS que combina **DDD** com **agentes de IA**, inspirado no Laravel AI SDK / Laravel Agents. A tese central:

> Use-cases, entidades e tools do domínio se **autodeclaram** (com prompts e metadados). Um **compilador** lê essas declarações e gera, automaticamente, **skills nativas** que os agentes de IA conseguem ler e executar. O agente passa a ser o **coordenador** dinâmico dos use-cases, no papel que o controller teria numa aplicação tradicional: **não há controllers; há `operators/`**, onde cada operator é a definição de um agente de IA (instruções, tools/use-cases permitidos, guardrails).
>
> A mesma estrutura serve como **autodocumentação progressiva** para agentes que *desenvolvem* o projeto (Claude Code e similares): ao implementar ou manter código, eles descobrem o domínio lendo o que o compilador gera, em camadas, sem precisar varrer o código-fonte.

O repositório hoje é um scaffold NestJS limpo (NestJS 12, Bun, Vitest, oxlint, Prettier, ESM). Não existe nenhuma lógica de domínio ainda.

## 2. Objetivo desta tarefa

> **Nota (2026-10-06):** escopo, estrutura (seção 4), entregáveis (5), fora de escopo (6) e critérios de aceite (7) foram revisados na [spec do v0](../docs/superpowers/specs/2026-10-06-agentic-ddd-v0-design.md). Este texto é mantido como registro histórico.

Entregar o **esqueleto arquitetural e um vertical slice mínimo funcional**, não o framework completo. Ao final devemos conseguir demonstrar o fluxo ponta a ponta com **um único exemplo de domínio**:

```
Entidade/UseCase decorados → Compilador → skill gerada (SKILL.md + schema) → Agente descobre e executa o use-case → eventos de domínio emitidos
```

## 3. Conceitos centrais

### 3.1 Use-case como tool
- Um use-case é uma classe com entrada/saída tipadas (schema) e é **simultaneamente** invocável por código e exposto como *tool* para o agente.
- O agente de IA substitui o controller como orquestrador: decide **quais** use-cases chamar e **em que ordem**, dentro do que o domínio permite.
- Cada use-case declara: nome, descrição para o LLM (prompt), schema de input/output, pré-condições, efeitos colaterais e eventos que emite.

### 3.2 Entidades e Value Objects autodeclarativos
- Decorators/metadados na própria classe descrevem: propósito, invariantes, regras de negócio, restrições, estados válidos e transições, requisitos e métodos expostos.
- Os prompts ficam **colados à entidade**, para que regra e descrição nunca divirjam.
- Exemplo do formato desejado (a definir no design):
  ```ts
  @AgentEntity({ description: 'Pedido de compra de um cliente' })
  class Order extends AggregateRoot {
    @Invariant('O total nunca pode ser negativo')
    @AgentMethod({ description: 'Confirma o pedido', emits: [OrderConfirmed] })
    confirm() { /* ... */ }
  }
  ```

### 3.3 Compilador de entidades
- Percorre as classes decoradas (reflection/AST) e produz um **descritivo estruturado** (IR intermediária em JSON) com métodos, invariantes, regras, requisitos, eventos e relacionamentos.
- A partir da IR, gera **skills nativas** (formato padrão do skill-creator: `SKILL.md` + frontmatter + `references/`) para o agente ler.
- Deve ser **determinístico e idempotente** (mesma entrada → mesma saída), rodando via CLI (`build`/`watch`) e também programaticamente.
- Falha de compilação se uma regra/invariante estiver sem descrição (a documentação para o agente não pode ficar parcial).

### 3.4 Operators (o agente como controller)
- Pasta `operators/` substitui `controllers/`. Cada operator é uma classe declarativa (`@Operator`) que define: papel e instruções (prompt de sistema), use-cases que pode invocar (allowlist), eventos a que reage, limites (ex.: máx. de passos, confirmação humana para use-cases sensíveis) e modelo/provider.
- O operator só enxerga tools derivadas de use-cases: não toca em repositório nem entidade diretamente.
- Os operators também são compilados: cada um gera sua skill descrevendo o que opera, com quais tools e sob quais restrições.
- Exemplo do formato desejado (a definir no design):
  ```ts
  @Operator({
    name: 'order-operator',
    instructions: 'Você opera o ciclo de vida de pedidos...',
    useCases: [CreateOrder, ConfirmOrder, CancelOrder],
    requiresApproval: [CancelOrder],
  })
  export class OrderOperator {}
  ```
- Um canal de entrada (HTTP, fila, evento, CLI) apenas entrega a intenção/mensagem ao operator; não contém lógica de negócio.

### 3.5 Camada agêntica (runtime)
- Runtime de agente com: registro de tools (derivadas dos use-cases), carregamento das skills geradas, loop de execução e guardrails.
- **Abstração de provider de LLM** (interface/port), sem acoplar a um fornecedor. Entregar um adapter inicial (a decidir) e um **fake/mock** para testes determinísticos.
- Toda chamada do agente a um use-case passa por validação de schema e pelas invariantes do domínio. O agente nunca altera estado fora dos use-cases.

### 3.6 Autodocumentação progressiva (para agentes que desenvolvem o código)
Objetivo: um agente de código novo no repositório chega ao contexto certo com o mínimo de leitura, seguindo **divulgação progressiva** (*progressive disclosure*):

1. **Nível 0 — índice:** `AGENTS.md` (e `CLAUDE.md` apontando para ele), gerado/atualizado pelo compilador, com visão geral, convenções e o mapa dos bounded contexts, operators e skills.
2. **Nível 1 — skill por módulo/operator:** `SKILL.md` com `name` + `description` (quando usar) e resumo de entidades, use-cases, eventos e invariantes.
3. **Nível 2 — referências:** `references/` com detalhe sob demanda (schemas JSON, tabela de transições de estado, regras de negócio completas).
4. **Nível 3 — código-fonte:** só quando necessário, já sabendo exatamente onde olhar (a skill referencia caminho do arquivo).

Requisitos:
- Uma única fonte de verdade: o código decorado. Docs geradas nunca são editadas à mão; o CI falha se estiverem desatualizadas (`compile --check`).
- A skill orienta também **como estender**: onde criar um novo use-case/entidade/operator e quais decorators obrigatórios usar (convenção que o próprio compilador valida).
- Skills de runtime (agente operando) e skills de desenvolvimento (agente implementando) saem do mesmo compilador, com público declarado no frontmatter/descrição.

### 3.7 Arquitetura orientada a eventos
- Entidades (aggregate roots) acumulam **eventos de domínio**; a camada de aplicação os publica após persistir.
- Eventos são também *observáveis* pelo agente (para reagir/encadear fluxos) e entram na skill gerada.
- Persistência atrás de um **repository port**, implementada com TypeORM (ver decisões tomadas).

## 4. Arquitetura e estrutura proposta

Monorepo/pacote único com separação clara de camadas (a validar):

```
src/
  core/            # building blocks DDD: AggregateRoot, Entity, ValueObject, DomainEvent, UseCase
  agentic/
    decorators/    # @AgentEntity, @AgentMethod, @Invariant, @AgentUseCase ...
    compiler/      # reflection → IR → gerador de skills
    runtime/       # agente, registro de tools, loop, guardrails
    providers/     # port de LLM + adapters (fake, ...)
  modules/
    <exemplo>/
      domain/          # entidades, VOs, eventos, ports
      application/     # use-cases (tools)
      operators/       # agentes de IA do módulo (substitui controllers)
      infrastructure/  # TypeORM schemas, mappers, adapters
skills/            # saída gerada pelo compilador (gitignored ou versionada, a decidir)
AGENTS.md          # índice nível 0, gerado pelo compilador
docs/              # ADRs e guias
prompts/           # histórico de prompts de planejamento
```

Dependências apontam sempre para dentro (domain não conhece NestJS nem LLM). Integração com Nest via módulo dinâmico (`AgenticModule.forRoot()`).

## 5. Entregáveis

1. **ADR-0001** com as decisões de arquitetura e os trade-offs (em `docs/adr/`).
2. **`core/`** com os building blocks DDD, testados.
3. **Decorators + metadata** de entidade, método, invariante, use-case e `@Operator`.
4. **Compilador v0**: IR em JSON + geração de `SKILL.md` (entidades, use-cases, operators) e do `AGENTS.md`, com **snapshot tests** e modo `--check`.
5. **Runtime v0**: operators carregam suas tools a partir dos use-cases + execução com provider fake.
6. **Módulo de exemplo** (sugestão: `Order` com `create`/`confirm`/`cancel` e um `OrderOperator`) cobrindo o fluxo completo.
7. **README** reescrito: visão, conceito, quickstart e roadmap.
8. Repositório pronto para open-source: licença MIT, `CONTRIBUTING.md`, CI (lint + test + build).

## 6. Fora de escopo (por ora)

Multi-agente complexo, UI, autenticação/multi-tenancy, múltiplos adapters de LLM, memória/RAG, publicação em npm.

## 7. Critérios de aceite

- `bun run build`, `bun run lint` e `bun run test` passam sem erros.
- Um teste e2e demonstra: o compilador gera a skill do exemplo → o runtime a carrega → o agente fake executa o use-case → o evento de domínio é emitido.
- A skill gerada descreve fielmente métodos, invariantes e eventos da entidade (verificado por snapshot).
- Não existe nenhum controller no exemplo: a entrada é um operator.
- O `AGENTS.md` e as skills geradas permitem a um agente de código, partindo só do `AGENTS.md`, localizar onde adicionar um novo use-case (verificado por revisão manual no v0; critério objetivo: `compile --check` passa no CI).
- O domínio não importa nada de `@nestjs/*` nem de provider de LLM (verificado por regra de lint ou teste de arquitetura).

## 8. Decisões tomadas

| Tema | Decisão |
|---|---|
| Persistência | **TypeORM** (`typeorm` + `@nestjs/typeorm` já instalados), atrás de repository ports. A entidade de domínio **não** carrega decorators do TypeORM: o mapeamento fica na infraestrutura (`EntitySchema` + mappers), para não inflar a complexidade da entidade. |
| Schemas | **Zod** (v4, já instalado). Os schemas de input/output dos use-cases geram o JSON Schema das tools. |
| Metadados | **Decorators** + `reflect-metadata`. |
| Formato da skill | Padrão do **skill-creator**: pasta `<nome-da-skill>/SKILL.md` com frontmatter YAML (`name`, `description` dizendo *o que faz e quando usar*), corpo em markdown e recursos opcionais em `references/` (ex.: JSON Schemas) e `scripts/`. As skills geradas devem seguir esse padrão. |
| Runtime HTTP | **Bun** com [`@nestbun/platform`](https://github.com/mguay22/nestbun) (`BunAdapter` sobre `Bun.serve()`, sem Express), já instalado e ligado no `main.ts`. Testes de integração podem usar `adapter.fetch(new Request(...))` em vez de supertest. |
| Licença | **MIT** (adicionar `LICENSE` e `"license": "MIT"` no `package.json`). |

*Decisões abaixo tomadas no brainstorming de 2026-10-06 — detalhes em [`docs/adr/ADR-0001.md`](../docs/adr/ADR-0001.md) e na [spec do v0](../docs/superpowers/specs/2026-10-06-agentic-ddd-v0-design.md).*

| Tema | Decisão |
|---|---|
| Banco no v0 | Somente repository **in-memory**. TypeORM entra na fase de infraestrutura (driver sugerido: `sqljs`, validado no Bun). |
| Test runner | **`bun test`** no lugar do Vitest. |
| Provider de LLM | Somente **port + fake** no v0; adapter real depois. Port com payload opaco do provider e `toolChoice` só `auto`/`none`. |
| Pacotes | **Pacote único** com fronteiras internas; exemplo em `examples/orders`; escopo **`@agentic-ddd`** (`@nestjs-agentic` está ocupado). |
| Skills geradas | **Versionadas**, com cabeçalho de gerado, `linguist-generated`, saída determinística e `compile --check` no CI. |
| Compilador | Reflection em runtime: registry → IR → validação → diff → renderers; `arquivo:linha` via stack; `z.toJSONSchema()`. IR versionada em `.agentic/domain.lock.json`. |
| Histórico | **Changes** (`changes/NNNN-slug/proposal.md`) com delta ADDED/MODIFIED/REMOVED; criação code-first, manutenção proposal-first. |
| Testes do domínio | Rastreabilidade por ID de regra (`[covers: …]`). |
| Conclusão de tarefa | Critérios de aceite estruturados na proposta + `agentic-ddd verify`. |
| Aprovação humana | `requiresApproval` declarativo → política interna → `ApprovalPort` síncrono. |
| Eventos × operator | Emissão + eventos no `tool_result`; `reactsTo` fica para o v0.1. |
| Local dos gerados | Bloco gerado no `AGENTS.md`; `.agents/skills/` (+ espelho `.claude/skills/`); `.agentic/`; `changes/`. |
| Declaração primeiro | A pessoa decora o esqueleto (corpos `notImplemented()`); o compilador lista as pendências na skill de dev e o agente de código implementa até o `verify` passar. |

## 9. Decisões abertas

Todas resolvidas em 2026-10-06 (ver seção 8 e ADR-0001). O escopo do v0 (seções 2, 5, 6 e 7) foi revisado na [spec](../docs/superpowers/specs/2026-10-06-agentic-ddd-v0-design.md), §13 e §15, que prevalecem sobre este prompt.

## 10. Como proceder

1. Explore o repositório atual e confirme o ponto de partida.
2. Conduza o brainstorming das **decisões abertas** (seção 9), uma pergunta por vez, com recomendação.
3. Registre as decisões no ADR-0001.
4. Só então gere o plano de implementação em etapas pequenas, TDD, com commits atômicos.
