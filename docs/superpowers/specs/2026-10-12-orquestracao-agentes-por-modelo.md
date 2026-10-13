# Orquestração de agentes por camada e modelo — escopo de melhorias

Status: proposta de escopo (nada implementado). Evidência completa em `docs/research/2026-10-12-orquestracao-agentes-por-modelo/relatorio.md`; notas por tema em `.../notas/`.

## Objetivo

Reduzir tokens e custo da implementação de itens do grafo `@agentic-ddd` distribuindo o trabalho por camada entre modelos de custo diferente, cada um em contexto limpo e com um brief mínimo gerado por tarefa:

- **Haiku** implementa itens `layer: domain` (entidades e métodos; value objects na fase 1 como parte da entidade), conhecendo só o contrato do item. Não entende application, infraestrutura nem outros módulos.
- **Sonnet** implementa `application`, `operators` e infraestrutura, integra o trabalho do Haiku e resolve abstrações entre camadas.
- **Opus** aprova proposta/contratos e revisa o diff final.

## Premissa honesta

Não existe benchmark publicado para esta divisão exata em três níveis, e a decomposição por camada DDD é inédita na literatura. Os precedentes são adjacentes (Aider architect/editor, Scrouting, SWE-Router, revisor de contexto limpo da Cognition). A Anthropic mostra que, na maioria das configurações medidas, um único modelo em esforço menor foi mais barato que orquestrador + trabalhadores. A divisão por camada é, portanto, **hipótese a medir**; o experimento (abaixo) inclui Sonnet e Opus sozinhos em esforço baixo como controles, e o resultado pode ser simplificar.

Razão de preços atual (12/10/2026, entrada por MTok): Haiku 5.5 US$ 0,10, Sonnet 5.5 US$ 2, Opus 5.5 US$ 4 (1:20:40). O ganho de enxugar o contexto do Haiku é de isolamento e aderência, não de dólares; o dinheiro está nas retentativas, nas escalações e nos tokens de Sonnet/Opus.

## O que o repositório já fornece

- Gerente/executor, ondas, `packet` com `specHash` e `verify --item` (gates I1–I5): `src/compiler/packet.ts`, `src/compiler/verify/item.ts`, `skills/agentic-ddd/references/{manager,executor}.md`.
- Handoff verificado (packet + hash) é o fator que a literatura aponta como decisivo; o brief por tarefa é uma vista derivada e determinística desse contrato.

## Lacunas

1. Modelo por papel não existe: `scripts/install-skills.ts:56` grava `model: inherit` (`test/skills-install.test.ts:65`); a spec v0 previa `model: haiku` no executor.
2. Não existe papel de revisor.
3. O executor vaza contexto: `executor.md` manda ler a skill do módulo inteiro (~3,3k tokens fixos) e contradiz o `AGENTS.md` raiz sobre `compile`.
4. `packet`, `status`, `next` e `verify --item` rodam a suíte inteira (~110 s por packet vs ~1,2 s com `verify.test` escopado).
5. Value objects, eventos e ports não são itens do grafo; incluí-los muda o IR (exige ADR).
6. O harness de evals não tem adapter Claude, repetições fixas em 1 e política de nunca estimar tokens.
7. Os gates I4/I5 não detectam teste verde superficial (só o oráculo privado do harness de avaliação o faz); em produção, o falso verde só é pego pela revisão, o que torna o papel de revisor (B06) mais importante, não dispensável.

## Decisões de desenho (D1–D15, ver relatório, Parte A.2)

