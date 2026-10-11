# Avaliação 3e31e01d-e443-443a-8b66-c4fbac4a3f81

Modalidade: **real**. Estado: **completed**.

Fonte: 0cbd74bcdaf662f1eb07afc613b3b89b08c2d425; runner: e0e0c2369a321a574c01cd1f491e15e50f3699cc. Bun 1.4.2, linux/x64.
Fonte confiável reconhecida explicitamente. Ferramentas dos CLIs nativos têm acesso às credenciais e à rede do host; o verificador permanece sem credenciais/rede.
Dataset/manifesto identificados por SHA-256. Manifesto: 2a3d23dbeacadddca4e0e518582db4663dc5dfb14c63e87f601eb4066d85f205.
Início: 2026-10-10T14:00:46.902Z; fim: 2026-10-10T14:09:03.126Z; duração: 496225 ms.
Sessões: 10/15. Teto global: 2700000 ms.
Saneamento na publicação: nenhuma remoção adicional; streams são saneados no supervisor antes da publicação.
Integridade da origem: antes ce48623159e042acdccef0a1f1ba2bbbf44af99870558f9ce1bb198e903b766f; depois "ce48623159e042acdccef0a1f1ba2bbbf44af99870558f9ce1bb198e903b766f".

| Configuração | Adapter/versão | Modelo solicitado/parâmetros | Acurácia | Cobertura |
| --- | --- | --- | --- | --- |
| codex-sol-high | codex-cli codex-cli 0.162.1 | gpt-6.1-sol {"reasoningEffort":"high"} | 4/5 — 80.0% | 5/5 — 100.0% |

| Configuração/dataset/caso | Resultado | Modelo observado | Duração do agente (ms) |
| --- | --- | --- | --- |
| codex-sol-high/evals/skills/orders.yaml/confirmar-pedido | correct | "gpt-6.1-sol" | 8835 |
| codex-sol-high/evals/skills/orders.yaml/cancelar-com-motivo | correct | "gpt-6.1-sol" | 8758 |
| codex-sol-high/evals/skills/orders.yaml/cancelar-exige-aprovacao | correct | "gpt-6.1-sol" | 9377 |
| codex-sol-high/evals/skills/orders.yaml/confirmar-cancelado | correct | "gpt-6.1-sol" | 10480 |
| codex-sol-high/evals/skills/orders.yaml/onde-criar-use-case | incorrect | "gpt-6.1-sol" | 13922 |

| Benchmark | Primeira tentativa | Final | Correções | Change | Agente/verificação (ms) |
| --- | --- | --- | --- | --- | --- |
| codex-sol-high | 5/5 — 100.0% | 5/5 — 100.0% | 0 | "done" | 403797/15731 |
- codex-sol-high/entity:Task: accepted; specHash e812964d310ea8fde3c4fa0dc8891177adc0150b7579cbea24c2fa8c61c8837c; 1 tentativa(s).
- codex-sol-high/method:Task.complete: accepted; specHash eb3ac3925470d446828c910dd206e6dd06b593b8dea5cd2ec4d247a0c8d88364; 1 tentativa(s).
- codex-sol-high/usecase:create_task: accepted; specHash daa3754aaa800ad41c37c1a18b62bc96b13314acac58caa0d1db37251389a4f6; 1 tentativa(s).
- codex-sol-high/usecase:complete_task: accepted; specHash c51f2de963ef8c242f9c9ba599d98f288b705342798064b5aa5bc4edf2d2428d; 1 tentativa(s).
- codex-sol-high/operator:task-operator: accepted; specHash 78ae1ebe71bf55c9ce94b721f28f7f2850d9116d63a0d5beedfaba1148bbebf1; 1 tentativa(s).

Concordância de respostas estruturadas válidas (pode incluir erros iguais):

Fleiss κ binário: indisponível (insufficient_raters_or_rows); matriz 5/5, 1 configurações.

Uso agregado somente quando todos os componentes medidos estão disponíveis:
- codex-sol-high: input 1048713; cached input 907264; output 14376; custo indisponível (incomplete_or_incompatible_costs).

Artefatos de evidência: 244. Checksums dos relatórios e das evidências em artifact-manifest.json; o manifest não inclui seu próprio hash.
