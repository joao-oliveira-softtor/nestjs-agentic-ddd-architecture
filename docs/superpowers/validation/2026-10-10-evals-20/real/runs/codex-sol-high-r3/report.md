# Avaliação c0fd5dd7-2ca0-40b5-9710-1031ce9f2c57

Modalidade: **real**. Estado: **completed**.

Fonte: dc9a25d133fa71975dfd77713e00ea653a273a82; runner: d5669b13b661986af9a3a1f2b0a5b0f5af8b8f0e. Bun 1.4.2, linux/x64.
Fonte confiável reconhecida explicitamente. Ferramentas dos CLIs nativos têm acesso às credenciais e à rede do host; o verificador permanece sem credenciais/rede.
Dataset/manifesto identificados por SHA-256. Manifesto: ddb53dc26cca4bfa224c1354f1efdec95d600766c571c5f353c05dd66b90c436.
Início: 2026-10-10T20:15:50.832Z; fim: 2026-10-10T20:27:25.812Z; duração: 695026 ms.
Sessões: 30/35. Teto global: 2700000 ms.
Saneamento na publicação: nenhuma remoção adicional; streams são saneados no supervisor antes da publicação.
Integridade da origem: antes 11f596f55338a11a1f0dba2a7e2f6ee74ea859a3a7d784d27e8a525f1b14e245; depois "11f596f55338a11a1f0dba2a7e2f6ee74ea859a3a7d784d27e8a525f1b14e245".

| Configuração | Adapter/versão | Modelo solicitado/parâmetros | Acurácia | Cobertura |
| --- | --- | --- | --- | --- |
| codex-sol-high | codex-cli codex-cli 0.162.1 | gpt-6.1-sol {"reasoningEffort":"high"} | 24/25 — 96.0% | 25/25 — 100.0% |

| Configuração/dataset/caso | Resultado | Modelo observado | Duração do agente (ms) |
| --- | --- | --- | --- |
| codex-sol-high/evals/skills/orders.yaml/confirmar-pedido | correct | "gpt-6.1-sol" | 8676 |
| codex-sol-high/evals/skills/orders.yaml/cancelar-com-motivo | correct | "gpt-6.1-sol" | 10238 |
| codex-sol-high/evals/skills/orders.yaml/cancelar-exige-aprovacao | correct | "gpt-6.1-sol" | 7562 |
| codex-sol-high/evals/skills/orders.yaml/confirmar-cancelado | correct | "gpt-6.1-sol" | 8593 |
| codex-sol-high/evals/skills/orders.yaml/onde-criar-use-case | incorrect | "gpt-6.1-sol" | 10107 |
| codex-sol-high/evals/skills/orders.extended.yaml/dev-positive-entity | correct | "gpt-6.1-sol" | 15012 |
| codex-sol-high/evals/skills/orders.extended.yaml/dev-positive-usecase | correct | "gpt-6.1-sol" | 13715 |
| codex-sol-high/evals/skills/orders.extended.yaml/dev-positive-uses | correct | "gpt-6.1-sol" | 8618 |
| codex-sol-high/evals/skills/orders.extended.yaml/dev-positive-public-method | correct | "gpt-6.1-sol" | 10382 |
| codex-sol-high/evals/skills/orders.extended.yaml/dev-positive-proposal | correct | "gpt-6.1-sol" | 8003 |
| codex-sol-high/evals/skills/orders.extended.yaml/dev-negative-static-done | correct | "gpt-6.1-sol" | 8423 |
| codex-sol-high/evals/skills/orders.extended.yaml/dev-negative-old-hash | correct | "gpt-6.1-sol" | 8919 |
| codex-sol-high/evals/skills/orders.extended.yaml/dev-negative-unexecuted-coverage | correct | "gpt-6.1-sol" | 9842 |
| codex-sol-high/evals/skills/orders.extended.yaml/dev-negative-empty-skeleton | correct | "gpt-6.1-sol" | 9614 |
| codex-sol-high/evals/skills/orders.extended.yaml/dev-negative-generated-edit | correct | "gpt-6.1-sol" | 11941 |
| codex-sol-high/evals/skills/orders.extended.yaml/runtime-positive-create | correct | "gpt-6.1-sol" | 9134 |
| codex-sol-high/evals/skills/orders.extended.yaml/runtime-positive-confirm | correct | "gpt-6.1-sol" | 7830 |
| codex-sol-high/evals/skills/orders.extended.yaml/runtime-positive-cancel | correct | "gpt-6.1-sol" | 8786 |
| codex-sol-high/evals/skills/orders.extended.yaml/runtime-positive-approval | correct | "gpt-6.1-sol" | 8438 |
| codex-sol-high/evals/skills/orders.extended.yaml/runtime-positive-transition | correct | "gpt-6.1-sol" | 8753 |
| codex-sol-high/evals/skills/orders.extended.yaml/runtime-negative-cancelled | correct | "gpt-6.1-sol" | 8186 |
| codex-sol-high/evals/skills/orders.extended.yaml/runtime-negative-confirmed | correct | "gpt-6.1-sol" | 10115 |
| codex-sol-high/evals/skills/orders.extended.yaml/runtime-negative-denied | correct | "gpt-6.1-sol" | 10285 |
| codex-sol-high/evals/skills/orders.extended.yaml/runtime-negative-no-reason | correct | "gpt-6.1-sol" | 7878 |
| codex-sol-high/evals/skills/orders.extended.yaml/runtime-negative-no-items | correct | "gpt-6.1-sol" | 8517 |

| Benchmark | Primeira tentativa | Final | Correções | Change | Agente/verificação (ms) |
| --- | --- | --- | --- | --- | --- |
| codex-sol-high | 5/5 — 100.0% | 5/5 — 100.0% | 0 | "done" | 395824/21846 |
- codex-sol-high/entity:Task: accepted; specHash e812964d310ea8fde3c4fa0dc8891177adc0150b7579cbea24c2fa8c61c8837c; 1 tentativa(s).
- codex-sol-high/method:Task.complete: accepted; specHash eb3ac3925470d446828c910dd206e6dd06b593b8dea5cd2ec4d247a0c8d88364; 1 tentativa(s).
- codex-sol-high/usecase:create_task: accepted; specHash daa3754aaa800ad41c37c1a18b62bc96b13314acac58caa0d1db37251389a4f6; 1 tentativa(s).
- codex-sol-high/usecase:complete_task: accepted; specHash c51f2de963ef8c242f9c9ba599d98f288b705342798064b5aa5bc4edf2d2428d; 1 tentativa(s).
- codex-sol-high/operator:task-operator: accepted; specHash 78ae1ebe71bf55c9ce94b721f28f7f2850d9116d63a0d5beedfaba1148bbebf1; 1 tentativa(s).

Concordância de respostas estruturadas válidas (pode incluir erros iguais):

Fleiss κ binário: indisponível (insufficient_raters_or_rows); matriz 25/25, 1 configurações.

Uso agregado somente quando todos os componentes medidos estão disponíveis:
- codex-sol-high: input 2165089; cached input 1898752; output 20414; custo indisponível (incomplete_or_incompatible_costs).

Artefatos de evidência: 404. Checksums dos relatórios e das evidências em artifact-manifest.json; o manifest não inclui seu próprio hash.
