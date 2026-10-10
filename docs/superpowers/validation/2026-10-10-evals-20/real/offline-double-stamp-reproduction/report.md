# Avaliação 178a90e1-c027-4e80-8c47-beed716313e2

Modalidade: **scripted**. Estado: **completed**.

Fonte: dc9a25d133fa71975dfd77713e00ea653a273a82; runner: d5669b13b661986af9a3a1f2b0a5b0f5af8b8f0e. Bun 1.4.2, linux/x64.
Dataset/manifesto identificados por SHA-256. Manifesto: 0f86ec1b2a6e76d0b099d45717b01551be2c66a3efc08a4e51ac71c8798b708b.
Início: 2026-10-10T20:01:32.727Z; fim: 2026-10-10T20:02:22.198Z; duração: 49473 ms.
Sessões: 29/35. Teto global: 2700000 ms.
Saneamento na publicação: nenhuma remoção adicional; streams são saneados no supervisor antes da publicação.
Integridade da origem: antes 11f596f55338a11a1f0dba2a7e2f6ee74ea859a3a7d784d27e8a525f1b14e245; depois "11f596f55338a11a1f0dba2a7e2f6ee74ea859a3a7d784d27e8a525f1b14e245".

| Configuração | Adapter/versão | Modelo solicitado/parâmetros | Acurácia | Cobertura |
| --- | --- | --- | --- | --- |
| scripted-double-stamp | scripted scripted-v1 / Bun 1.4.2 | offline-fixture {} | 25/25 — 100.0% | 25/25 — 100.0% |

| Configuração/dataset/caso | Resultado | Modelo observado | Duração do agente (ms) |
| --- | --- | --- | --- |
| scripted-double-stamp/evals/skills/orders.yaml/confirmar-pedido | correct | "scripted" | 40 |
| scripted-double-stamp/evals/skills/orders.yaml/cancelar-com-motivo | correct | "scripted" | 49 |
| scripted-double-stamp/evals/skills/orders.yaml/cancelar-exige-aprovacao | correct | "scripted" | 45 |
| scripted-double-stamp/evals/skills/orders.yaml/confirmar-cancelado | correct | "scripted" | 49 |
| scripted-double-stamp/evals/skills/orders.yaml/onde-criar-use-case | correct | "scripted" | 48 |
| scripted-double-stamp/evals/skills/orders.extended.yaml/dev-positive-entity | correct | "scripted" | 40 |
| scripted-double-stamp/evals/skills/orders.extended.yaml/dev-positive-usecase | correct | "scripted" | 39 |
| scripted-double-stamp/evals/skills/orders.extended.yaml/dev-positive-uses | correct | "scripted" | 38 |
| scripted-double-stamp/evals/skills/orders.extended.yaml/dev-positive-public-method | correct | "scripted" | 39 |
| scripted-double-stamp/evals/skills/orders.extended.yaml/dev-positive-proposal | correct | "scripted" | 41 |
| scripted-double-stamp/evals/skills/orders.extended.yaml/dev-negative-static-done | correct | "scripted" | 39 |
| scripted-double-stamp/evals/skills/orders.extended.yaml/dev-negative-old-hash | correct | "scripted" | 40 |
| scripted-double-stamp/evals/skills/orders.extended.yaml/dev-negative-unexecuted-coverage | correct | "scripted" | 38 |
| scripted-double-stamp/evals/skills/orders.extended.yaml/dev-negative-empty-skeleton | correct | "scripted" | 19 |
| scripted-double-stamp/evals/skills/orders.extended.yaml/dev-negative-generated-edit | correct | "scripted" | 40 |
| scripted-double-stamp/evals/skills/orders.extended.yaml/runtime-positive-create | correct | "scripted" | 43 |
| scripted-double-stamp/evals/skills/orders.extended.yaml/runtime-positive-confirm | correct | "scripted" | 39 |
| scripted-double-stamp/evals/skills/orders.extended.yaml/runtime-positive-cancel | correct | "scripted" | 39 |
| scripted-double-stamp/evals/skills/orders.extended.yaml/runtime-positive-approval | correct | "scripted" | 39 |
| scripted-double-stamp/evals/skills/orders.extended.yaml/runtime-positive-transition | correct | "scripted" | 39 |
| scripted-double-stamp/evals/skills/orders.extended.yaml/runtime-negative-cancelled | correct | "scripted" | 39 |
| scripted-double-stamp/evals/skills/orders.extended.yaml/runtime-negative-confirmed | correct | "scripted" | 40 |
| scripted-double-stamp/evals/skills/orders.extended.yaml/runtime-negative-denied | correct | "scripted" | 41 |
| scripted-double-stamp/evals/skills/orders.extended.yaml/runtime-negative-no-reason | correct | "scripted" | 19 |
| scripted-double-stamp/evals/skills/orders.extended.yaml/runtime-negative-no-items | correct | "scripted" | 19 |

| Benchmark | Primeira tentativa | Final | Correções | Change | Agente/verificação (ms) |
| --- | --- | --- | --- | --- | --- |
| scripted-double-stamp | 3/5 — 60.0% | 3/5 — 60.0% | 0 | "failed" | 202/19415 |
- scripted-double-stamp/entity:Task: accepted; specHash e812964d310ea8fde3c4fa0dc8891177adc0150b7579cbea24c2fa8c61c8837c; 1 tentativa(s).
- scripted-double-stamp/method:Task.complete: accepted; specHash eb3ac3925470d446828c910dd206e6dd06b593b8dea5cd2ec4d247a0c8d88364; 1 tentativa(s).
- scripted-double-stamp/usecase:create_task: accepted; specHash daa3754aaa800ad41c37c1a18b62bc96b13314acac58caa0d1db37251389a4f6; 1 tentativa(s).
- scripted-double-stamp/usecase:complete_task: failed — independent_verification_failed; specHash c51f2de963ef8c242f9c9ba599d98f288b705342798064b5aa5bc4edf2d2428d; 1 tentativa(s).
- scripted-double-stamp/operator:task-operator: blocked — dependency_failed; specHash 78ae1ebe71bf55c9ce94b721f28f7f2850d9116d63a0d5beedfaba1148bbebf1; 0 tentativa(s).

Concordância de respostas estruturadas válidas (pode incluir erros iguais):

Fleiss κ binário: indisponível (insufficient_raters_or_rows); matriz 25/25, 1 configurações.

Uso agregado somente quando todos os componentes medidos estão disponíveis:
- scripted-double-stamp: input indisponível (incomplete_measurements); cached input indisponível (incomplete_measurements); output indisponível (incomplete_measurements); custo indisponível (incomplete_or_incompatible_costs).

Artefatos de evidência: 311. Checksums dos relatórios e das evidências em artifact-manifest.json; o manifest não inclui seu próprio hash.
