# Mapa de integração no repositório: workflow de AGENTS.md/briefs por tarefa, em camadas de modelo (Haiku / Sonnet / Opus)

Escopo: análise local de `/home/user/nestjs-agentic-ddd-architecture` (HEAD `b5d70e2`, release v0.4.0). Nenhum arquivo do repo foi alterado; medições de packet foram feitas em cópia (`git archive`) no scratchpad. "Fonte" nas citações abaixo é sempre caminho de arquivo (e linha quando relevante), não URL. Tokens são estimados como bytes/4, a mesma heurística do repo (`src/compiler/lint.ts:12`, `approxTokens`).

## 1. Como funciona hoje o split gerente/executor, o packet com spec hash e o gate de verify? Há modelo declarado em algum lugar?

### Takeaway
O repo já implementa, de forma determinística, quase tudo que o workflow proposto precisa: grafo de work items, ondas (`next`), packet por item com `specHash`, e `verify --item` com hash original. O papel "executor barato (Haiku)" é intenção declarada no design (spec §8.3, ADR D16), mas **nenhum adaptador declara modelo**: todos instalam `model: inherit`, e as avaliações reais usaram só Codex/Cursor, nunca Claude/Haiku.

### Cited Findings

**Intenção de design (modelo por papel)**
- A spec define gerente = "pessoa ou modelo forte, ex.: Opus/Sonnet" e executor = "modelo barato, ex.: Haiku" que "recebe só o pacote" e devolve findings sem alterar a especificação. Fonte: `docs/superpowers/specs/2026-10-06-agentic-ddd-v0-design.md:22`, `:33-35`, `:414-417`.
- A spec previa `.claude/agents/agentic-ddd-executor.md` **com `model: haiku`** e validação "medindo um executor barato (ex.: Haiku) implementando o exemplo a partir dos pacotes". Fonte: mesma spec `:584`, `:597`. O ADR-0001 D16 repete: "permite gerente forte (Opus/Sonnet) e executor barato (Haiku) sem que o executor altere a especificação". Fonte: `docs/adr/ADR-0001.md:33`.
- A decisão efetivamente implementada no Plano 5 foi o oposto: "modelo herdado e instruções de papel compartilhadas". Fonte: `docs/superpowers/specs/2026-10-08-v0-05-agent-skills-design.md:47` (parágrafo "Instalador"/"Cursor/Codex...").

**Onde o modelo é (não) declarado**
- `scripts/install-skills.ts:56` gera o frontmatter com `model: inherit` fixo para Cursor e Claude; o TOML do Codex omite `model`/`model_reasoning_effort` (herda a sessão). `DESCRIPTIONS` em `:21-26` é fixo por papel (manager/executor).
- `test/skills-install.test.ts:65` **afirma** `expect(fm.model).toBe('inherit')`: mudar o instalador exige mudar este teste.
- Adaptadores instalados no checkout: `.claude/agents/agentic-ddd-{executor,manager}.md` (frontmatter `name`, `description`, `model: inherit`, `skills: [agentic-ddd]`), `.cursor/agents/*.md` (sem `skills`), `.codex/agents/*.toml`. O corpo é uma instrução genérica de ~600 bytes que só aponta para `SKILL.md` e `references/{manager,executor}.md`.
- Busca por `haiku|opus|sonnet` fora de `docs/superpowers/validation/` só acha spec, ADR e o prompt original `prompts/#0001-initial.md:166`: **não existe nenhuma configuração executável de modelo por tier**.

**Protocolo gerente/executor (fonte autoral)**
- Gerente: `skills/agentic-ddd/references/manager.md` (passos 1-6): escreve proposta antes das declarações, prepara contratos/imports/infra/config, `compile`, `next --change NNNN --json`, `packet <item>`, despacha **um executor por vez** com packet integral + hash original + limites, revisa diff, repete `verify --item`, fecha com `verify NNNN`. Handoff em formato fixo (último parágrafo do arquivo).
- Executor: `skills/agentic-ddd/references/executor.md`: altera só o corpo atribuído e testes; preserva a contagem de linhas do corpo (as coordenadas `source` entram nos gerados); roda o comando exato de `verify --item` com hash original; duas correções sem progresso devolvem ao gerente; não roda `compile`.
- Spec Plano 5: "Gerente ... despacha um executor por vez da primeira onda de `next --change NNNN`"; "Sessão principal pode despachar sem delegação aninhada". Fonte: `docs/superpowers/specs/2026-10-08-v0-05-agent-skills-design.md:48-51`. Ou seja, o paralelismo por onda foi deliberadamente adiado.

