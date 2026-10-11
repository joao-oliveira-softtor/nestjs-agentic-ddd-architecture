# Avaliação b3e5df19-289b-49b8-b4aa-a209f6d84e2e

Modalidade: **real**. Estado: **completed**.

Fonte: 0cbd74bcdaf662f1eb07afc613b3b89b08c2d425; runner: e0e0c2369a321a574c01cd1f491e15e50f3699cc. Bun 1.4.2, linux/x64.
Fonte confiável reconhecida explicitamente. Ferramentas dos CLIs nativos têm acesso às credenciais e à rede do host; o verificador permanece sem credenciais/rede.
Dataset/manifesto identificados por SHA-256. Manifesto: 80e77f3ee6b9026da2dd5c96fc1f42fee8165208679fdeda8d6a35fcb479f38c.
Início: 2026-10-10T14:09:52.734Z; fim: 2026-10-10T14:17:14.360Z; duração: 441626 ms.
Sessões: 10/15. Teto global: 2700000 ms.
Saneamento na publicação: nenhuma remoção adicional; streams são saneados no supervisor antes da publicação.
Integridade da origem: antes ce48623159e042acdccef0a1f1ba2bbbf44af99870558f9ce1bb198e903b766f; depois "ce48623159e042acdccef0a1f1ba2bbbf44af99870558f9ce1bb198e903b766f".

| Configuração | Adapter/versão | Modelo solicitado/parâmetros | Acurácia | Cobertura |
| --- | --- | --- | --- | --- |
| cursor-codex-medium | cursor-cli 2026.10.01-e373342 | gpt-5.3-codex {} | 3/5 — 60.0% | 5/5 — 100.0% |

| Configuração/dataset/caso | Resultado | Modelo observado | Duração do agente (ms) |
| --- | --- | --- | --- |
| cursor-codex-medium/evals/skills/orders.yaml/confirmar-pedido | correct | "Codex 5.3 Medium" | 13744 |
| cursor-codex-medium/evals/skills/orders.yaml/cancelar-com-motivo | incorrect | "Codex 5.3 Medium" | 13497 |
| cursor-codex-medium/evals/skills/orders.yaml/cancelar-exige-aprovacao | correct | "Codex 5.3 Medium" | 12518 |
| cursor-codex-medium/evals/skills/orders.yaml/confirmar-cancelado | correct | "Codex 5.3 Medium" | 13748 |
| cursor-codex-medium/evals/skills/orders.yaml/onde-criar-use-case | incorrect | "Codex 5.3 Medium" | 17989 |

| Benchmark | Primeira tentativa | Final | Correções | Change | Agente/verificação (ms) |
| --- | --- | --- | --- | --- | --- |
| cursor-codex-medium | 5/5 — 100.0% | 5/5 — 100.0% | 0 | "done" | 332283/16086 |
- cursor-codex-medium/entity:Task: accepted; specHash e812964d310ea8fde3c4fa0dc8891177adc0150b7579cbea24c2fa8c61c8837c; 1 tentativa(s).
- cursor-codex-medium/method:Task.complete: accepted; specHash eb3ac3925470d446828c910dd206e6dd06b593b8dea5cd2ec4d247a0c8d88364; 1 tentativa(s).
- cursor-codex-medium/usecase:create_task: accepted; specHash daa3754aaa800ad41c37c1a18b62bc96b13314acac58caa0d1db37251389a4f6; 1 tentativa(s).
- cursor-codex-medium/usecase:complete_task: accepted; specHash c51f2de963ef8c242f9c9ba599d98f288b705342798064b5aa5bc4edf2d2428d; 1 tentativa(s).
- cursor-codex-medium/operator:task-operator: accepted; specHash 78ae1ebe71bf55c9ce94b721f28f7f2850d9116d63a0d5beedfaba1148bbebf1; 1 tentativa(s).

Concordância de respostas estruturadas válidas (pode incluir erros iguais):

Fleiss κ binário: indisponível (insufficient_raters_or_rows); matriz 5/5, 1 configurações.

Uso agregado somente quando todos os componentes medidos estão disponíveis:
- cursor-codex-medium: input indisponível (incomplete_measurements); cached input indisponível (incomplete_measurements); output indisponível (incomplete_measurements); custo indisponível (incomplete_or_incompatible_costs).

Artefatos de evidência: 234. Checksums dos relatórios e das evidências em artifact-manifest.json; o manifest não inclui seu próprio hash.
