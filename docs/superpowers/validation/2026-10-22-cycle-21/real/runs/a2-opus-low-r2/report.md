# Avaliação c8fca5ae-93ec-4c80-a588-360f360e524b

Modalidade: **real**. Estado: **completed**.

Fonte: c673f9c24836e413fc2c89b2215090df1c3c05f6; runner: 4de7c53f1eb3e6207e53939377cdcafbb277f93e. Bun 1.4.3, linux/x64.
Fonte confiável reconhecida explicitamente. Ferramentas dos CLIs nativos têm acesso às credenciais e à rede do host; o verificador permanece sem credenciais/rede.
Dataset/manifesto identificados por SHA-256. Manifesto: 4050c97e1f38c9fea8445c3d76d5bb06348afcb9cb4d8ac9a104d6983571605d.
Início: 2026-10-22T14:39:01.729Z; fim: 2026-10-22T14:44:33.210Z; duração: 331483 ms.
Sessões: 5/10. Teto global: 9600000 ms.
Saneamento na publicação: nenhuma remoção adicional; streams são saneados no supervisor antes da publicação.
Integridade da origem: antes eb94fc1ec96a4727cc372fe870caace37930ed2be1a28378cb9701fbc83016b5; depois "eb94fc1ec96a4727cc372fe870caace37930ed2be1a28378cb9701fbc83016b5".

| Configuração | Adapter/versão | Modelo solicitado/parâmetros | Acurácia | Cobertura |
| --- | --- | --- | --- | --- |
| a2-opus-low | claude-cli 2.1.308 (Claude Code) | claude-opus-5-5 {"reasoningEffort":"low"} prompt: brief | 0/0 — indisponível (zero_denominator) | 0/0 — indisponível (zero_denominator) |

| Configuração/dataset/caso | Resultado | Modelo observado | Duração do agente (ms) |
| --- | --- | --- | --- |

| Benchmark | Primeira tentativa | Final | Correções | Change | Agente/verificação (ms) |
| --- | --- | --- | --- | --- | --- |
| a2-opus-low | 5/5 — 100.0% | 5/5 — 100.0% | 0 | "done" | 235616/51335 |
- a2-opus-low/entity:Task: accepted; specHash e812964d310ea8fde3c4fa0dc8891177adc0150b7579cbea24c2fa8c61c8837c; 1 tentativa(s).
- a2-opus-low/method:Task.complete: accepted; specHash eb3ac3925470d446828c910dd206e6dd06b593b8dea5cd2ec4d247a0c8d88364; 1 tentativa(s).
- a2-opus-low/usecase:create_task: accepted; specHash daa3754aaa800ad41c37c1a18b62bc96b13314acac58caa0d1db37251389a4f6; 1 tentativa(s).
- a2-opus-low/usecase:complete_task: accepted; specHash c51f2de963ef8c242f9c9ba599d98f288b705342798064b5aa5bc4edf2d2428d; 1 tentativa(s).
- a2-opus-low/operator:task-operator: accepted; specHash 78ae1ebe71bf55c9ce94b721f28f7f2850d9116d63a0d5beedfaba1148bbebf1; 1 tentativa(s).

Concordância de respostas estruturadas válidas (pode incluir erros iguais):

Fleiss κ binário: indisponível (insufficient_raters_or_rows); matriz 0/0, 1 configurações.

Uso agregado somente quando todos os componentes medidos estão disponíveis:
- a2-opus-low: input 624918; cached input 554659; output 12960; custo indisponível (incomplete_or_incompatible_costs).

Artefatos de evidência: 199. Checksums dos relatórios e das evidências em artifact-manifest.json; o manifest não inclui seu próprio hash.
