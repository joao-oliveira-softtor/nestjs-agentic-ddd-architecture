# Plano 3 — Estado do projeto e coordenação

Fonte: plano aprovado fornecido na sessão; spec §§6.6, 8.3 e aceite 9.

Objetivo: esqueleto declarado → next → packet → verify --item → verify change.
Estado calculado sob demanda, sem persistência e fora da IR, lock e skills.

## Entregas

1. Registry filtrado na análise e detecção literal `/\bnotImplemented\(\)/` nas funções; entidade por fábricas, use-case por execute, operator declarativo.
2. Estados e obrigações: declared → implemented → covered → done, blocked sobreposto; critérios automáticos abertos; seleção de change com dependências pendentes; parser estático sem executar testes.
3. APIs/CLI status e next: evidência JUnit coletada uma vez, ondas topológicas ordenadas.
4. Packet determinístico e specHash da representação canônica sem source/corpos/estado; verifyItem com dependências, implementação, hash, cobertura e typecheck.
5. G7 no verify de changes usando a mesma suíte; proprietários de ADDED/MODIFIED, mesmo arquivados; preservar needs-human.
6. Fixture Order em subprocessos demonstrando as quatro ondas, estabilidade dos gerados, hashes e G7; ajuda/README/convenções geradas e plano 4.

## Contratos

Todos aceitam --config. Uso inválido sai 2; análise/verificação falha sai 1; consultas saem 0 com trabalho pendente. APIs públicas: status(options), next(options), packet(options), verifyItem(options). Tipos públicos WorkItemStatus, ProjectStatus, NextReport, ItemVerifyReport. No modo static nunca done. Hash cobre item, regras, contratos referenciados e critérios automáticos aplicáveis, excluindo localização e resultados.

## Verificação

Cada entrega: teste RED, implementação GREEN, commit. Aceite final: bun run typecheck; bun run lint; bun test; bun run build; bun run agentic compile --check; bun run agentic verify 0001 (done); bun run agentic verify 0002 (needs-human).
