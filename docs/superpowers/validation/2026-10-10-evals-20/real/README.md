# Campanha real #20 — seis execuções independentes

Executada em 2026-10-10 após a autorização explícita `autorizo`. [Autorização e preflight](authorization-and-preflight.json), [comandos e horários](execution-ledger.json), [validação final](validated-results.json). Limite por run: 35 sessões/45 minutos, skill 120 s, implementação 600 s, uma correção por item, repetitions 1/concurrency 1. Consumo: **184/210 sessões**, **76,8/270 minutos**. Não houve runs adicionais, reparos manuais de submissões ou mudanças de gates/instruções.

## Resultados observados

| Run | Perguntas | Packets inicial → final | verify 0001 | Sessões | Correções | Minutos |
| --- | --- | --- | --- | --- | --- | --- |
| [codex-sol-high-r1](runs/codex-sol-high-r1/report.md) | 24/25 | 4/5 → 5/5 | done | 31 | 1 | 12.3 |
| [codex-sol-high-r2](runs/codex-sol-high-r2/report.md) | 24/25 | 5/5 → 5/5 | done | 30 | 0 | 12.0 |
| [codex-sol-high-r3](runs/codex-sol-high-r3/report.md) | 24/25 | 5/5 → 5/5 | done | 30 | 0 | 11.6 |
| [cursor-codex-medium-r1](runs/cursor-codex-medium-r1/report.md) | 23/25 | 2/5 → 3/5 | failed | 31 | 2 | 13.4 |
| [cursor-codex-medium-r2](runs/cursor-codex-medium-r2/report.md) | 23/25 | 4/5 → 5/5 | done | 31 | 1 | 13.9 |
| [cursor-codex-medium-r3](runs/cursor-codex-medium-r3/report.md) | 24/25 | 4/5 → 5/5 | done | 31 | 1 | 13.8 |

[JSON agregado](aggregate/aggregate.json) e [Markdown](aggregate/aggregate.md): Codex 72/75 perguntas, 14/15 itens iniciais, 15/15 finais e 3/3 certificações; Cursor 70/75 perguntas, 10/15 iniciais, 13/15 finais e 2/3 certificações. Cobertura **150/150 perguntas**, seis runs executados/planejados. Comparação descritiva, sem ranking ou significância estatística. Todos os casos adicionais foram respondidos corretamente; as oito respostas incorretas pertencem ao dataset original e foram julgadas literalmente.

O primeiro run Codex precisou corrigir complete_task: o evento era explicitamente stamped antes de ctx.publish, que também faz stamp. Auditoria e teste superficial verdes, oráculo privado vermelho; segunda submissão aceita. [Reprodução offline completa](offline-double-stamp-reproduction/report.md).

Os três runs Cursor tiveram rejeição inicial da entidade por mudança no número de linhas. A correção passou nos três. Em Cursor r1, as duas tentativas de complete_task também violaram esse limite; o item falhou, o operator dependente foi bloqueado e create_task independente passou. O relatório permanece parcial, com verify failed, sem terceira tentativa. [Cinco rejeições reproduzidas offline](boundary-offline-replays.json) e [controle RED/GREEN da entidade](offline-line-count-reproduction/results.json). Código capturado permanece nos patches das tentativas; os workspaces materializados da reprodução ficam externos ao repositório.

Os contadores de comportamento do agregador somam respostas incorretas e tentativas de submissão rejeitadas: Codex 3 + 1 = 4; Cursor 5 + 5 = 10. Não são contagens de bugs distintos. Protocolo, infraestrutura, timeout e orçamento esgotado: zero nos seis runs. Tokens Codex disponíveis são somados pelas evidências; tokens Cursor incompletos e custos permanecem indisponíveis. Revisões de modelo não reportadas continuam desconhecidas.

## Proveniência e integridade

Fonte comum: **dc9a25d133fa71975dfd77713e00ea653a273a82**. Runner comum: **d5669b13b661986af9a3a1f2b0a5b0f5af8b8f0e**. Fingerprint da origem antes/depois de todos os runs: **11f596f55338a11a1f0dba2a7e2f6ee74ea859a3a7d784d27e8a525f1b14e245**. Origem limpa, sem mutações durante inferência. A publicação de evidências ocorreu somente depois dessa conferência.

Codex solicitado/observado gpt-6.1-sol, reasoningEffort high, CLI 0.162.1. Cursor solicitado gpt-5.3-codex, parâmetros {}, observado literalmente Codex 5.3 Medium, CLI 2026.10.01-e373342. Login local preservado. Hashes dos executáveis, ambientes, contextos, datasets e cinco contratos constam em cada report.json; baselines brutos com caminhos temporários permanecem como evidência e não definem equivalência entre campanhas. Dois grupos de proveniência, um por configuração.

Os seis report.json/report.md, configurações efetivas e artifact-manifest.json incluem todas as tentativas, prompts, respostas, auditorias, submissões e comandos. **2356 hashes de artefatos nativos** conferidos; schemas e evidências das aceitações também conferidos. [Rejulgamento offline das perguntas](question-offline-replays.json) mantém comparação estrita. Controle positivo [scripted](scripted-control/report.md): 25/25 perguntas e cinco packets, verify done; sessões scripted não entram no orçamento nativo.

O [manifesto anterior](initial-evidence-manifest.json) é a cópia byte-idêntica dos 1107 arquivos publicados em d5669b13b661986af9a3a1f2b0a5b0f5af8b8f0e. O [manifesto atual](../../2026-10-10-evals-evidence-manifest.json) inclui esta campanha. Scripts utilizados estão arquivados como .ts.txt; verificadores de fingerprint documentam a condição naquele instante, antes da publicação.

## Agregação reproduzível sem inferência

Da raiz do checkout:

```bash
bun run evals:aggregate --campaign evals/campaigns/cycle-20/index.json --out /tmp/cycle-20-aggregate-new
```

O destino deve ser novo. JSON, Markdown e manifesto são byte-idênticos em duas saídas independentes. O índice canônico referencia as seis evidências versionadas. index.json aqui é a captura externa original, com caminhos locais diferentes; planned-index-before-authorization.json e o agregado planned anterior preservam o estado antes da autorização. Os runs da #17 usam cinco perguntas e permanecem como referência separada.
