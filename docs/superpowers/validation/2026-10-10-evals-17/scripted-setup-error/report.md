# Avaliação a56264d1-f41d-47cb-840f-3f3f44084378

Modalidade: **scripted**. Estado: **completed**.

Fonte: 0cbd74bcdaf662f1eb07afc613b3b89b08c2d425; runner: d6ef40b39ee00507c0e1a8d66ddfeb4af27a5833. Bun 1.4.2, linux/x64.
Dataset/manifesto identificados por SHA-256. Manifesto: 5d2ad11ef9cb140f9ae9dcc1ad02c41f05f6a52d808853bd9bb2e921285d7f2b.
Início: 2026-10-10T13:42:29.775Z; fim: 2026-10-10T13:42:48.237Z; duração: 18462 ms.
Sessões: 7/15. Teto global: 2700000 ms.
Saneamento na publicação: nenhuma remoção adicional; streams são saneados no supervisor antes da publicação.
Integridade da origem: antes 95d563be2d2b189a1a5620464ac83d0154265e83c1c88b1d66f5708b392bf3cd; depois "95d563be2d2b189a1a5620464ac83d0154265e83c1c88b1d66f5708b392bf3cd".

| Configuração | Adapter/versão | Modelo solicitado/parâmetros | Acurácia | Cobertura |
| --- | --- | --- | --- | --- |
| scripted-control | scripted scripted-v1 / Bun 1.4.2 | offline-fixture {} | 0/5 — 0.0% | 5/5 — 100.0% |

| Configuração/dataset/caso | Resultado | Modelo observado | Duração do agente (ms) |
| --- | --- | --- | --- |
| scripted-control/evals/skills/orders.yaml/confirmar-pedido | incorrect | "scripted" | 39 |
| scripted-control/evals/skills/orders.yaml/cancelar-com-motivo | incorrect | "scripted" | 40 |
| scripted-control/evals/skills/orders.yaml/cancelar-exige-aprovacao | incorrect | "scripted" | 38 |
| scripted-control/evals/skills/orders.yaml/confirmar-cancelado | incorrect | "scripted" | 38 |
| scripted-control/evals/skills/orders.yaml/onde-criar-use-case | incorrect | "scripted" | 38 |

| Benchmark | Primeira tentativa | Final | Correções | Change | Agente/verificação (ms) |
| --- | --- | --- | --- | --- | --- |
| scripted-control | 0/5 — 0.0% | 0/5 — 0.0% | 1 | "failed" | 86/0 |
- scripted-control/entity:Task: failed — declared_blocked; specHash e812964d310ea8fde3c4fa0dc8891177adc0150b7579cbea24c2fa8c61c8837c; 2 tentativa(s).
- scripted-control/method:Task.complete: blocked — dependency_failed; specHash eb3ac3925470d446828c910dd206e6dd06b593b8dea5cd2ec4d247a0c8d88364; 0 tentativa(s).
- scripted-control/usecase:create_task: blocked — dependency_failed; specHash daa3754aaa800ad41c37c1a18b62bc96b13314acac58caa0d1db37251389a4f6; 0 tentativa(s).
- scripted-control/usecase:complete_task: blocked — dependency_failed; specHash c51f2de963ef8c242f9c9ba599d98f288b705342798064b5aa5bc4edf2d2428d; 0 tentativa(s).
- scripted-control/operator:task-operator: blocked — dependency_failed; specHash 78ae1ebe71bf55c9ce94b721f28f7f2850d9116d63a0d5beedfaba1148bbebf1; 0 tentativa(s).

Concordância de respostas estruturadas válidas (pode incluir erros iguais):

Fleiss κ binário: indisponível (insufficient_raters_or_rows); matriz 5/5, 1 configurações.

Uso agregado somente quando todos os componentes medidos estão disponíveis:
- scripted-control: input indisponível (incomplete_measurements); cached input indisponível (incomplete_measurements); output indisponível (incomplete_measurements); custo indisponível (incomplete_or_incompatible_costs).

Artefatos de evidência: 94. Checksums dos relatórios e das evidências em artifact-manifest.json; o manifest não inclui seu próprio hash.
