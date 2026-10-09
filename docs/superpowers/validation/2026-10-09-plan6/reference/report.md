# Avaliação 0281038f-d1a9-498b-a38c-e6f964804871

Modalidade: **real**. Estado: **budget_exhausted**.

Fonte: 873ea8c8c6bec90595efd9d29a3bb6d3861cf35b; runner: 873ea8c8c6bec90595efd9d29a3bb6d3861cf35b. Bun 1.4.2, linux/x64.
Dataset/manifesto identificados por SHA-256. Manifesto: c9a8a7a98f8edaaa5145c38f4ae5cd2ec5733b3c9bfaeb167fa4032dd68729ff.
Início: 2026-10-09T05:05:08.082Z; fim: 2026-10-09T05:21:41.274Z; duração: 993192 ms.
Sessões: 20/20. Teto global: 5255258 ms.
Saneamento na publicação: nenhuma remoção adicional; streams são saneados no supervisor antes da publicação.
Integridade da origem: antes 9a2c5b04ed5d6b5fffdb03b8e60fec6393e640db0e056c6c1b96675f01f3ef79; depois "9a2c5b04ed5d6b5fffdb03b8e60fec6393e640db0e056c6c1b96675f01f3ef79".

| Configuração | Adapter/versão | Modelo solicitado/parâmetros | Acurácia | Cobertura |
| --- | --- | --- | --- | --- |
| codex-sol-high | codex-cli codex-cli 0.162.0 | gpt-6.1-sol {"reasoningEffort":"high"} | 4/5 — 80.0% | 5/5 — 100.0% |
| cursor-codex-medium | cursor-cli 2026.10.01-e373342 | gpt-5.3-codex {} | 4/5 — 80.0% | 5/5 — 100.0% |

| Configuração/dataset/caso | Resultado | Modelo observado | Duração do agente (ms) |
| --- | --- | --- | --- |
| codex-sol-high/evals/skills/orders.yaml/confirmar-pedido | correct | "gpt-6.1-sol" | 9320 |
| codex-sol-high/evals/skills/orders.yaml/cancelar-com-motivo | correct | "gpt-6.1-sol" | 9222 |
| codex-sol-high/evals/skills/orders.yaml/cancelar-exige-aprovacao | correct | "gpt-6.1-sol" | 7418 |
| codex-sol-high/evals/skills/orders.yaml/confirmar-cancelado | correct | "gpt-6.1-sol" | 9600 |
| codex-sol-high/evals/skills/orders.yaml/onde-criar-use-case | incorrect | "gpt-6.1-sol" | 11375 |
| cursor-codex-medium/evals/skills/orders.yaml/confirmar-pedido | correct | "Codex 5.3 Medium" | 14625 |
| cursor-codex-medium/evals/skills/orders.yaml/cancelar-com-motivo | correct | "Codex 5.3 Medium" | 16164 |
| cursor-codex-medium/evals/skills/orders.yaml/cancelar-exige-aprovacao | correct | "Codex 5.3 Medium" | 14130 |
| cursor-codex-medium/evals/skills/orders.yaml/confirmar-cancelado | correct | "Codex 5.3 Medium" | 17377 |
| cursor-codex-medium/evals/skills/orders.yaml/onde-criar-use-case | incorrect | "Codex 5.3 Medium" | 21756 |

| Benchmark | Primeira tentativa | Final | Correções | Change | Agente/verificação (ms) |
| --- | --- | --- | --- | --- | --- |
| codex-sol-high | 2/5 — 40.0% | 3/5 — 60.0% | 2 | "failed" | 520414/8553 |
| cursor-codex-medium | 4/5 — 80.0% | 4/5 — 80.0% | 0 | indisponível (verification_unavailable) | 292938/11461 |
- codex-sol-high/entity:Task: accepted; specHash e812964d310ea8fde3c4fa0dc8891177adc0150b7579cbea24c2fa8c61c8837c; 1 tentativa(s).
- codex-sol-high/method:Task.complete: accepted; specHash eb3ac3925470d446828c910dd206e6dd06b593b8dea5cd2ec4d247a0c8d88364; 1 tentativa(s).
- codex-sol-high/usecase:create_task: failed — invalid_implementation_reply; specHash daa3754aaa800ad41c37c1a18b62bc96b13314acac58caa0d1db37251389a4f6; 2 tentativa(s).
- codex-sol-high/usecase:complete_task: accepted; specHash c51f2de963ef8c242f9c9ba599d98f288b705342798064b5aa5bc4edf2d2428d; 2 tentativa(s).
- codex-sol-high/operator:task-operator: blocked — dependency_failed; specHash 78ae1ebe71bf55c9ce94b721f28f7f2850d9116d63a0d5beedfaba1148bbebf1; 0 tentativa(s).
- cursor-codex-medium/entity:Task: accepted; specHash e812964d310ea8fde3c4fa0dc8891177adc0150b7579cbea24c2fa8c61c8837c; 1 tentativa(s).
- cursor-codex-medium/method:Task.complete: accepted; specHash eb3ac3925470d446828c910dd206e6dd06b593b8dea5cd2ec4d247a0c8d88364; 1 tentativa(s).
- cursor-codex-medium/usecase:create_task: accepted; specHash daa3754aaa800ad41c37c1a18b62bc96b13314acac58caa0d1db37251389a4f6; 1 tentativa(s).
- cursor-codex-medium/usecase:complete_task: accepted; specHash c51f2de963ef8c242f9c9ba599d98f288b705342798064b5aa5bc4edf2d2428d; 1 tentativa(s).
- cursor-codex-medium/operator:task-operator: not_run — budget_exhausted; specHash 78ae1ebe71bf55c9ce94b721f28f7f2850d9116d63a0d5beedfaba1148bbebf1; 0 tentativa(s).

Concordância de respostas estruturadas válidas (pode incluir erros iguais):
- codex-sol-high × cursor-codex-medium: 4/5 — 80.0%; cobertura 5/5 — 100.0%.

Fleiss κ binário: 1; matriz 5/5, 2 configurações.

Uso agregado somente quando todos os componentes medidos estão disponíveis:
- codex-sol-high: input 1242177; cached input 1057536; output 21061; custo indisponível (incomplete_or_incompatible_costs).
- cursor-codex-medium: input indisponível (incomplete_measurements); cached input indisponível (incomplete_measurements); output indisponível (incomplete_measurements); custo indisponível (incomplete_or_incompatible_costs).

Artefatos de evidência: 387. Checksums dos relatórios e das evidências em artifact-manifest.json; o manifest não inclui seu próprio hash.
