# Orquestração de agentes por camada e modelo — Execução

Spec: [escopo](../specs/2026-10-12-orquestracao-agentes-por-modelo.md). Decisões: [ADR-0003](../../adr/ADR-0003.md). Épico: [#26](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/26). Pesquisa: [relatório](../../research/2026-10-12-orquestracao-agentes-por-modelo/relatorio.md).

Nenhuma fase abaixo autoriza inferência real. O harness exige orçamento autorizado por ciclo (política de nunca estimar tokens). Cada fase vira PR próprio, com testes offline.

## Fases

| Fase | Issue | Entrega | Depende de |
| ---- | ----- | ------- | ---------- |
| 0 | [#27](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/27) | Este plano, ADR-0003 e entrada no ROADMAP | — |
| 1 | [#28](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/28) | `packet --static` (e opcionalmente `packet --wave`) sem rodar a suíte | 0 |
| 2 | [#29](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/29) | Gerador determinístico de briefs (`scripts/agent-briefs.ts`) | 0, 1 |
| 3 | [#30](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/30) | Executor de domínio isolado (referência e papel) | 0 |
| 4 | [#31](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/31) | Gates mecânicos de fronteira (corpo-só, contagem de linhas, direção de import) | 0 |
| 5 | [#32](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/32) | Papel de revisor e schema de achados no instalador | 0, 3 |
| 6 | [#35](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/35) | Adapter Claude no harness de avaliação | 0 |
| 7 | [#34](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/34) | Driver de orquestração com política de camadas e escalação | 1, 2, 4, 5 |
| 8 | [#36](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/36) | Campanha de comparação por nível (braços A0–A8) | 6, 7; orçamento autorizado |
| 9 | [#37](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/37) | Benchmark de revisão com as 19 regressões plantadas | 5, 6 |
| 10 | [#33](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/33) | Perfil de modelos por papel no instalador (opt-in) | 5, resultado da fase 8 |
| — | [#38](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/38) | Spike de value object como item do grafo (opcional, com ADR) | 0 |
| — | [#39](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/39) | Documentação e CI finais | demais |

As fases 1, 3, 4 e 6 não dependem entre si e podem ser feitas em qualquer ordem após a fase 0. A fase 7 só começa depois de 1, 2, 4 e 5, porque o driver consome packets estáticos, briefs, gates e o papel de revisor.

## Restrições transversais

- Briefs e telemetria não podem ser escritos em `.agents/skills`, `.agentic`, `.claude/skills` nem no bloco gerado do `AGENTS.md`; `bun run agentic compile --check` e `bun run skills:install --check` continuam verdes.
- O brief carrega o `specHash` do packet emitido antes do `compile`; o `specHash` cobre só propostas abertas (`src/compiler/item-spec.ts:43`).
- Não alterar `specHash`, formato do packet nem IR sem ADR próprio. Value objects ficam no item da entidade na fase 1.
- Não evoluir `examples/orders` para validar a skill; usar o benchmark `tasks` do workspace isolado de `skills:example`.
- Topologia plana de subagentes (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`); nunca `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`.
- Executor sequencial na fase 1 (um por vez); paralelismo por arquivo com worktree só depois.

## Experimento (fase 8)

Benchmark `tasks` (`entity:Task`, `method:Task.complete`, dois use-cases, um operator). Braços: A0 Sonnet sozinho (esforço médio); A1 Sonnet (baixo); A2 Opus (baixo); A3 Haiku→Sonnet→Opus; A4 como A3 sem revisão; A5 mesmo pipeline de A3 (brief, política de escalação e revisão Opus), trocando só o worker de domínio por Sonnet; A6 brief mínimo vs contexto atual no mesmo modelo; A7 escalação alternativa; A8 revisor de outra família (opcional).

Métricas: aprovação no primeiro e no final `verify --item`; falso verde (gates verdes, oráculo privado reprova); violações de fronteira; escalações e retentativas; tokens de entrada, de entrada em cache e de saída por nível (medidos, nunca estimados); turnos; tempo; custo por item aceito (derivado da tabela de preços e rotulado como tal). Pelo menos 5 repetições por célula (hipótese de trabalho, a ajustar após um piloto de 2 repetições); relatar mediana, p90 e intervalos. O harness v1 fixa `repetitions` em 1, então repetições exigem mudança no harness ou várias campanhas. Os critérios de decisão estão pré-registrados no ADR-0003.

Fases do experimento: (0) piloto offline com adapter `scripted`; (1) piloto de 2 repetições em A0, A3 e A5; (2) campanha completa; (3) decisão sobre D6, D7, D12 e D15; (4) validação em ciclo separado antes de qualquer mudança de padrão nos adaptadores.

## Verificação

Para cada fase: testes direcionados, `bun test`, `bun run typecheck`, `bun run lint`, `bun run build`, `bun run agentic compile --check` e `bun run skills:install --check`. Commits separados por entrega; registrar decisões e progresso neste plano.
