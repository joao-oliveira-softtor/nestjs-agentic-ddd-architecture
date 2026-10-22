# Resultado do piloto cycle-21 (#36)

Execução real em 2026-10-22, das 11:14 às 11:48 (-03:00), conforme o pré-registro
`evals/campaigns/cycle-21-pilot/PREREGISTRATION.md`. O piloto produz uma **recomendação**; a decisão
é do usuário.

## Execução

- 8 slots na ordem pré-registrada (r1 de A0, A1, A2, A3; depois r2), todos `completed`, sem
  refazimento. Linha do tempo em `real/timeline.txt`; driver em `real/run-pilot.sh.txt`.
- Invocações: 43 de 110 (estimativa típica 45 a 65).
- Runner `4de7c53` (merge do #72), fonte `c673f9c` (`sourceRef` dos manifestos), worktree limpo.
- Token não aparece em nenhum arquivo gerado (`real/leak.txt`).
- Duas tentativas anteriores foram canceladas a pedido do usuário (3 e 4 invocações, só no slot
  `a0-sonnet-medium-r1`) e os relatórios foram descartados por decisão dele, antes de qualquer
  resultado ser lido. Não entram em nenhuma regra.
- **Cota não isolada**: 5 outras sessões `claude` estavam abertas durante a execução. O número de
  cota da janela de 5 h não é publicado como medição do piloto.

## Onde está a evidência

A evidência bruta das 8 execuções (relatórios, saída de cada invocação, patches e verificação,
~15 MB) **não** é versionada, por decisão do usuário. Ela está em
`cycle-21-pilot-evidence.tar.gz` (1,4 MB, SHA-256
`b17bb61259930839626c7d66f1717536dde0dc2b9aa26f1e0d777fc61a786e4d`), com o índice da campanha
apontando para os relatórios (`cycle-21-pilot/index-executed.json`). Por isso
`evals/campaigns/cycle-21-pilot/index.json` continua com os slots `not_run`. Para reagregar:
extrair o arquivo, copiar `index-executed.json` sobre o índice com os caminhos dos relatórios
extraídos e rodar `evals:aggregate`. Aqui ficam o agregado, a classificação e a linha do tempo.

## Agregado

Gerado com o índice executado: `bun run evals:aggregate --campaign
evals/campaigns/cycle-21-pilot/index.json --out
docs/superpowers/validation/2026-10-22-cycle-21/real/aggregate`. Custo derivado de
`evals/pricing.json`, somado nas 2 repetições, sem `lowerBound` em nenhum braço; as faixas cara e
barata coincidem.

| Braço | Aceitos (de 10) | Correções | Custo total (US$) | Custo por aceito (US$) |
|---|---|---|---|---|
| A0 `a0-sonnet-medium` | 10 | 1 | 0,9764 | 0,0976 |
| A1 `a1-sonnet-low` | 4 | 3 | 0,7142 | 0,1785 |
| A2 `a2-opus-low` (referência) | 10 | 1 | 1,9230 | 0,1923 |
| A3 `a3-routed` (com revisão) | 10 | 0 | 0,9913 | 0,0991 |

O A3 aceitou todos os itens na 1ª tentativa, sem escalar degrau, e as duas revisões terminaram.

## Classificação (regra I/S/P/M)

`classifyPilotReport` sobre o agregado (`real/classification.log.txt`): **S**, motivo `rule`,
faixas cara e barata = S.

A0 aceita tanto quanto o A3 (10 = 10) e custa menos por item aceito (0,0976 < 0,0991), sem
`lowerBound`. A margem é de ~1,5%, dentro do ruído esperado com N = 2; a regra pré-registrada não
tem margem mínima, então a classificação vale como está.

Recomendação pré-registrada para S: fechar a #36 com "manter `inherit`, adotar só brief e gates"
(spec:63) e, como recomendação própria, a #33 como não planejada.

## Descritivo (fora da regra)

- O A3 empata com A0 e A2 em aceite e custa metade do A2; a revisão Opus pesa no custo do A3.
- A1 (Sonnet low) é o único braço com perda de qualidade: 4 de 10, com 3 correções.
- O custo da sessão orquestradora fica fora da comparação, por decisão do usuário.
