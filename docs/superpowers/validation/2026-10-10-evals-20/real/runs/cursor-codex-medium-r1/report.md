# Avaliação 9c40a644-260b-4f26-a334-d7842609983d

Modalidade: **real**. Estado: **completed**.

Fonte: dc9a25d133fa71975dfd77713e00ea653a273a82; runner: d5669b13b661986af9a3a1f2b0a5b0f5af8b8f0e. Bun 1.4.2, linux/x64.
Fonte confiável reconhecida explicitamente. Ferramentas dos CLIs nativos têm acesso às credenciais e à rede do host; o verificador permanece sem credenciais/rede.
Dataset/manifesto identificados por SHA-256. Manifesto: dca467897d9d60fc771a7956824cef033bef0485440e1fadf4aecebc7141a359.
Início: 2026-10-10T20:27:26.268Z; fim: 2026-10-10T20:40:47.723Z; duração: 801508 ms.
Sessões: 31/35. Teto global: 2700000 ms.
Saneamento na publicação: nenhuma remoção adicional; streams são saneados no supervisor antes da publicação.
Integridade da origem: antes 11f596f55338a11a1f0dba2a7e2f6ee74ea859a3a7d784d27e8a525f1b14e245; depois "11f596f55338a11a1f0dba2a7e2f6ee74ea859a3a7d784d27e8a525f1b14e245".

| Configuração | Adapter/versão | Modelo solicitado/parâmetros | Acurácia | Cobertura |
| --- | --- | --- | --- | --- |
| cursor-codex-medium | cursor-cli 2026.10.01-e373342 | gpt-5.3-codex {} | 23/25 — 92.0% | 25/25 — 100.0% |

| Configuração/dataset/caso | Resultado | Modelo observado | Duração do agente (ms) |
| --- | --- | --- | --- |
| cursor-codex-medium/evals/skills/orders.yaml/confirmar-pedido | incorrect | "Codex 5.3 Medium" | 16232 |
| cursor-codex-medium/evals/skills/orders.yaml/cancelar-com-motivo | correct | "Codex 5.3 Medium" | 15759 |
| cursor-codex-medium/evals/skills/orders.yaml/cancelar-exige-aprovacao | correct | "Codex 5.3 Medium" | 14934 |
| cursor-codex-medium/evals/skills/orders.yaml/confirmar-cancelado | correct | "Codex 5.3 Medium" | 16302 |
| cursor-codex-medium/evals/skills/orders.yaml/onde-criar-use-case | incorrect | "Codex 5.3 Medium" | 17210 |
| cursor-codex-medium/evals/skills/orders.extended.yaml/dev-positive-entity | correct | "Codex 5.3 Medium" | 16275 |
| cursor-codex-medium/evals/skills/orders.extended.yaml/dev-positive-usecase | correct | "Codex 5.3 Medium" | 15985 |
| cursor-codex-medium/evals/skills/orders.extended.yaml/dev-positive-uses | correct | "Codex 5.3 Medium" | 15709 |
| cursor-codex-medium/evals/skills/orders.extended.yaml/dev-positive-public-method | correct | "Codex 5.3 Medium" | 15135 |
| cursor-codex-medium/evals/skills/orders.extended.yaml/dev-positive-proposal | correct | "Codex 5.3 Medium" | 15613 |
| cursor-codex-medium/evals/skills/orders.extended.yaml/dev-negative-static-done | correct | "Codex 5.3 Medium" | 15480 |
| cursor-codex-medium/evals/skills/orders.extended.yaml/dev-negative-old-hash | correct | "Codex 5.3 Medium" | 18993 |
| cursor-codex-medium/evals/skills/orders.extended.yaml/dev-negative-unexecuted-coverage | correct | "Codex 5.3 Medium" | 16314 |
| cursor-codex-medium/evals/skills/orders.extended.yaml/dev-negative-empty-skeleton | correct | "Codex 5.3 Medium" | 15461 |
| cursor-codex-medium/evals/skills/orders.extended.yaml/dev-negative-generated-edit | correct | "Codex 5.3 Medium" | 15623 |
| cursor-codex-medium/evals/skills/orders.extended.yaml/runtime-positive-create | correct | "Codex 5.3 Medium" | 14769 |
| cursor-codex-medium/evals/skills/orders.extended.yaml/runtime-positive-confirm | correct | "Codex 5.3 Medium" | 15048 |
| cursor-codex-medium/evals/skills/orders.extended.yaml/runtime-positive-cancel | correct | "Codex 5.3 Medium" | 14644 |
| cursor-codex-medium/evals/skills/orders.extended.yaml/runtime-positive-approval | correct | "Codex 5.3 Medium" | 14641 |
| cursor-codex-medium/evals/skills/orders.extended.yaml/runtime-positive-transition | correct | "Codex 5.3 Medium" | 14774 |
| cursor-codex-medium/evals/skills/orders.extended.yaml/runtime-negative-cancelled | correct | "Codex 5.3 Medium" | 14488 |
| cursor-codex-medium/evals/skills/orders.extended.yaml/runtime-negative-confirmed | correct | "Codex 5.3 Medium" | 14330 |
| cursor-codex-medium/evals/skills/orders.extended.yaml/runtime-negative-denied | correct | "Codex 5.3 Medium" | 14381 |
| cursor-codex-medium/evals/skills/orders.extended.yaml/runtime-negative-no-reason | correct | "Codex 5.3 Medium" | 14611 |
| cursor-codex-medium/evals/skills/orders.extended.yaml/runtime-negative-no-items | correct | "Codex 5.3 Medium" | 14580 |

| Benchmark | Primeira tentativa | Final | Correções | Change | Agente/verificação (ms) |
| --- | --- | --- | --- | --- | --- |
| cursor-codex-medium | 2/5 — 40.0% | 3/5 — 60.0% | 2 | "failed" | 372814/14002 |
- cursor-codex-medium/entity:Task: accepted; specHash e812964d310ea8fde3c4fa0dc8891177adc0150b7579cbea24c2fa8c61c8837c; 2 tentativa(s).
- cursor-codex-medium/method:Task.complete: accepted; specHash eb3ac3925470d446828c910dd206e6dd06b593b8dea5cd2ec4d247a0c8d88364; 1 tentativa(s).
- cursor-codex-medium/usecase:create_task: accepted; specHash daa3754aaa800ad41c37c1a18b62bc96b13314acac58caa0d1db37251389a4f6; 1 tentativa(s).
- cursor-codex-medium/usecase:complete_task: failed — submission_boundary_violation; specHash c51f2de963ef8c242f9c9ba599d98f288b705342798064b5aa5bc4edf2d2428d; 2 tentativa(s).
- cursor-codex-medium/operator:task-operator: blocked — dependency_failed; specHash 78ae1ebe71bf55c9ce94b721f28f7f2850d9116d63a0d5beedfaba1148bbebf1; 0 tentativa(s).

Concordância de respostas estruturadas válidas (pode incluir erros iguais):

Fleiss κ binário: indisponível (insufficient_raters_or_rows); matriz 25/25, 1 configurações.

Uso agregado somente quando todos os componentes medidos estão disponíveis:
- cursor-codex-medium: input indisponível (incomplete_measurements); cached input indisponível (incomplete_measurements); output indisponível (incomplete_measurements); custo indisponível (incomplete_or_incompatible_costs).

Artefatos de evidência: 345. Checksums dos relatórios e das evidências em artifact-manifest.json; o manifest não inclui seu próprio hash.
