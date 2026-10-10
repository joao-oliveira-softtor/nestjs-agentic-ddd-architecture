# #17 — Certificação real de tasks

Os dois runs foram autorizados pela resposta `sim` do usuário ao limite de 30 sessões/90 minutos no total. Executaram sequencialmente em diretórios externos novos, com `--real --trusted-source`, autenticação local existente e os cinco casos originais. A campanha #20 não foi autorizada nem iniciada.

| Configuração | CLI observado | Modelo solicitado / observado | Perguntas | Packets inicial/final | verify 0001 | Sessões | Correções | Duração |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| codex-sol-high | codex-cli 0.162.1 | gpt-6.1-sol / gpt-6.1-sol | 4/5 | 5/5 / 5/5 | done | 10 | 0 | 496,225 s |
| cursor-codex-medium | 2026.10.01-e373342 | gpt-5.3-codex / Codex 5.3 Medium | 3/5 | 5/5 / 5/5 | done | 10 | 0 | 441,626 s |

Cada packet foi aceito na primeira tentativa, com auditoria aprovada, testes do executor e oráculo independente verdes, item verify = done e compile --check aprovado. O operator continua declarativo; o teste aceito exercita suas tools reais. A change foi certificada independentemente ao final de cada run. O aceite não acrescenta limiar de acurácia das perguntas.

Os limites por configuração permaneceram em 15 sessões/45 minutos, skillTimeoutMs 120000, implementationTimeoutMs 600000, uma correção por item, repetitions 1 e concurrency 1. O consumo foi de 20 sessões reais e 937,851 segundos (cerca de 15,6 minutos), além do controle scripted offline. Não houve repetição de campanha, reparo manual de submissão ou relaxamento de gates.

## Fonte e integridade

- Fonte comum congelada: `0cbd74bcdaf662f1eb07afc613b3b89b08c2d425`, contendo o protocolo JSON corrigido.
- Runner comum: `e0e0c2369a321a574c01cd1f491e15e50f3699cc`.
- Fingerprint da origem nos dois runs, antes e depois: `ce48623159e042acdccef0a1f1ba2bbbf44af99870558f9ce1bb198e903b766f`.
- Manifestos efetivos conferidos contra [Codex](codex-manifest.json) e [Cursor](cursor-manifest.json); todos os hashes/bytes dos artefatos conferidos: 246 por Codex, 236 por Cursor e 223 no controle scripted fresco.
- Modelos observados preservam os nomes fornecidos pelos CLIs. Revisões dos modelos e custos permanecem indisponíveis; uso de tokens permanece conforme medições nativas, sem estimativa.
- Baselines brutos e hashes de cada tentativa estão nos relatórios. Caminhos temporários podem alterar hashes das árvores; sua igualdade não é usada para afirmar equivalência entre runs.
- Framework público, orders, dataset original e referência histórica não foram alterados.

## Evidências

- [Autorização e preflight](authorization-and-preflight.json), [controle scripted fresco](scripted-control/report.md) e [validação dos dois runs](all-results-validation.log).
- [Validador usado antes da publicação](validate-results-before-publication.ts.txt): schema, configuração efetiva, gates, hashes e origem conferidos no checkout limpo do runner e0e0c23. A comparação com a origem viva aplica-se ao instante anterior à publicação; os arquivos novos de evidência alteram o fingerprint do checkout posteriormente.
- [Resumo JSON validado](validated-results.json).
- Codex: [JSON](codex-sol-high/report.json), [Markdown](codex-sol-high/report.md), [todos os artefatos e hashes](codex-sol-high/artifact-manifest.json).
- Cursor: [JSON](cursor-codex-medium/report.json), [Markdown](cursor-codex-medium/report.md), [todos os artefatos e hashes](cursor-codex-medium/artifact-manifest.json).
- Prompts, configurações, respostas, submissões, auditorias, gates e JUnit de todas as tentativas estão nas respectivas pastas dos relatórios. Os artefatos revisados não contêm os valores conhecidos das credenciais usadas.
- [Manifesto inicial offline preservado](initial-offline-evidence-manifest.json) corresponde ao commit e0e0c2369a321a574c01cd1f491e15e50f3699cc, antes desta publicação. O manifesto do ciclo foi atualizado para incluir a certificação e os documentos atuais.

## Diferenças nas perguntas e reprodução offline

Codex e Cursor forneceram texto adicional na resposta de caminho/decorator de `refund_order`, em vez do valor literal esperado. Cursor também usou `cliente desistiu` como motivo de cancelamento, enquanto o valor esperado era `desistiu`. As respostas completas foram preservadas e os três julgamentos foram reproduzidos offline com parseAnswer/judge, sem normalização:

- [Reprodução Codex](codex-question-offline-replay.json).
- [Reprodução Cursor](cursor-question-offline-replay.json).

Nenhuma instrução ou expectativa foi alterada após esses resultados. Estes runs permanecem como referência de cinco perguntas; os seis runs planejados de #20 terão 25 perguntas e orçamento próprio.
