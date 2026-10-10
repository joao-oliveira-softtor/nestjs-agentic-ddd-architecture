# Avaliação 32bd54f0-067e-418c-b818-3c2c98e3384d

Modalidade: **real**. Estado: **completed**.

Fonte: dc9a25d133fa71975dfd77713e00ea653a273a82; runner: d5669b13b661986af9a3a1f2b0a5b0f5af8b8f0e. Bun 1.4.2, linux/x64.
Fonte confiável reconhecida explicitamente. Ferramentas dos CLIs nativos têm acesso às credenciais e à rede do host; o verificador permanece sem credenciais/rede.
Dataset/manifesto identificados por SHA-256. Manifesto: ddb53dc26cca4bfa224c1354f1efdec95d600766c571c5f353c05dd66b90c436.
Início: 2026-10-10T19:51:37.305Z; fim: 2026-10-10T20:03:52.629Z; duração: 735375 ms.
Sessões: 31/35. Teto global: 2700000 ms.
Saneamento na publicação: nenhuma remoção adicional; streams são saneados no supervisor antes da publicação.
Integridade da origem: antes 11f596f55338a11a1f0dba2a7e2f6ee74ea859a3a7d784d27e8a525f1b14e245; depois "11f596f55338a11a1f0dba2a7e2f6ee74ea859a3a7d784d27e8a525f1b14e245".

| Configuração | Adapter/versão | Modelo solicitado/parâmetros | Acurácia | Cobertura |
| --- | --- | --- | --- | --- |
| codex-sol-high | codex-cli codex-cli 0.162.1 | gpt-6.1-sol {"reasoningEffort":"high"} | 24/25 — 96.0% | 25/25 — 100.0% |

| Configuração/dataset/caso | Resultado | Modelo observado | Duração do agente (ms) |
| --- | --- | --- | --- |
| codex-sol-high/evals/skills/orders.yaml/confirmar-pedido | correct | "gpt-6.1-sol" | 9397 |
| codex-sol-high/evals/skills/orders.yaml/cancelar-com-motivo | correct | "gpt-6.1-sol" | 10494 |
| codex-sol-high/evals/skills/orders.yaml/cancelar-exige-aprovacao | correct | "gpt-6.1-sol" | 7316 |
| codex-sol-high/evals/skills/orders.yaml/confirmar-cancelado | correct | "gpt-6.1-sol" | 12738 |
| codex-sol-high/evals/skills/orders.yaml/onde-criar-use-case | incorrect | "gpt-6.1-sol" | 12563 |
| codex-sol-high/evals/skills/orders.extended.yaml/dev-positive-entity | correct | "gpt-6.1-sol" | 12922 |
| codex-sol-high/evals/skills/orders.extended.yaml/dev-positive-usecase | correct | "gpt-6.1-sol" | 8746 |
| codex-sol-high/evals/skills/orders.extended.yaml/dev-positive-uses | correct | "gpt-6.1-sol" | 14493 |
| codex-sol-high/evals/skills/orders.extended.yaml/dev-positive-public-method | correct | "gpt-6.1-sol" | 9261 |
| codex-sol-high/evals/skills/orders.extended.yaml/dev-positive-proposal | correct | "gpt-6.1-sol" | 9919 |
| codex-sol-high/evals/skills/orders.extended.yaml/dev-negative-static-done | correct | "gpt-6.1-sol" | 8734 |
| codex-sol-high/evals/skills/orders.extended.yaml/dev-negative-old-hash | correct | "gpt-6.1-sol" | 10570 |
| codex-sol-high/evals/skills/orders.extended.yaml/dev-negative-unexecuted-coverage | correct | "gpt-6.1-sol" | 9382 |
| codex-sol-high/evals/skills/orders.extended.yaml/dev-negative-empty-skeleton | correct | "gpt-6.1-sol" | 8091 |
| codex-sol-high/evals/skills/orders.extended.yaml/dev-negative-generated-edit | correct | "gpt-6.1-sol" | 8288 |
| codex-sol-high/evals/skills/orders.extended.yaml/runtime-positive-create | correct | "gpt-6.1-sol" | 10085 |
| codex-sol-high/evals/skills/orders.extended.yaml/runtime-positive-confirm | correct | "gpt-6.1-sol" | 8863 |
| codex-sol-high/evals/skills/orders.extended.yaml/runtime-positive-cancel | correct | "gpt-6.1-sol" | 9520 |
| codex-sol-high/evals/skills/orders.extended.yaml/runtime-positive-approval | correct | "gpt-6.1-sol" | 7423 |
| codex-sol-high/evals/skills/orders.extended.yaml/runtime-positive-transition | correct | "gpt-6.1-sol" | 8059 |
| codex-sol-high/evals/skills/orders.extended.yaml/runtime-negative-cancelled | correct | "gpt-6.1-sol" | 8927 |
| codex-sol-high/evals/skills/orders.extended.yaml/runtime-negative-confirmed | correct | "gpt-6.1-sol" | 8174 |
| codex-sol-high/evals/skills/orders.extended.yaml/runtime-negative-denied | correct | "gpt-6.1-sol" | 8108 |
| codex-sol-high/evals/skills/orders.extended.yaml/runtime-negative-no-reason | correct | "gpt-6.1-sol" | 10959 |
| codex-sol-high/evals/skills/orders.extended.yaml/runtime-negative-no-items | correct | "gpt-6.1-sol" | 8056 |

| Benchmark | Primeira tentativa | Final | Correções | Change | Agente/verificação (ms) |
| --- | --- | --- | --- | --- | --- |
| codex-sol-high | 4/5 — 80.0% | 5/5 — 100.0% | 1 | "done" | 423237/28162 |
- codex-sol-high/entity:Task: accepted; specHash e812964d310ea8fde3c4fa0dc8891177adc0150b7579cbea24c2fa8c61c8837c; 1 tentativa(s).
- codex-sol-high/method:Task.complete: accepted; specHash eb3ac3925470d446828c910dd206e6dd06b593b8dea5cd2ec4d247a0c8d88364; 1 tentativa(s).
- codex-sol-high/usecase:create_task: accepted; specHash daa3754aaa800ad41c37c1a18b62bc96b13314acac58caa0d1db37251389a4f6; 1 tentativa(s).
- codex-sol-high/usecase:complete_task: accepted; specHash c51f2de963ef8c242f9c9ba599d98f288b705342798064b5aa5bc4edf2d2428d; 2 tentativa(s).
- codex-sol-high/operator:task-operator: accepted; specHash 78ae1ebe71bf55c9ce94b721f28f7f2850d9116d63a0d5beedfaba1148bbebf1; 1 tentativa(s).

Concordância de respostas estruturadas válidas (pode incluir erros iguais):

Fleiss κ binário: indisponível (insufficient_raters_or_rows); matriz 25/25, 1 configurações.

Uso agregado somente quando todos os componentes medidos estão disponíveis:
- codex-sol-high: input 2152317; cached input 1866240; output 20657; custo indisponível (incomplete_or_incompatible_costs).

Artefatos de evidência: 427. Checksums dos relatórios e das evidências em artifact-manifest.json; o manifest não inclui seu próprio hash.
