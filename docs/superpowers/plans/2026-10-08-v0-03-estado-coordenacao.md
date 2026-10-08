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

## Resultado da execução

- [x] Detecção fora da IR e registry filtrado disponível na análise.
- [x] Estados, obrigações abertas, bloqueios e leitura estática sem executar testes.
- [x] APIs públicas e CLI status/next com coleta única e ondas ordenadas.
- [x] Pacotes dos quatro tipos e verifyItem com cinco gates.
- [x] G7 por proprietário ADDED/MODIFIED, inclusive changes arquivados.
- [x] Fixture Order com cópias temporárias, subprocessos, tsc real, RED→GREEN por onda, gerados estáveis e hash protegendo decorators.
- [x] Ajuda, README, convenções regeneradas e plano 4 sobre a base real.

Aceite final: **316 testes, 0 falhas, 14 snapshots**; typecheck, lint, build e compile --check aprovados; verify 0001 = done; verify 0002 = needs-human (só G6 pendente). Revisão independente realizada; corrigidas coleta JUnit parcial (inclusive erro de import com outra assertion falhando), normalização de critérios no packet e evidência estática. Teste negativo de typecheck verifica que só I5 reprova.

Revisão local da PR identificou consultas falhando em projetos ainda sem testes. `status`, `next` e `packet` agora aceitam uma suíte explicitamente vazia, preservando a ausência de evidência para `done` e a recusa de coleta parcial. A fixture Order começa sem testes registrados; a regressão da CLI também cobre diretório sem arquivos de teste.

Decisões de execução: branch local no checkout compartilhado; representação canônica antecipada para publicar specHash nos estados; CLI de change inválido sai 2 conforme o contrato aprovado. O leitor estático requer imports de teste do Bun e diagnostica declarações parametrizadas não resolvidas.