**Grafo, ondas, packet, hash, verify (código)**
- Camadas do grafo: `Layer = 'domain' | 'application' | 'operators'` (`src/compiler/graph.ts:4`). Work items: entidade (construção/fábrica estática + invariantes de construção) `:26-39`, um item por método de instância com `dependsOn: [entity.id]` `:40-54`, use-case com `dependsOn` = itens dos métodos em `uses` `:56-67`, operator com `dependsOn` = use-cases `:68-77`. **Infraestrutura fora do grafo** (spec `:13.2` "Infraestrutura no grafo de work items (`@Port`/`@Adapter`) — depois"; ADR D16).
- Estados `declared → implemented → covered → done` + `blocked` em `src/compiler/state.ts:86-93`, cálculo em `:114-185`; ondas = níveis topológicos dos itens não-done em `:211-230`.
- "Implementado" = o corpo não contém a chamada literal `notImplemented()` via `Function.prototype.toString` (`src/compiler/implementation.ts:4-6`); operator é sempre "implementado" (`:33`).
- Packet: `renderPacket` em `src/compiler/packet.ts:15-71`, comando em `src/cli/commands/packet.ts`. Seções (nesta ordem): "Identificação" (ID, camada, módulo, `source` arquivo:linha, estado, `specHash`, dependências), "Especificação" (JSON estável com `declaration` + `contracts`), "Obrigações de teste" (IDs `covers` + critérios Given/When/Then não-manuais de propostas **abertas**), "Regras do executor" (3 bullets fixos), "Comando de verificação" (`bun run agentic verify --item <id> --spec-hash <h> --config <cfg> --json`).
- Conteúdo da especificação por tipo (`src/compiler/item-spec.ts:165-240`): entidade = declaração de construção (fábricas estáticas + invariantes de construção) + eventos emitidos; método = método + entidade (só construção) + invariantes do método + eventos; use-case = declaração + cada método de `uses` + eventos; operator = declaração + cada use-case + métodos + eventos. `withoutSource` (`:128-142`) remove `source` (coordenadas) do hash e do JSON.
- `specHash = sha256(stableStringify(specification))` (`item-spec.ts:242-244`), logo ignora corpos e coordenadas, mas muda com qualquer mudança de declaração/contrato/critério aplicável.
- `verify --item` (`src/compiler/verify/item.ts:16-100`): gates I1 dependências done, I2 corpo não é `notImplemented()`, I3 `specHash` igual ao informado, I4 obrigações com testes `covers` passando, I5 `bun run typecheck` (comando configurável via `verify.commands.typecheck`). Só `done|failed`. CLI: `src/cli/commands/verify.ts` (exige SHA-256 hex em `--spec-hash`).
- **Custo oculto**: `packet`, `status`, `next` e `verify --item` chamam `collectStatus` (`src/compiler/project-state.ts:59-78`), que roda `config.verify.test` (padrão `['bun','test']`, `src/compiler/config.ts:~97`) com reporter JUnit. Medido neste repo (`agentic.config.ts` padrão, suíte inteira do framework): `packet entity:Order` levou **~110 s**; com `verify.test = ['bun','test','examples/orders']` em config de scratchpad levou ~1,2 s. Só `status --static` evita rodar testes (e nunca certifica `done`); `packet` não tem modo estático.

**Tamanho real de packets (medido, `orders`, config escopada)**

| Item | Bytes | ≈ tokens |
|---|---|---|
| `entity:Order` | 2.506 | ~630 |
| `method:Order.cancel` | 3.485 | ~870 |
| `usecase:create_order` | 4.974 | ~1.250 |
| `operator:order-operator` | 12.105 | ~3.030 |

Os snapshots `src/compiler/__snapshots__/packet.test.ts.snap` (16,9 KB para 4 packets do fixture `shop`) confirmam a ordem de grandeza. Cada packet repete, em JSON indentado, a entidade completa e os payloads dos eventos (ex.: `method:Order.cancel` carrega a entidade inteira em `declaration.entity`), então o peso é dominado por JSON de contrato, não por texto.

**Contexto fixo que o executor carrega hoje (além do packet)**
- `AGENTS.md` 3.698 B + `skills/agentic-ddd/SKILL.md` 1.872 B + `references/executor.md` 2.491 B + skill gerada `.agents/skills/orders-dev/SKILL.md` 5.329 B (opcional `references/*` ~6,9 KB) ≈ 13,4 KB ≈ **3,3k tokens**, mais o(s) arquivo(s) de código a editar (`order.ts` 3,6 KB, use-cases 1,5-2,3 KB, testes de referência 3,3-8,5 KB). `executor.md` manda ler "a skill gerada do módulo", que descreve **todas** as entidades, use-cases, operators e a tabela de dependências do módulo (`.agents/skills/orders-dev/SKILL.md`): é exatamente o vazamento de outras camadas que o workflow quer eliminar.
- Para Claude, o adaptador pré-carrega `skills: [agentic-ddd]` (`.claude/agents/agentic-ddd-executor.md`).

**Instruções de repositório que limitam o desenho**
- `AGENTS.md` (raiz) tem bloco gerado entre `<!-- agentic-ddd:begin/end -->` (`src/compiler/render/agents-md.ts:37-50`) com as convenções; `CLAUDE.md` contém só `@AGENTS.md` (`src/compiler/write.ts:~34`, `CLAUDE_MD_CONTENT`). Todo texto fora do bloco é do usuário e preservado.

### Inferences
- Um "AGENTS.md por tarefa" para o executor Haiku é essencialmente uma **recomposição do packet + trechos mínimos do executor.md + (opcional) recorte da skill do módulo**, o que reduz de ~3,3k (fixo) + packet para algo como packet + ~0,8k. A economia relativa é maior em itens de domínio pequenos (entity/method, packet de 0,6-0,9k tokens).
- O gate I3 (`specHash`) já cobre o requisito "executor só conhece o contrato declarado": qualquer brief gerado deve **carregar o hash do packet** e nunca recalculá-lo; o brief é derivado, o packet continua sendo a autoridade.
- Como `packet`/`next` custam uma execução da suíte, um orquestrador que gere N briefs deve usar `verify.test` escopado por módulo (config `verify.test`) ou obter o `status --json` uma vez e gerar os packets em lote (hoje não existe `packet --all`).

### Gaps
- Não há comando que emita todos os packets de uma onda de uma vez nem que emita packet sem rodar testes.
- Nenhum adaptador define `model` por papel; o instalador não aceita parâmetro de modelo (`install-skills.ts` flags: `--scope`, `--target`, `--root`, `--check`).
- O papel "revisor" (Opus) não existe no instalador (só manager/executor). O gerente tem a revisão de diff (`manager.md` passo 5), mas não há papel/agente separado de revisão.
- Não encontrei evidência no repo de execução real com modelos Claude (Haiku/Sonnet/Opus): `docs/superpowers/validation/*` registram só Codex (`gpt-6.1-sol`) e Cursor (`gpt-5.3-codex` etc.). "Claude validado por definições, instalação e referências; execução real adiada" (spec Plano 5, `:58`).