- **D1** Núcleo determinístico em `scripts/` (testável, neutro a ferramenta) + adaptador fino para Claude Code; workflow salvo em `.claude/workflows/` é opcional.
- **D2** Estratégia e contratos: humano ou Opus; nunca Haiku.
- **D3/D4** Brief **renderizado do packet** (sem LLM), em diretório fora de caminhos gerados; arquivos de contexto escritos por LLM pioraram e encareceram (ETH Zurich, ICLR 2026), embora AGENTS.md tenha reduzido tempo e tokens de saída (Lulla et al.). A hipótese de que o brief determinístico escapa disso é inferência a validar.
- **D5** Executor de domínio recebe só brief + núcleo do papel, sem skill do módulo e sem o CLAUDE.md conflitante.
- **D6/D7** Roteamento estático por camada e rubrica (contrato e testes no packet, um arquivo, sem decisão de desenho, falha detectável por gate); escalação dinâmica: 1 retentativa no mesmo nível com a saída da falha, depois nível acima, depois `needs-human`.
- **D8** Sequencial na fase 1; paralelo por arquivo com worktree depois.
- **D9** Topologia plana: `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`, `maxBudgetUsd`, `maxTurns` no Haiku; nunca `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`. A premissa "subagentes não criam subagentes" está desatualizada (profundidade padrão 3).
- **D10/D11** Value objects como parte do item da entidade na fase 1; não alterar o packet agora (muda `specHash`).
- **D12** Revisor Opus em contexto limpo (diff + contrato + resultado dos gates), achados citam ID de invariante ou gate, no máximo 2 ciclos; gates determinísticos antes de qualquer revisão LLM.
- **D13** Varrer esforço antes de trocar de modelo. **D14** Prefixo estático por estágio para cache. **D15** Só gravar modelos nos adaptadores depois do experimento.

## Estrutura mínima do brief

Ordem estável (estático primeiro, para cache): regras do papel; formato de resposta; item e `specHash` copiados do packet; packet integral como emitido antes do `compile` (critérios de propostas arquivadas não entram no packet nem no `specHash`: `applicableCriteria` filtra `!p.archived`, `src/compiler/item-spec.ts:43`; se forem anexados ao brief, ficam em seção própria com hash próprio e sem alegar cobertura pelo `specHash`); arquivos permitidos/proibidos; comando literal de `verify --item`; ponteiros preguiçosos. Ponto de partida: `scripts/evals/implementation.ts:278-336`.

## Backlog (issues)

B01 spec/plano/ADR-0002 · B02 `packet --static` · B03 gerador de briefs · B04 executor de domínio isolado · B05 gates de fronteira · B06 papel de revisor · B07 perfil de modelos opt-in no instalador · B08 driver de orquestração com escalação · B09 adapter Claude no harness · B10 campanha de comparação por nível · B11 benchmark de revisão · B12 spike de value object · B13 docs e CI. Escopo, critérios de aceite, dependências e riscos de cada um estão nas issues e na Parte B do relatório. Ordem de menor risco, respeitando as dependências: B01–B06 (não invasivos), B09 (adapter Claude), B08 (driver, necessário para executar os braços A3–A5), B10/B11 (campanhas, com orçamento autorizado) e, por último, B07 (perfil de modelos no instalador, só após o resultado de B10).

## Plano de experimentos (resumo; Parte C do relatório)

Benchmark `tasks` do workspace isolado `skills:example` (sem tocar em `orders`). Braços: A0 Sonnet sozinho (médio), A1 Sonnet (baixo), A2 Opus (baixo), **A3 Haiku→Sonnet→Opus**, A4 sem revisor, A5 Sonnet no domínio com o mesmo brief, A6 brief mínimo vs contexto atual, A7 escalação alternativa, A8 revisor de outra família (opcional). Métricas: aceite no primeiro e final `verify --item`, falso verde, violações de fronteira, escalações, tokens medidos por tipo e nível, custo por item aceito (derivado, rotulado). Mínimo de 5 repetições por célula (hipótese; piloto com 2). Critérios de decisão pré-registrados antes de rodar:

- Adotar Haiku no domínio só se o aceite de A3 for não inferior a A5 e o custo por item aceito for menor (`p_aprovação > C_barato / C_forte`, com taxas medidas).
- Adotar o revisor Opus só se A3 detectar regressões que A4 deixa passar, com precisão aceitável.
- Se A0/A1 igualarem A3 com menos custo, simplificar: manter `inherit` e adotar só brief e gates.

## Fora de escopo

Alterar `specHash`, o formato do packet ou o IR sem ADR; executar inferência real sem orçamento autorizado (o harness exige); evoluir `orders` para validar a skill; gravar modelos como padrão nos adaptadores antes do experimento.

## Riscos

Briefs não podem ir em `.agents/skills`, `.agentic`, espelhos de skills nem no bloco gerado do `AGENTS.md` (`compile --check` acusaria drift); reformatar corpos desloca `source` nos gerados; `entity:Order` e `method:Order.*` compartilham arquivo (paralelismo exige worktree); falso verde chegando ao revisor; grande parte da evidência é de fornecedores, sem replicação independente.
