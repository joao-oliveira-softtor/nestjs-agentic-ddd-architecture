# Avaliação 384221ea-2ae9-4ac8-ba83-997ad82a8350

Modalidade: **real**. Estado: **cancelled**.

Fonte: 7761216b422cca67f31f87e3c0c57e08a285950d; runner: 7761216b422cca67f31f87e3c0c57e08a285950d. Bun 1.4.2, linux/x64.
Dataset/manifesto identificados por SHA-256. Manifesto: 8298986a6b4b045d59a63944e283131d1cbd41716ee0f7c2db9ef66c5964bc91.
Início: 2026-10-09T04:50:58.413Z; fim: 2026-10-09T04:53:23.154Z; duração: 144741 ms.
Sessões: 10/30. Teto global: 5400000 ms.
Saneamento na publicação: nenhuma remoção adicional; streams são saneados no supervisor antes da publicação.
Integridade da origem: antes a8be32eac86f659fe9dd02e8611fe8de4be582ebc56687af6d92de1e3ae975d5; depois "a8be32eac86f659fe9dd02e8611fe8de4be582ebc56687af6d92de1e3ae975d5".

| Configuração | Adapter/versão | Modelo solicitado/parâmetros | Acurácia | Cobertura |
| --- | --- | --- | --- | --- |
| codex-sol-high | codex-cli codex-cli 0.162.0 | gpt-6.1-sol {"reasoningEffort":"high"} | 1/5 — 20.0% | 5/5 — 100.0% |
| cursor-codex-medium | cursor-cli 2026.10.01-e373342 | gpt-5.3-codex {} | 4/4 — 100.0% | 4/5 — 80.0% |

| Configuração/dataset/caso | Resultado | Modelo observado | Duração do agente (ms) |
| --- | --- | --- | --- |
| codex-sol-high/evals/skills/orders.yaml/confirmar-pedido | incorrect | "gpt-6.1-sol" | 13934 |
| codex-sol-high/evals/skills/orders.yaml/cancelar-com-motivo | incorrect | "gpt-6.1-sol" | 13280 |
| codex-sol-high/evals/skills/orders.yaml/cancelar-exige-aprovacao | incorrect | "gpt-6.1-sol" | 15489 |
| codex-sol-high/evals/skills/orders.yaml/confirmar-cancelado | correct | "gpt-6.1-sol" | 9713 |
| codex-sol-high/evals/skills/orders.yaml/onde-criar-use-case | incorrect | "gpt-6.1-sol" | 13756 |
| cursor-codex-medium/evals/skills/orders.yaml/confirmar-pedido | correct | "Codex 5.3 Medium" | 15639 |
| cursor-codex-medium/evals/skills/orders.yaml/cancelar-com-motivo | correct | "Codex 5.3 Medium" | 14183 |
| cursor-codex-medium/evals/skills/orders.yaml/cancelar-exige-aprovacao | correct | "Codex 5.3 Medium" | 13204 |
| cursor-codex-medium/evals/skills/orders.yaml/confirmar-cancelado | correct | "Codex 5.3 Medium" | 17090 |
| cursor-codex-medium/evals/skills/orders.yaml/onde-criar-use-case | not_run — cancelled | "Codex 5.3 Medium" | 10454 |

| Benchmark | Primeira tentativa | Final | Correções | Change | Agente/verificação (ms) |
| --- | --- | --- | --- | --- | --- |
| codex-sol-high | 0/5 — 0.0% | 0/5 — 0.0% | 0 | indisponível (verification_unavailable) | 0/0 |
| cursor-codex-medium | 0/5 — 0.0% | 0/5 — 0.0% | 0 | indisponível (verification_unavailable) | 0/0 |
- codex-sol-high/entity:Task: not_run — cancelled; specHash e812964d310ea8fde3c4fa0dc8891177adc0150b7579cbea24c2fa8c61c8837c; 0 tentativa(s).
- codex-sol-high/method:Task.complete: not_run — cancelled; specHash eb3ac3925470d446828c910dd206e6dd06b593b8dea5cd2ec4d247a0c8d88364; 0 tentativa(s).
- codex-sol-high/usecase:create_task: not_run — cancelled; specHash daa3754aaa800ad41c37c1a18b62bc96b13314acac58caa0d1db37251389a4f6; 0 tentativa(s).
- codex-sol-high/usecase:complete_task: not_run — cancelled; specHash c51f2de963ef8c242f9c9ba599d98f288b705342798064b5aa5bc4edf2d2428d; 0 tentativa(s).
- codex-sol-high/operator:task-operator: not_run — cancelled; specHash 78ae1ebe71bf55c9ce94b721f28f7f2850d9116d63a0d5beedfaba1148bbebf1; 0 tentativa(s).
- cursor-codex-medium/entity:Task: not_run — cancelled; specHash e812964d310ea8fde3c4fa0dc8891177adc0150b7579cbea24c2fa8c61c8837c; 0 tentativa(s).
- cursor-codex-medium/method:Task.complete: not_run — cancelled; specHash eb3ac3925470d446828c910dd206e6dd06b593b8dea5cd2ec4d247a0c8d88364; 0 tentativa(s).
- cursor-codex-medium/usecase:create_task: not_run — cancelled; specHash daa3754aaa800ad41c37c1a18b62bc96b13314acac58caa0d1db37251389a4f6; 0 tentativa(s).
- cursor-codex-medium/usecase:complete_task: not_run — cancelled; specHash c51f2de963ef8c242f9c9ba599d98f288b705342798064b5aa5bc4edf2d2428d; 0 tentativa(s).
- cursor-codex-medium/operator:task-operator: not_run — cancelled; specHash 78ae1ebe71bf55c9ce94b721f28f7f2850d9116d63a0d5beedfaba1148bbebf1; 0 tentativa(s).

Concordância de respostas estruturadas válidas (pode incluir erros iguais):
- codex-sol-high × cursor-codex-medium: 1/4 — 25.0%; cobertura 4/5 — 80.0%.

Fleiss κ binário: -0.6; matriz 4/5, 2 configurações.

Uso agregado somente quando todos os componentes medidos estão disponíveis:
- codex-sol-high: input 148830; cached input 129792; output 1269; custo indisponível (incomplete_or_incompatible_costs).
- cursor-codex-medium: input indisponível (incomplete_measurements); cached input indisponível (incomplete_measurements); output indisponível (incomplete_measurements); custo indisponível (incomplete_or_incompatible_costs).

Artefatos de evidência: 97. Checksums dos relatórios e das evidências em artifact-manifest.json; o manifest não inclui seu próprio hash.