## 2. Como as camadas se organizam e quais contratos já dão uma especificação estreita para um executor barato?

### Takeaway
Os contratos são fortes e determinísticos para **entidades e métodos de domínio** (declaração + `@Invariant` + `covers` + critérios Given/When/Then + `verify --item`), que são as unidades mais isoláveis para Haiku. Faltam três coisas para o recorte do usuário: **value objects não são work items** (só existe a classe base `ValueObject`), **eventos e ports não têm item** (são preparados pelo gerente), e **infraestrutura está fora do grafo**.

### Cited Findings

**Layout de módulo** (`AGENTS.md`, "Convenções"; `skills/agentic-ddd/references/authoring.md`)
- `<módulo>/domain` (entidades, eventos, ports), `<módulo>/application` (use-cases com `uses`), `<módulo>/operators`; infraestrutura/composição "segue o projeto". Em orders: `examples/orders/domain/{order.ts,order.events.ts,order.repository.ts}`, `application/{create,confirm,cancel,load}-order.ts`, `operators/order.operator.ts`, `infrastructure/in-memory-order.repository.ts`, `orders.module.ts`, `test/{order,use-cases,operator}.test.ts`.
- Cada regra é `@Invariant({ id, text })` com ID estável kebab-case (obrigação `invariant:Entidade/id`); método público tem `@AgentMethod({ description, emits, transition })`; auxiliares usam `#privado` (`order.ts:124`, `#ensureStatus`). Ver `examples/orders/domain/order.ts:19-132`.
- Corpo pendente = `return notImplemented();` (`src/core/not-implemented.ts`), o gerente reserva **linhas em branco** após a chamada porque o `source` aparece nos gerados (ver slot no asset `skills/agentic-ddd/assets/tasks/domain/task.ts.txt`: ~14 linhas vazias antes do `}`). O executor deve preservar a contagem de linhas (`executor.md`, 2º bullet).

**Quais unidades podem ir isoladas a um executor barato (com corpos declarados)**
- `entity:Order` (factory `create` + invariantes de construção `ao-menos-um-item`, `total-nao-negativo`): packet de ~630 tokens; precisa só do payload de `OrderCreated` e das assinaturas já preparadas (`order.ts:36-90`).
- `method:Order.confirm`, `method:Order.cancel` (transição `from/to`, `emits`, `@Invariant` do método): `item-spec.ts` entrega a entidade (somente construção), a transição e os eventos; `dependsOn: [entity:Order]` (`graph.ts:40-54`).
- Use-cases (`usecase:create_order` etc.) são `application`: o packet inclui `uses` expandidos (métodos de domínio) e schemas Zod de entrada/saída, então um executor de nível médio recebe contrato de camadas inferiores, mas não precisa ler `domain/`. O corpo usa `OrderRepository` (port) e `ctx.publish(order.pullEvents())` (`examples/orders/application/create-order.ts:51-77`).
- Operators são **declarativos** (`examples/orders/operators/order.operator.ts`): "já implementado; acrescente somente testes" (`executor.md`); packet de ~3k tokens porque inclui todos os use-cases/métodos/eventos.

**Contratos que tornam a spec "Haiku-friendly"**
- Packet determinístico com IDs de obrigação, critérios G/W/T e comando de verificação exato (`packet.ts:44-69`).
- `covers([...ids], título)` (`src/testing/covers.ts`, doc em `AGENTS.md`/`CONTRIBUTING.md:71`) liga testes a IDs; `status` calcula `missingObligations` (`state.ts:133-136`).
- Os gates I4/I5 **não** detectam falso done superficial: I4 só exige que as obrigações declaradas tenham testes `covers` passando e I5 só roda o typecheck. As 19 regressões de `test/evals-run.test.ts:128-268` trocam os testes atribuídos por cobertura `expect(true)`, passam em `verify --item` e só são rejeitadas pelo oráculo privado do runner de avaliação (`docs/superpowers/specs/2026-10-10-evals-19-regressoes-run.md`), que não existe no fluxo de produção.
- Teste de arquitetura: `domain` e `application` do exemplo não importam Nest nem runtime (`test/architecture.test.ts`, teste "domain e application do exemplo não importam Nest nem runtime de LLM"); `src/core` só importa `zod` (`AGENTS.md`; teste logo acima no mesmo arquivo). Isso é um **guard-rail verificável** para um executor de domínio isolado.

**Lacunas de modelagem relevantes ao recorte (a)**
- `ValueObject<P>` existe em `src/core/value-object.ts` (igualdade estrutural, cópia defensiva) mas **não há `@AgentValueObject`/item no grafo**: `grep` por "ValueObject" em `src/compiler`, `src/decorators`, `examples` não retorna uso. Portanto um VO não gera packet, `specHash` nem gate; hoje seria "preparado pelo gerente" ou tratado como código de apoio dentro do item da entidade.
- Eventos (`@AgentEvent`) e ports (`order.repository.ts`, `Repository<Order,string>`) não são work items; aparecem como `contracts` nos packets (eventos) ou ficam fora (ports).
- Infraestrutura (`in-memory-order.repository.ts`, `orders.module.ts`) não é item, sem hash/gate; o gerente "prepara infraestrutura" (`manager.md` passo 1).

