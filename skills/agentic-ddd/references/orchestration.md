# Orquestração por camada e modelo

Driver sequencial que distribui os itens do grafo entre níveis de modelo. É uma hipótese a medir (ADR-0003), não o padrão: o modo padrão não executa nada.

```
bun scripts/orchestrate.ts [--static] [--change NNNN] [--tier domain=sonnet] [--ladder sonnet,opus]
bun scripts/orchestrate.ts --real --max-invocations 20 [--max-tokens N] [--review]
```

- **Plano (padrão):** lista, por onda, o nível, o modelo e o tamanho do brief de cada item. Não chama modelo. `--static` evita rodar os testes, mas então nenhum item conta como `done` e todos entram no plano.
- **Roteamento:** `domain` começa em Haiku; `application` e `operators`, em Sonnet. `--tier` e `--ladder` montam os controles do experimento (por exemplo, tudo em Sonnet).
- **Brief:** renderizado do packet (`scripts/agent-briefs.ts`), sem LLM. Na retentativa, a saída da falha entra numa seção própria, fora do `specHash`.
- **Aceite:** quem aceita um item são os gates do driver, nunca o relato do executor: imports por camada, só o corpo atribuído em itens `method:` e `verify --item` com o hash do packet.
- **Escalação:** 1 retentativa no mesmo nível com a saída da falha; depois o nível acima (o item volta ao estado anterior à tentativa que falhou); esgotada a escada, `needs-human`. `blocked` sobe sem retentativa. Dependentes de um item `needs-human` são pulados.
- **Revisão (`--review`):** uma passada do Opus em contexto limpo, depois que todos os itens passam nos gates. O relatório é validado por `scripts/reviewer-report.ts`; `changes_requested` ou resposta inválida nunca conclui em silêncio. Não há reexecução automática por achado (ADR-0003 D12 segue adiada).
- **Execução real:** exige `--real`, `--max-invocations`, `ANTHROPIC_API_KEY` e o CLI `claude`. Cada invocação usa `claude --bare` (sem `CLAUDE.md`, hooks nem configuração de usuário), `--max-turns`, `--max-budget-usd` e `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`; `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` nunca é repassado. `--max-tokens` usa tokens medidos; uso indisponível com esse teto ativo interrompe novas execuções.
- **Telemetria:** `.agentic-tasks/runs/<id>/telemetry.jsonl`, uma linha por tentativa (nível, modelo, gate, decisão, tokens, tempo), uma por revisão e uma de fechamento. Custo em dólar não é calculado.
