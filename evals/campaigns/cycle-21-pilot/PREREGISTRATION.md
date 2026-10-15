# Pré-registro do piloto cycle-21 (#36)

Este arquivo é versionado **antes de qualquer execução real** do piloto. O piloto produz uma
**recomendação**; a decisão é do usuário. Plano de origem:
`docs/superpowers/plans/2026-10-14-campanha-por-nivel-piloto.md`. A regra de leitura está
implementada como função pura em `scripts/evals/pilot.ts` e testada em
`test/evals-pilot.test.ts`; o ensaio offline ponta a ponta está em
`test/evals-pilot-rehearsal.test.ts`. Os smokes do PR-1 e do PR-2 rodam o mesmo benchmark antes
deste pré-registro e não entram em nenhuma regra.

## Braços

Todos com `promptMode: brief`, `maxCorrectionsPerItem: 1`, `skillDatasets: []`,
`authentication: oauth-token`, duas repetições (r1 e r2) e `sourceRef`
`c673f9c24836e413fc2c89b2215090df1c3c05f6` (merge do PR-2, #60).

| Braço | Configuração | Modelo | Esforço |
|---|---|---|---|
| A0 | `a0-sonnet-medium` | `claude-sonnet-5-5` | `medium` |
| A1 | `a1-sonnet-low` | `claude-sonnet-5-5` | `low` |
| A2 | `a2-opus-low` | `claude-opus-5-5` | `low` |
| A3 | `a3-routed` | roteado, `model` = `claude-haiku-5-5` | por degrau |

A3 usa `routing`: `byLayer` {domain: `claude-haiku-5-5`, application e operators:
`claude-sonnet-5-5`}; `ladder` [haiku sem `--effort` (padrão do CLI), sonnet `medium` (= A0),
opus `low` (= A2)]; `reviewer` opus `low`. O conjunto A0 a A3 é decisão do usuário
(2026-10-14); o relatório previa outro conjunto para o piloto (`relatorio.md:234`). Turnos e
tempo (`relatorio.md:224`) são publicados como métricas descritivas.

## Tetos e ordem

- Invocações por execução (pior caso exato, 1 retentativa por degrau): A0 a A2 = 10 (5 itens × 2);
  A3 = 25 (domínio 2 itens × 2 × 3 degraus = 12; application 2 × 2 × 2 = 8; operator 1 × 2 × 2 =
  4; revisão 1).
- **Teto total do piloto: 3 × 2 × 10 + 2 × 25 = 110 invocações** (estimativa típica 45 a 65).
  Refazimentos **não** entram nos 110 e cada um exige nova autorização.
- `implementationTimeoutMs` de 10 min; `totalTimeoutMs` = teto × 10 min + 60 min de folga para
  baseline, `status`, `next` e `verify` (160 min em A0 a A2, 310 min em A3).
- Ordem intercalada: r1 de A0, A1, A2 e A3; depois r2 na mesma ordem. Execuções sequenciais.
- Revisor do A3: `REVIEW_MAX_TOKENS` = 50000 em `scripts/evals/implementation.ts` (piso; ao
  menos 3× o maior `briefTokens` entre o ensaio e a estimativa com os patches aceitos do
  cycle-20, ≈13k tokens). Um teste do ensaio falha se o brief crescer além disso.

## Desvios declarados

- Workspace com skills e agents em `.claude/` carregados por `--setting-sources project`
  (simétrico entre os braços; desvio de D5). A revisão do harness roda com o mesmo contexto,
  não com o contexto limpo de D12.
- O harness não passa `--max-turns` (D9): o teto efetivo é o de invocações mais o timeout. Risco
  declarado: um degrau em laço consome o timeout inteiro. Sob assinatura, `--max-budget-usd` não
  é tratado como garantia.
- Assimetria: o aceite do A3 inclui escalação (até 6 tentativas por item de domínio, contra 2 nos
  controles).
- Critério do revisor da spec:62 (A3 × A4, regressões plantadas do B11) **não** é avaliável no
  piloto; fica para a campanha completa. O comparador A3 × A5 da spec (`spec:61`) também, porque
  o A5 não roda no piloto.

## Definições

- **Aceite** = `configurations[].final.numerator` do agregado (o `accepted()` de `aggregate.ts` é
  a definição única). Ele já junta as 2 repetições e não é o aceite da 1ª tentativa.
- **Custo** = custo equivalente de API (derivado de `evals/pricing.json`, rotulado `derived`)
  somado nas 2 repetições, dividido pelo aceite (agrupado). No A3 o custo é **com** a revisão,
  porque a spec:59-63 e o ADR-0003 comparam o pipeline completo contra um modelo sozinho; o custo
  do A3 sem revisão é só descritivo, rotulado "≈A4". Custo indisponível nunca é estimado.
- As estatísticas vêm de `configurations` do agregado, **não** de `groups`. Mediana, p90 e valores
  por execução são publicados, mas só descrevem.
- **TTL de cache**: o primário é o informado por requisição (`cache_creation.ephemeral_5m/1h`,
  conferido com `result.usage.cache_creation`); sem informação, vale **1 h** (o observado no smoke
  do PR-1 e o conservador para o A3), e a leitura com 5 min é publicada como sensibilidade no
  campo `floor` do custo (faixa barata e 5 min). A regra I compara só `expensive` e `cheap`, que
  mantêm o TTL de 1 h nos dois: a incerteza de TTL nunca dispara a sensibilidade de faixa. Se
  `result.usage.cache_creation` divergir da soma por requisição, vale o `result` e a divergência é
  anotada.
- **Timeout**: tentativa em `timeout` conta como falha (como nos controles), com custo de
  `requests` `unreconciled` (limite inferior, rotulado `lowerBound`, sem saída medida). Só vira
  inconclusiva se não houver nenhum evento `assistant` com uso.
- **Falso verde** (`relatorio.md:224`): gates I1 a I5 e testes do executor verdes com os testes de
  referência reprovados. Oráculo sem evidência válida (JUnit inválido, suíte vazia) é indisponível,
  nunca falso verde. Violações de fronteira contam por `audit.ok === false`.

## Execução inconclusiva e refazimento

Uma execução é inconclusiva quando: o benchmark tem item em `infra_error`; o custo dela fica
indisponível; o relatório não terminou `completed` (`budget_exhausted`, timeout total,
cancelamento, limite da assinatura); ou o slot ficou `not_run` ou ausente. Item `not_run` por
orçamento também torna inconclusivo. `finalVerification` em `infra_error` já rebaixa o relatório
(`classifyRunStatus`); saída acima de `OUTPUT_LIMIT_BYTES` (8 MiB) vira `infra_error`.

**Revisão do A3**: com ao menos 1 item aceito, a revisão só vale se foi despachada e terminou
`finished` com uso medido (`approved`, `changes_requested` ou resposta inválida). `not_run`,
`error` sem despacho ou `transport` diferente de `finished` (inclui limite da assinatura e
`auth_source_mismatch`) tornam o slot do A3 inconclusivo, para o A3 nunca ser comparado sem o
custo da revisão. Sem item aceito, `not_run` é o esperado.

**Política de refazimento**: refaz só o slot inconclusivo, com o mesmo manifesto, no máximo 1
vez; o relatório anterior fica arquivado e citado no PR-4. Cada refazimento exige **nova
autorização do usuário**, decidida sem olhar os resultados dos outros braços (o pedido traz só o
slot e o motivo). Interrupção por limite da assinatura não conta no limite de 1 refazimento,
porque não depende do resultado. Modelo sem preço não exige inferência nova: corrige-se a tabela
e reagrega.

**Cota da assinatura**: um slot só começa se o pior caso dele couber na janela de 5 h atual
(estimada pelo consumo medido no smoke do PR-2; o número entra no PR-4 antes do primeiro slot).
Em interrupção por limite, espera-se a janela reabrir antes de pedir autorização para refazer; o
horário é registrado no PR-4.

## Regra de leitura (exaustiva, nesta ordem)

`X` percorre {A0, A1}. A2 é referência de teto de qualidade e não entra na classificação (um A2
inconclusivo só é anotado, sem direito a refazimento).

1. **I (inconclusivo)**: A0, A1 ou A3 com alguma execução inconclusiva depois da política de
   refazimento (inclui slot `not_run` ou ausente), ou com custo indisponível; ou a classificação
   calculada com o resíduo auxiliar pela faixa mais cara difere da calculada pela faixa mais
   barata (neste caso sem refazimento, porque não há inferência a refazer). A sensibilidade de TTL
   é só anotada. Custo indisponível prevalece sobre a regra do aceite 0. Recomendação: nenhuma
   mudança de padrão; o usuário decide entre autorizar refazimentos (se ainda couberem) e encerrar.
2. Com custos disponíveis, aceite 0 → custo +∞.
3. **S (simplificar)**: existe `X` com aceite(X) ≥ aceite(A3) **e** custo(X) < custo(A3) **e**
   (custo(X) sem `lowerBound` **ou** custo(A3) = +∞) → recomendar fechar a #36 com "manter
   `inherit`, adotar só brief e gates" (spec:63) e, como recomendação própria, a #33 como não
   planejada.
4. **P (prosseguir)**: custo(A3) sem `lowerBound` **e**, para todo `X`, aceite(A3) ≥ aceite(X) **e**
   custo(A3) < custo(X) → recomendar a campanha completa (A0 a A5, 5 repetições), com novo
   pré-registro e novo orçamento.
5. **M (misto)**: qualquer outro caso → nenhuma mudança de padrão; o usuário escolhe entre
   campanha completa e encerrar.

S e P são mutuamente exclusivos. Nenhum resultado do piloto promove a #33 sozinho. Intervalos e
fronteira de Pareto (`relatorio.md:226`) não são critério da #36 e ficam como descrição no PR-4.

## Credencial e riscos operacionais

- A autenticação é por `claude setup-token`, rodado pelo usuário; o token é exportado como
  `CLAUDE_CODE_OAUTH_TOKEN` **só na sessão de shell da execução**, nunca no perfil do shell nem
  em arquivo do repositório, e nunca é lido nem impresso. O piloto usa um token gerado só para
  ele.
- **Revogação: sem procedimento documentado.** A documentação oficial consultada em 2026-10-14
  (`code.claude.com/docs/en/authentication.md`) diz que o token é de **um ano** e que o CLI **não
  o salva em lugar nenhum**, e não descreve como revogá-lo (o `/logout` documentado revoga apenas
  a credencial de login do Console sem chave de API). O plano previa revogar o token ao fim; isso
  **não pôde ser confirmado** e fica como pendência do usuário antes da execução real: confirmar
  um caminho de revogação ou aceitar explicitamente o risco de um token de um ano.
- O executor roda com Bash e rede dentro do sandbox e consegue ler o próprio `env` (mesma
  exposição das chaves de hoje). Mitigação: exportar só na sessão da execução; cada execução
  confere com `grep -r` que o valor do token não aparece na saída.
- Cobrança silenciosa pela API: variáveis de chave são removidas do `env` no modo oauth e
  `apiKeySource` é conferido em cada invocação.
- N pequeno e variação de até 30× em tokens: a regra só gera recomendação; a estatística é única e
  agrupada, e os valores por execução são publicados.

## Execução real

Depois do merge do PR-3 e da autorização explícita do teto de 110 invocações pelo usuário.
Relatórios em `docs/superpowers/validation/2026-10-xx-cycle-21/real/runs/<id>/`; índice
atualizado com os hashes; `bun run evals:aggregate --campaign
evals/campaigns/cycle-21-pilot/index.json --out <diretório novo>`; PR-4 com relatórios, agregado,
classificação pela regra acima e comentários na #36 e na #33.