### Inferences
- A divisão do usuário mapeia quase 1:1 ao grafo existente: **Haiku = itens `layer: domain`** (entity + method), **Sonnet = `application` + `operators` + infraestrutura/composição + integração**, **Opus = revisão e gerente/spec**. A fronteira "Sonnet integra a saída do Haiku" coincide com a dependência `dependsOn` que já bloqueia use-cases até seus métodos estarem `done` (gate I1).
- Value objects são o ponto onde o workflow precisaria de uma extensão do compilador (novo tipo de item) ou de uma convenção ("VO como parte do item da entidade"). Sem isso, não existe gate para "Haiku implementou o VO".
- O recorte "Haiku não sabe nada de outras camadas" já é respeitado pelo packet de entity/method (só vê entidade + eventos); só é violado por instruções que mandam ler a skill gerada do módulo inteiro.

### Gaps
- Não medi sucesso de Haiku em nenhum item (inexistente no repo, ver §1 Gaps).
- Não verifiquei se `@Invariant` em VO ou serviço de domínio é aceito pelo compilador (`src/decorators/domain.ts`); não há decorator de VO no índice `src/decorators/index.ts` conferido apenas por busca textual.

## 3. Existe harness de avaliação para medir custo em tokens e sucesso por camada de modelo? Convenções de specs/planos/ADRs/changes.

### Takeaway
Existe um harness robusto (`scripts/evals/`, `bun run evals` e `evals:aggregate`) com orçamento, isolamento, auditoria e verificação independente, que já mede `inputTokens/cachedInputTokens/outputTokens/cost` como `Measured<T>` (disponível ou indisponível com motivo). Mas só tem adapters `scripted`, `codex-cli`, `cursor-cli`; **não há adapter Claude** e a política é "nunca estimar tokens". Convenções de documentos são consistentes e todas em português.

### Cited Findings

