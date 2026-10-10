# Avaliação 9f42c803-93f7-4a8a-8148-fc4dcd30b6a4

Modalidade: **scripted**. Estado: **completed**.

Fonte: dc9a25d133fa71975dfd77713e00ea653a273a82; runner: d5669b13b661986af9a3a1f2b0a5b0f5af8b8f0e. Bun 1.4.2, linux/x64.
Dataset/manifesto identificados por SHA-256. Manifesto: 7cc29f00de40983c23504a959615a2e7f8cca14544c75b3edffce1fc6c40588e.
Início: 2026-10-10T19:50:23.267Z; fim: 2026-10-10T19:51:05.859Z; duração: 42595 ms.
Sessões: 30/35. Teto global: 2700000 ms.
Saneamento na publicação: nenhuma remoção adicional; streams são saneados no supervisor antes da publicação.
Integridade da origem: antes 11f596f55338a11a1f0dba2a7e2f6ee74ea859a3a7d784d27e8a525f1b14e245; depois "11f596f55338a11a1f0dba2a7e2f6ee74ea859a3a7d784d27e8a525f1b14e245".

| Configuração | Adapter/versão | Modelo solicitado/parâmetros | Acurácia | Cobertura |
| --- | --- | --- | --- | --- |
| scripted-control | scripted scripted-v1 / Bun 1.4.2 | offline-fixture {} | 25/25 — 100.0% | 25/25 — 100.0% |

| Configuração/dataset/caso | Resultado | Modelo observado | Duração do agente (ms) |
| --- | --- | --- | --- |
| scripted-control/evals/skills/orders.yaml/confirmar-pedido | correct | "scripted" | 41 |
| scripted-control/evals/skills/orders.yaml/cancelar-com-motivo | correct | "scripted" | 40 |
| scripted-control/evals/skills/orders.yaml/cancelar-exige-aprovacao | correct | "scripted" | 44 |
| scripted-control/evals/skills/orders.yaml/confirmar-cancelado | correct | "scripted" | 44 |
| scripted-control/evals/skills/orders.yaml/onde-criar-use-case | correct | "scripted" | 44 |
| scripted-control/evals/skills/orders.extended.yaml/dev-positive-entity | correct | "scripted" | 44 |
| scripted-control/evals/skills/orders.extended.yaml/dev-positive-usecase | correct | "scripted" | 41 |
| scripted-control/evals/skills/orders.extended.yaml/dev-positive-uses | correct | "scripted" | 39 |
| scripted-control/evals/skills/orders.extended.yaml/dev-positive-public-method | correct | "scripted" | 38 |
| scripted-control/evals/skills/orders.extended.yaml/dev-positive-proposal | correct | "scripted" | 38 |
| scripted-control/evals/skills/orders.extended.yaml/dev-negative-static-done | correct | "scripted" | 37 |
| scripted-control/evals/skills/orders.extended.yaml/dev-negative-old-hash | correct | "scripted" | 36 |
| scripted-control/evals/skills/orders.extended.yaml/dev-negative-unexecuted-coverage | correct | "scripted" | 38 |
| scripted-control/evals/skills/orders.extended.yaml/dev-negative-empty-skeleton | correct | "scripted" | 18 |
| scripted-control/evals/skills/orders.extended.yaml/dev-negative-generated-edit | correct | "scripted" | 40 |
| scripted-control/evals/skills/orders.extended.yaml/runtime-positive-create | correct | "scripted" | 37 |
| scripted-control/evals/skills/orders.extended.yaml/runtime-positive-confirm | correct | "scripted" | 17 |
| scripted-control/evals/skills/orders.extended.yaml/runtime-positive-cancel | correct | "scripted" | 37 |
| scripted-control/evals/skills/orders.extended.yaml/runtime-positive-approval | correct | "scripted" | 37 |
| scripted-control/evals/skills/orders.extended.yaml/runtime-positive-transition | correct | "scripted" | 36 |
| scripted-control/evals/skills/orders.extended.yaml/runtime-negative-cancelled | correct | "scripted" | 38 |
| scripted-control/evals/skills/orders.extended.yaml/runtime-negative-confirmed | correct | "scripted" | 39 |
| scripted-control/evals/skills/orders.extended.yaml/runtime-negative-denied | correct | "scripted" | 37 |
| scripted-control/evals/skills/orders.extended.yaml/runtime-negative-no-reason | correct | "scripted" | 36 |
| scripted-control/evals/skills/orders.extended.yaml/runtime-negative-no-items | correct | "scripted" | 36 |

| Benchmark | Primeira tentativa | Final | Correções | Change | Agente/verificação (ms) |
| --- | --- | --- | --- | --- | --- |
| scripted-control | 5/5 — 100.0% | 5/5 — 100.0% | 0 | "done" | 199/17659 |
- scripted-control/entity:Task: accepted; specHash e812964d310ea8fde3c4fa0dc8891177adc0150b7579cbea24c2fa8c61c8837c; 1 tentativa(s).
- scripted-control/method:Task.complete: accepted; specHash eb3ac3925470d446828c910dd206e6dd06b593b8dea5cd2ec4d247a0c8d88364; 1 tentativa(s).
- scripted-control/usecase:create_task: accepted; specHash daa3754aaa800ad41c37c1a18b62bc96b13314acac58caa0d1db37251389a4f6; 1 tentativa(s).
- scripted-control/usecase:complete_task: accepted; specHash c51f2de963ef8c242f9c9ba599d98f288b705342798064b5aa5bc4edf2d2428d; 1 tentativa(s).
- scripted-control/operator:task-operator: accepted; specHash 78ae1ebe71bf55c9ce94b721f28f7f2850d9116d63a0d5beedfaba1148bbebf1; 1 tentativa(s).

Concordância de respostas estruturadas válidas (pode incluir erros iguais):

Fleiss κ binário: indisponível (insufficient_raters_or_rows); matriz 25/25, 1 configurações.

Uso agregado somente quando todos os componentes medidos estão disponíveis:
- scripted-control: input indisponível (incomplete_measurements); cached input indisponível (incomplete_measurements); output indisponível (incomplete_measurements); custo indisponível (incomplete_or_incompatible_costs).

Artefatos de evidência: 341. Checksums dos relatórios e das evidências em artifact-manifest.json; o manifest não inclui seu próprio hash.
