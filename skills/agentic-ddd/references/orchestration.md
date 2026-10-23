# Orquestração por camada e modelo

Driver sequencial que distribui os itens do grafo entre níveis de modelo. É ferramenta de experimento, não o padrão: o piloto de #36 mostrou que um modelo só (Sonnet medium) iguala o roteamento em aceite com custo igual ou menor, então o padrão é o modelo `inherit` com brief e gates (ADR-0003, Resultado do experimento). O modo padrão do driver não executa nada.

```
bun scripts/orchestrate.ts [--static] [--change NNNN] [--tier domain=sonnet] [--ladder sonnet,opus]
bun scripts/orchestrate.ts --real --max-invocations 20 [--max-tokens N] [--review]
```

- **Plano (padrão):** lista, por onda, o nível, o modelo e o tamanho do brief de cada item. Não chama modelo. `--static` evita rodar os testes, mas então nenhum item conta como `done` e todos entram no plano.
- **Roteamento:** `domain` começa em Haiku; `application`, `operators` e `infrastructure` (adapters), em Sonnet, com o papel de executor de infraestrutura. `--tier` e `--ladder` montam os controles do experimento (por exemplo, tudo em Sonnet).
- **Brief:** renderizado do packet (`scripts/agent-briefs.ts`), sem LLM. Na retentativa, a saída da falha entra numa seção própria, fora do `specHash`.
- **Aceite:** quem aceita um item são os gates do driver, nunca o relato do executor: escopo do worktree inteiro (só o arquivo-fonte do item e `*.test.ts` podem mudar), imports por camada, só o corpo atribuído em itens `method:`, só a classe (corpos e membros `#privados`, mesmas linhas, sem mudar assinatura) em itens `valueobject:`/`adapter:` e `verify --item` com o hash do packet. O baseline é tirado uma vez por item, antes da primeira tentativa, e vale para as retentativas.
- **Escalação:** 1 retentativa no mesmo nível com a saída da falha; depois o nível acima (o worktree volta ao baseline do item); esgotada a escada, `needs-human`. `blocked` sobe sem retentativa. Dependentes de um item `needs-human` são pulados.
- **Revisão (`--review`):** uma passada do Opus em contexto limpo, depois que todos os itens passam nos gates; o diff que ela recebe inclui os arquivos novos (testes criados pelo executor). O relatório é validado por `scripts/reviewer-report.ts`; `changes_requested` ou resposta inválida nunca conclui em silêncio. Não há reexecução automática por achado (ADR-0003 D12 segue adiada).
- **Execução real:** exige `--real`, `--max-invocations`, `ANTHROPIC_API_KEY` e o CLI `claude`. Cada invocação usa `claude --bare` (sem `CLAUDE.md`, hooks nem configuração de usuário), `--max-turns`, `--max-budget-usd` e `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`; `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` nunca é repassado. `--max-tokens` usa tokens medidos; uso indisponível com esse teto ativo interrompe novas execuções.
- **Telemetria:** `.agentic-tasks/runs/<id>/telemetry.jsonl`, uma linha por tentativa (nível, modelo, gate, decisão, tokens, tempo), uma por revisão e uma de fechamento. Custo em dólar não é calculado.

## Benchmark de revisão

Mede o que o revisor pega além dos gates (ADR-0003 D12). As 19 regressões plantadas do ciclo evals-19 (`scripts/evals/review-defects.ts`) passam em I1–I5 por construção, porque o teste foi trocado por cobertura superficial verde; só a revisão as detecta. Cada item do workspace `tasks` ganha também um controle limpo, onde o revisor deve aprovar (24 casos).

```
bun scripts/evals/review-benchmark.ts [--only defect:normalization,clean:entity:Task]
bun scripts/evals/review-benchmark.ts --real --max-invocations 48 [--cycles 2] [--arms clean,authored] [--model <id>]
```

- **Padrão:** monta os casos (um workspace por caso, itens anteriores concluídos) e mostra o tamanho do brief. Não chama modelo.
- **Isolamento:** o revisor real roda sem nenhuma ferramenta (`--tools=`) e em diretório vazio, vendo só packet, diff e gates. `defect`, `kind` e `expected` ficam no caso e nunca entram no brief; assim a solução de referência e os oráculos privados não alcançam o modelo.
- **Braços:** `clean` (packet, diff e gates) e `authored` (soma o relato otimista do executor, para medir o viés de autoria). O braço `authored` usa o núcleo do revisor sem as duas frases que proíbem o relato e o histórico; sem isso a única diferença entre os braços contradiria a instrução e mediria desobediência. Um revisor de outra família entra como mais um braço quando houver adapter; hoje só há Claude.
- **Métricas** (por ciclo e agregadas; `null` quando o denominador é zero): `recall` (defeito apontado pelo ID esperado), `weakRecall` (aceita `I4`, o teste superficial), `precision` (revisões `changes_requested` que apontam o defeito ou `I4`), falsos verdes (defeito aprovado), controles limpos apontados e achados espúrios (fora do esperado; no controle limpo, todos). Casos `not_run` ficam fora dos denominadores e são contados à parte.
- **Orçamento:** `--real` exige `--max-invocations` (inteiro: é o teto de chamadas pagas); `--max-tokens` usa tokens medidos e uso indisponível interrompe. Resultados em `<work>/results/<id>/{scores.jsonl,summary.json}`.