**Harness**
- Spec do runner: `docs/superpowers/specs/2026-10-08-v0-06-agent-evals-design.md` (35 KB); manifesto JSON estrito `schemaVersion: 1` (`sourceRef`, `skillDatasets`, `benchmark: 'tasks'`, `configurations[]` com `{id, adapter, authentication?, model, parameters.reasoningEffort?}`, `budget`) em `scripts/evals/contracts.ts` (zod). Adapters permitidos: `z.enum(['scripted','codex-cli','cursor-cli'])` em `contracts.ts` (campo `adapter` do `manifestSchema`). "Claude continua adiado" (spec Plano 6, linha 20 da spec); v1 fixa `repetitions`/`concurrency` em 1 e `maxCorrectionsPerItem` em 0|1.
- Interface `EvalAdapter { probe(), run(request, {signal}) }`; `AdapterResult` traz `usage`, `observedModel`, `modelRevision` (`scripts/evals/contracts.ts`, interfaces `Usage`/`AdapterResult`). `nativeUsage` extrai `input_tokens`, `cached_input_tokens`, `output_tokens` do evento nativo (`scripts/evals/adapters/native.ts:~44-58`); **`cost` é sempre `unavailable()`**. Codex preenche usage de `turn.completed` (`adapters/codex.ts:81`); Cursor de `result` (`adapters/cursor.ts:84`).
- Política explícita: "Não estimar consumo por chars/4 nem aplicar tabela de preços"; soma de tokens/custos só quando todos os componentes existem, moedas distintas não somam (spec Plano 6, `:205`; spec #20 `docs/superpowers/specs/2026-10-10-evals-20-agregacao-campanhas.md`). Resultado real: "tokens Codex disponíveis são somados pelas evidências; tokens Cursor incompletos e custos permanecem indisponíveis" (`docs/superpowers/validation/2026-10-10-evals-20/real/README.md:22`).
- O benchmark `tasks` (`scripts/evals/audit.ts:13` `TASK_ITEMS`: `entity:Task`, `method:Task.complete`, `usecase:create_task`, `usecase:complete_task`, `operator:task-operator`, cada um com `file`, `className`, `method`, `test`, `criteria`) usa workspace `skills:example` isolado. O prompt do executor no runner é construído em `scripts/evals/implementation.ts:278-336`: packet integral + root/config + "Edite somente <arquivo> <Classe>.<método> (somente interior do corpo, mesma quantidade de linhas)" + critérios arquivados + "Leia .agents/skills/agentic-ddd/SKILL.md..." + protocolo de resposta JSON. **Isto já é um "brief por tarefa" gerado dinamicamente**, o ponto de partida natural.
- Auditoria de submissão (limite de edição: só corpo/teste) em `scripts/evals/audit.ts` (o `verify` sozinho "não audita o limite de edição", spec Plano 6 linha ~16); verificação final independente em `scripts/evals/final-verification.ts`; relatórios `scripts/evals/report*.ts`; agregação offline `scripts/evals/aggregate.ts` (714 linhas).
- Manifestos: `evals/run.reference.json`, `evals/run.certify.{codex-sol-high,cursor-codex-medium}.json`, `evals/run.offline.json`, campanha `evals/campaigns/cycle-20/{index.json,manifests/*.json}`; datasets `evals/skills/orders{,.extended}.yaml` (compreensão de skills, não de implementação).
- Orçamentos reais já gastos: cycle-20 = 184 sessões/76,8 min (seis runs); "Novas inferências exigem orçamento próprio" (`docs/ROADMAP.md:33`). Qualquer comparação Haiku/Sonnet/Opus exige nova autorização explícita de orçamento (padrão #17/#20: `docs/superpowers/validation/2026-10-10-evals-cycle.md`, seção Decisões).
- Resultados anteriores como baseline: Codex 72/75 perguntas e 3/3 certificações; Cursor 70/75 e 2/3 (`CHANGELOG.md` 0.3.0, `docs/ROADMAP.md:33`). Nenhum com modelo Claude.
- Outro medidor de tokens no repo: `compile --report` imprime `≈tokens` por arquivo gerado (`src/compiler/report.ts:6-29`) e `lintSkill` avisa corpo > 5000 tokens e metadados > ~100 tokens (`src/compiler/lint.ts:60-66`): orçamentos de referência para um AGENTS.md/brief gerado.

**Convenções de documentos (todas em PT-BR)**
- Specs: `docs/superpowers/specs/YYYY-MM-DD-<slug>.md`. Dois estilos: design longo `…-v0-0N-<tema>-design.md` (ex.: `2026-10-08-v0-05-agent-skills-design.md`, `…-package-distribution-design.md`) e contrato curto sem sufixo para issues de ciclo (`2026-10-10-evals-17-certificacao-tasks.md`, ~700 B, termina com "## Restrições"). Specs longas abrem com tabela de metadados (Status/Origem/Decisões/Próximo passo) ou `**Data:** … **Status:** …` + "Refina a issue #N" (`v0-06-agent-evals-design.md:3-5`); seções numeradas "## 1. …".
- Planos: `docs/superpowers/plans/` com mesmo prefixo de data: `YYYY-MM-DD-v0-0N-<tema>.md`, `YYYY-MM-DD-evals-NN-<tema>.md`, `YYYY-MM-DD-package-distribution.md`. Estrutura curta: título `# Plano N — Execução` / `# #17 — Execução`, linha "Spec: [design](../specs/…). Issue: [#N](url)", lista numerada de passos, "## Verificação" ou "## Registro de execução". O plano de distribuição está em inglês com cabeçalho "For agentic workers" (exceção; a convenção dominante é português).
- Índice dos planos: `docs/superpowers/plans/2026-10-06-v0-00-index.md` (tabela #/Plano/Entrega/Critérios/Status).
- Validação/evidências: `docs/superpowers/validation/YYYY-MM-DD-<tema>.md` + pasta homônima (`2026-10-08-plan5/`, `2026-10-10-evals-17/real/README.md`, `…-evals-cycle.md`, manifesto de hashes `…-evals-evidence-manifest.json`).
- ADR: um único, `docs/adr/ADR-0001.md` (`ADR-NNNN.md`, 4 dígitos), cabeçalho `# ADR-0001 — Título`, bullets `Status/Data/Design completo/Origem`, seções `## Contexto`, `## Decisões` (tabela `# | Decisão | Alternativas descartadas | Por quê` com IDs `D1…D16`), `## Consequências` (Positivas / Negativas-custos / Fora do v0). Um novo ADR seria `ADR-0002.md` com IDs `D1…` próprios (ou continuar D17+; o repo não define). Skill `engineering:architecture` não é convenção do repo.
- Releases: `docs/releases/0.N.0.md` + entrada em `CHANGELOG.md` (formato `## [0.4.0] — 2026-10-10`) e `README`/`docs/ROADMAP.md`.
- `prompts/#0001-initial.md`: prompt original numerado (`#NNNN-<slug>.md`), origem do ADR.
- Propostas de mudança (`changes/NNNN-<slug>/proposal.md`; arquivadas em `changes/archive/NNNN-<slug>/proposal.md` após `compile`): frontmatter YAML com `id: "NNNN"` (string entre aspas), `title`, `status: proposed|applied`, `origin: proposal-first|code-first`, `delta: {added, modified, removed}` (IDs que casam `^(entity|invariant|method|event|usecase|operator):\S+$`, `src/compiler/changes/proposal.ts:7-8`), `acceptance[]` com `id` kebab-case, `covers`, `given/when/then` ou `manual: true`, e corpo com `## Motivo` obrigatório (placeholder `MOTIVO_PLACEHOLDER` bloqueia compile). Exemplo: `changes/archive/0002-cancelamento-exige-motivo/proposal.md`. Diretório deve casar `^\d{4}-[a-z0-9]+(-[a-z0-9]+)*$` (`proposal.ts:10`). **Só mudanças de regra de negócio no domínio usam proposal**; uma feature de tooling (este workflow) segue spec+plano, não `changes/` (ver "Critério para iniciar um plano", `docs/ROADMAP.md:52-57`: "declarações de negócio novas exigem proposal antes do código").
- Uma proposta aberta por vez no v0 (ADR "Negativas/custos"; issue #12 aberta).

### Inferences
- Para medir token/custo por tier seria preciso um **adapter `claude-cli`** (e provavelmente aceitar `model: haiku|sonnet|opus` explícito; `manifestSchema` já exige modelo explícito e rejeita `auto`). O contrato `Usage`/`Measured` já suporta o campo; o `nativeUsage` extrairia `input_tokens/output_tokens` se o evento do CLI Claude usar os mesmos nomes (**não verificado**: formato do stream do Claude CLI não está documentado no repo).
- A política "nunca estimar" significa que qualquer alegação de "token optimization" no repo precisa vir de `Usage` medido (ou ficar `unavailable`), não de bytes/4; o bytes/4 de `compile --report` serve só como orçamento de design/lint.
- O benchmark `tasks` (5 itens: 1 entity, 1 method, 2 use-cases, 1 operator) já separa naturalmente "domínio" (`entity:Task`, `method:Task.complete`) de "application/operator", dando um desenho experimental por camada sem criar domínio novo. AGENTS.md proíbe evoluir `orders` para validar a skill: usar o workspace `skills:example`.

### Gaps
- O repo não tem benchmark de **revisão** (papel Opus): oráculos atuais julgam aceitação determinística (verify + oráculo privado), não qualidade de review.
- Não há métrica de "tokens por item aceito" nem custo; só `Measured` por sessão. Cursor reporta uso incompleto.
- Não encontrei ADR/spec que trate de política de paralelismo de executores (o Plano 5 adotou sequencial).

## 4. Issues/labels/CHANGELOG: como o trabalho é referenciado

### Takeaway
Issues são escritas em português com prefixo de tipo ("Plano N —", "Evals —", "Melhoria —"), label `enhancement` (+ `documentation`), milestone e um corpo com seções fixas. Não há `.github/ISSUE_TEMPLATE` nem PR template; o CI é um único workflow.

### Cited Findings
- `.github/` só contém `workflows/ci.yml` (sem `ISSUE_TEMPLATE`, sem `pull_request_template.md`, sem `CODEOWNERS`). `CONTRIBUTING.md` (32 linhas, `:1-79`) cobre ambiente, TDD, snapshots, arquivos gerados, imports, Conventional Commits em português e propostas; não menciona issues/labels. Fonte: `CONTRIBUTING.md:70-76`.
- Issues no GitHub (consultadas via `gh api repos/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues`): #17-#20 (fechadas) "Evals — …", label `enhancement`, milestone "v0.2.0 — Validação com agentes reais"; #5/#6/#7/#8 "Plano N — …" (labels `enhancement`, `documentation` em #5/#8); #9-#13 "Melhoria — …" com label `enhancement` e milestone "Backlog — Extensões e distribuição"; PRs #14-#16 e #21-#22 sem label/milestone. Labels existentes no repo: `accessibility, bug, documentation, duplicate, enhancement, good first issue, help wanted, invalid, question, wontfix` (padrão GitHub; não há label por tema/modelo).
- Corpo de issue (#9, #17, #7): `## Resultado esperado`, `## Escopo` (bullets), `## Critérios de aceite` (checklist `- [ ]`), `## Dependências`, `## Limite de escopo`, `## Refinamento antes de implementar` (cita arquivos de partida) e rodapé "Status: proposta de próximo plano. Refinar spec e plano versionados sobre o código real antes de implementar; esta issue não autoriza antecipar funcionalidades futuras." (#17 acrescenta "## Contexto" e "## Certificação e evidências" ao fechar).
- Roadmap: `docs/ROADMAP.md` lista cada issue com link e dependência; tabelas "Frente de validação…" (`:9-20`), "Ciclo de avaliações #17–#20" (`:22-33`) e "Backlog" (`:43-50`). "Critério para iniciar um plano" (`:52-57`): refinar escopo/aceite, conferir interfaces atuais, "preservar fronteiras, hashes e ausência de evidência para done", versionar spec e plano, registrar decisões.
- `CHANGELOG.md`: formato `## [X.Y.Z] — AAAA-MM-DD`, parágrafo de resumo, bullets, "Mudança de build", "Limites desta release" e links para `docs/releases/X.Y.Z.md` e validação. Referências a issues aparecem como links `[#N](url)` no ROADMAP e `(#13)`/"PR #21" no texto; o CHANGELOG 0.3.0 cita "ciclo de avaliações #17–#20" sem link por issue.
- Commits: Conventional Commits em português (`CONTRIBUTING.md:74`), na prática `feat(evals): …`, `docs(evals): …`, `fix(package): …` e `Merge PR #N: …` em inglês/português misto no log (`git log --oneline`).
- Atribuição exigida pelo ambiente atual (não pelo repo): rodapés `Co-Authored-By`/`Claude-Session` nos commits e rodapé "Generated with Claude Code" em PRs.
- Branch atual `claude/eloquent-bell-b4rsxo`, remoto `origin` = `joao-oliveira-softtor/nestjs-agentic-ddd-architecture`. A conta GitHub da sessão bloqueia GraphQL: `gh issue list` falha com 403; `gh api` (REST) funciona.

### Inferences
- Uma nova issue seguiria o padrão "Melhoria — <título>" (backlog, milestone 2) ou "Evals — …"/"Plano N — …" (frente de validação); as próximas na numeração seriam #23+ (último é #22). O roadmap lista Planos 7-8 como "próximos trabalhos": o repo ainda não tem plano para orquestração por modelo, então seria nova issue + spec + plano.
- Não existe label para esta frente; `enhancement` basta, sem inventar novos labels.

### Gaps
- Não verifiquei milestones abertos além dos dois citados (`gh api …/milestones` não foi consultado).
- Não há política escrita para numeração de ADR além do `ADR-0001`.

## 5. Lacunas concretas, pontos de extensão (caminhos) e riscos específicos

### Takeaway
O workflow cabe como **camada de orquestração externa que consome `status/next/packet/verify` e o runner de avaliação**, sem tocar IR/renderers. As extensões mínimas são: gerador de brief por item, modelo por papel no instalador (com teste e `--check` atualizados), e adapter Claude + benchmark por tier no harness. Os riscos principais são tocar arquivos gerados, invalidar `specHash` e quebrar `compile --check`/`skills:install --check` no CI.

### Cited Findings (pontos de extensão, por arquivo)

| Necessidade | Onde plugar | Observação |
|---|---|---|
| Gerar brief/AGENTS.md por item para o executor | novo módulo em `scripts/` (ex.: `scripts/agent-briefs.ts`, estilo de `scripts/install-skills.ts`) consumindo `packet()` de `src/compiler/packet.ts` ou `bun run agentic packet`; ou novo comando em `src/cli/commands/` registrado em `src/cli/main.ts:122-131` e `src/cli/usage.ts` | Manter `src/cli`→`src/compiler` (arquitetura); `scripts/` já usa `@agentic-ddd/compiler` (ver `evals/contracts.ts` imports). Saída **fora** de `.agents/skills`, `.agentic`, `.claude/skills`, `AGENTS.md` (gerados). |
| Modelo por papel (haiku/sonnet/opus) | `scripts/install-skills.ts:21-26` (DESCRIPTIONS) e `:56` (`model: inherit`); novo papel `reviewer`; atualizar `test/skills-install.test.ts:65` | `bun run skills:install --check` roda no CI (`.github/workflows/ci.yml`, último passo) e compara adaptadores instalados byte a byte (conflito se difere: `install-skills.ts:~120`). Codex TOML: omitir `model` herda a sessão (spec Plano 5, última linha); mudar exigiria validar o schema do TOML. Cursor usa nomes de modelo próprios. |
| Instruções de papel por camada | `skills/agentic-ddd/references/{executor,manager}.md` (+ nova `reviewer.md`) e `skills/agentic-ddd/SKILL.md` (índice de referências, `:8-14`) | São fonte autoral; os links `.agents/skills/agentic-ddd`/`.claude/skills/agentic-ddd` apontam para `skills/agentic-ddd` (symlink, `AGENTS.md`), então mudanças se propagam sem recompile. O índice do `SKILL.md` limita ~100 tokens de metadados (lint). |
| Eliminar contexto de outras camadas | brief do executor de domínio exclui `orders-dev/SKILL.md` e traz só `declaration`+`contracts` do packet; dar a Sonnet o recorte `application` | `executor.md` hoje manda ler "a skill gerada do módulo": o brief teria que substituir essa instrução (cuidado: o texto do executor.md é fonte autoral compartilhada com Codex/Cursor, não deve divergir silenciosamente). |
| Onda/paralelismo por camada | `src/compiler/state.ts:211-230` (`waves`) já dá níveis; `manager.md` passo 4 impõe "um executor por vez" | Um orquestrador pode mapear camada→modelo (`item.layer` no `status --json`). Paralelizar exige mudar a regra do manager.md (e spec Plano 5 `:48`); itens de uma mesma onda editam o mesmo arquivo (ex.: `order.ts` tem `entity:Order` e `method:*`), o que cria conflito e deslocamento de linhas. |
| Medir token/custo/sucesso por tier | `scripts/evals/contracts.ts` (adapter enum + `parameters`), novo `scripts/evals/adapters/claude.ts` (estilo de `codex.ts`/`cursor.ts`), `scripts/evals/implementation.ts:278-336` (prompt) e `scripts/evals/audit.ts:13` (`TASK_ITEMS`); manifestos em `evals/*.json` ou `evals/campaigns/<ciclo>/` | `schemaVersion: 1` com `strictObject`: mudar o enum é mudança de contrato (hashes de manifestos congelados em ciclos anteriores; "Preservar APIs públicas, orders, dataset original e artefatos históricos" repetido em `docs/superpowers/specs/2026-10-10-evals-1*.md`). Criar novos manifestos, não editar os existentes. |
| Value objects como item | `src/compiler/graph.ts` (`Layer`/`workItems`), `src/decorators`, `src/compiler/ir.ts`, renderers | Mudança de IR altera `domain.lock.json`/`ir-hash` e todos os gerados; precisa de spec/ADR. Alternativa sem compilador: tratar VO como parte do item da entidade. |
| Revisão (Opus) | novo papel + checklist em `skills/agentic-ddd/references/` | O gerente já "revisa diff contra limites (somente corpo e testes)" (`manager.md` passo 5); a auditoria automática do limite de edição existe só no runner (`scripts/evals/audit.ts`), não no CLI do framework. Um reviewer poderia reutilizá-la. |
| Packet sem rodar a suíte inteira | `src/compiler/project-state.ts:59-78` e `src/cli/commands/packet.ts` (nova flag `--static`) | Mudança de CLI exige atualizar `src/cli/usage.ts`, `src/cli/args.test.ts`/`cli.test.ts` e documentação em `AGENTS.md` bloco gerado só se o texto de convenção mudar (`src/compiler/render/agents-md.ts:44`). |

### Riscos específicos deste repo

1. **Arquivos gerados**: `.agents/skills/*` (exceto o link `agentic-ddd`), `.agentic/**`, espelhos `.claude/skills/*`, bloco do `AGENTS.md`, `CLAUDE.md` (`@AGENTS.md`) são regenerados/validados por `compile --check` (`src/compiler/write.ts:259-290`: drift `missing|changed|extra|mirror|conflict`; qualquer arquivo extra dentro de diretório de skill gerado, marcado por `agentic-ddd.generated: "true"`, vira `extra`). `.gitattributes` marca como `linguist-generated`. Briefs por tarefa **não devem** ser escritos nesses caminhos nem no bloco do `AGENTS.md`; usar diretório próprio (workspace temporário/`.agentic-tasks/` a definir, não existe hoje) ou texto fora do bloco. Verificar o `.gitignore`: não ignora nada de `.agentic*`.
2. **Invalidação de spec hash**: o hash cobre declaração, contratos e critérios de **propostas abertas** (`item-spec.ts:144-163`, `applicableCriteria` filtra `!p.archived`). Compile **arquiva** a proposta antes dos corpos serem implementados (`tutorial.md`, `manager.md` passo 2), então o packet gerado depois do compile pode omitir critérios (spec Plano 6 `:18`), e o brief precisa dos critérios arquivados lidos em `changes/archive/NNNN-<slug>/proposal.md`. Se o brief for regenerado com packet novo, o hash pode mudar e o `verify` do executor falha em I3; a regra é "não troque hash só para tornar verify verde" (`manager.md`, último parágrafo antes do formato). Brief deve armazenar o packet original e o hash.
3. **Deslocamento de `source`**: editar corpos com contagem de linhas diferente muda as coordenadas nos gerados sem mudar `specHash`, o que reprova `compile --check` (`executor.md` 2º bullet; spec Plano 5 `:50`). Um executor Haiku tende a reformatar/expandir: o brief tem que repetir a regra de preservar linhas e o gerente (Sonnet) deve rodar `compile --check` após integração (o executor não roda compile). O runner já adiciona "somente interior do corpo, mesma quantidade de linhas" ao prompt (`implementation.ts:332`).
4. **CI** (`.github/workflows/ci.yml`): `typecheck`, `lint`, `bun test`, `build`, `test:package` (smoke do tarball; `scripts/package-audit.ts` audita a allowlist `files` do `package.json`), `agentic compile --check`, `skills:install --check`. Novo script em `scripts/` não entra no tarball (allowlist só `dist/*`, `bin`, README, LICENSE, CHANGELOG, `docs/distribution.md`); novos arquivos em `skills/` ou `docs/` também não, a menos que a allowlist mude. Novos testes devem ser `bun:test` offline; testes que invocam CLIs reais/inferência não podem entrar no CI padrão (convenção do ciclo #17-#20; ver `skipIf(AGENTIC_DDD_VERIFY === '1')` nos testes de evals e a nota "benchmarks ficam skipped" no registro do ciclo).
5. **Recursão/tempo do verify**: `verify --item` roda `bun test` completo com `AGENTIC_DDD_VERIFY=1` (`src/compiler/verify/test-run.ts:82-88`, `item.ts:39-45`). Em N briefs sequenciais, ~110 s cada neste repo anula a economia de tokens em tempo de relógio; configurar `verify.test` por módulo ou por pasta nos workspaces dos executores.
6. **Conflitos de edição**: `entity:Order` e `method:Order.confirm/cancel` vivem no mesmo arquivo `order.ts`; paralelizar Haiku por unidade de domínio exige worktrees/merge por corpo ou serialização (o design do Plano 5 evitou isso: "um por vez").
7. **Isolamento do runner**: o harness real roda dentro de bubblewrap, em clone privado, sem credenciais herdadas (`scripts/evals/isolation.ts`, CI instala `bubblewrap`); um adapter Claude precisa respeitar isso (`authentication: api-key|local-login`, `scripts/evals/contracts.ts` manifest) e não pode copiar configs/hooks/MCP.
8. **Fronteiras**: `src/core` só importa `zod`; `examples/**` importa só `@agentic-ddd/*`; compiler e runtime não importam um ao outro (spec Plano 6 `:20`, `AGENTS.md`). Um orquestrador de modelos não deve entrar em `src/core`/`src/runtime`; `scripts/` ou `src/cli` são os lugares compatíveis.
9. **Não evoluir `orders`** para validar skill/workflow (`AGENTS.md`, "Skill autoral e agentes"); usar `bun run skills:example --root <destino-inexistente>` (tutorial tasks, 5 itens) e `evals/implementation/tasks/reference/*.test.ts.txt` como oráculos.
10. **Linguagem e estilo**: textos do repo em PT-BR; imports relativos sem extensão; `import type` em classes decoradas; `bun:test`; Prettier/oxlint (`package.json` scripts `format`, `lint`).
11. **Estado local do sandbox desta análise**: o checkout não tinha `node_modules` (a CLI não executa sem `bun install`); `status --static` mostra avisos "declaração de teste dinâmica não resolvida (covers)" para ~18 arquivos de teste do próprio framework (não é erro; diagnóstico do analisador estático).

### Inferences
- **Ordem de menor risco** para introduzir o workflow: (1) spec + plano em `docs/superpowers/` descrevendo o gerador de briefs e a medição; (2) gerador de brief como script offline sem mexer em adaptadores; (3) benchmark comparativo usando adapter Claude novo e manifestos novos sob orçamento autorizado; (4) só depois alterar `install-skills.ts` (`model: haiku|sonnet|opus`) com teste e `--check`.
- A "otimização de tokens" mais certa vem de (a) remover `orders-dev/SKILL.md`/`AGENTS.md` do contexto do executor de domínio (~3,3k tokens fixos, medidos em bytes/4), (b) packet enxuto (remover entidade inteira repetida em `declaration.entity` dos packets de método, ~2k de JSON por packet em orders, se o contrato permitir; isso mudaria `item-spec.ts` e portanto o `specHash`: risco alto, não recomendado sem ADR), (c) evitar rodar a suíte inteira por brief. Itens (b) altera hash e snapshots; (a) e (c) são não-invasivos.
- Um brief para Haiku não deve duplicar o packet no `AGENTS.md`: o `AGENTS.md` por tarefa deve ser curto (regras de corpo-só, preservar linhas, `covers`, comando de verificação literal) e apontar o packet como anexo, pois o packet é determinístico e o hash depende dele.

### Gaps
- Não consegui rodar `compile --check`, `skills:install --check` nem a suíte completa para confirmar baseline verde: a suíte completa leva > 2 min e o repo estava sem dependências instaladas (instalei só em cópia no scratchpad). Os registros de validação do repo (456 testes, 0 falhas em `docs/superpowers/validation/2026-10-10-evals-cycle.md`) são a única evidência de baseline.
- Nenhuma medição de Haiku/Sonnet/Opus foi possível (sem inferência neste escopo e sem adapter Claude); as proporções de economia acima são estimativas de bytes/4, não medidas de `Usage`.
- Não validei o formato de eventos do CLI do Claude Code (`claude -p --output-format stream-json`) nem como `model` do frontmatter de subagente (`haiku|sonnet|opus|inherit`) é resolvido na versão instalada: depende de documentação externa fora do escopo desta análise local.
