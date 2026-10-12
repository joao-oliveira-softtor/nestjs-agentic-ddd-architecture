# Correções do code review (F1–F7) e spec do Plano 7 — Blueprint

**Objetivo:** fechar os achados F1–F7 do code review de `b5d70e2` (v0.4.0), com um PR por fase, e preparar a spec e o plano do Plano 7 (issue #7) incorporando F8 como requisitos do adapter real de `LlmPort`.

**Base:** `main` em `b5d70e2`. Estado verificado em 2026-10-12: typecheck, lint, `agentic compile --check` e `skills:install --check` passam; `agentic status` dá 7/7 done; localmente `agentic verify 0001` termina `failed` só em G5, por causa de F1; o CI de `main` está verde, mas leva 25m54s (eram 3m39s na v0.1.0).

**Garantia que nenhuma fase pode quebrar:** nenhum caminho de *falso done* em `verify`/`status`/evals. Toda mudança que amplia o que conta como "passou" (ex.: suíte vazia) precisa de um teste negativo que mostre que o caso de falha continua falhando.

---

## Premissas e decisões registradas

1. **Convenção do repo vence a skill.** O plano fica em `docs/superpowers/plans/` (AGENTS.md), não em `plans/`. O blueprint não redesenha as fases: o prompt do usuário já é o design. Este arquivo acrescenta o brief cold-start de cada fase.
2. **Idioma dos commits.** O usuário pediu Conventional Commits "em pt-BR como o histórico". Os subjects não-merge recentes estão quase todos em inglês (`fix(evals): bound …`, `feat(package): …`). Só os merges estão em pt-BR. **Segue-se a instrução explícita (pt-BR)**, ex.: `fix(verify): reconhece suíte vazia do Bun 1.4.2 local`. A divergência fica anotada aqui para o usuário confirmar.
3. **Identidade.** Repositório da Softtor: `git config user.email` = `joao.oliveira@softtor.com.br`. Conferir em cada worktree antes de commitar. Nunca usar o e-mail da BIUD. Sem `Co-Authored-By` e sem rodapé "Generated with Claude Code".
4. **Onde o plano é versionado.** Este arquivo entra no PR da Fase 1, num commit `docs(plans): …` separado. Até lá fica não rastreado no checkout principal: copie-o para o worktree da Fase 1.
5. **Sem push, PR ou merge** sem aprovação explícita do usuário, em todas as fases.
6. **Variáveis:** `SCRATCH` = diretório temporário da sessão (ex.: `export SCRATCH=$(mktemp -d)`); nunca grave medições dentro do repositório. `/usr/bin/time` não existe nesta máquina; meça com `start=$(date +%s); <cmd>; echo $(( $(date +%s) - start ))s`.
7. **"65 evidências"** vem do prompt do code review. `docs/superpowers/validation` tem 245 `result.json`. O critério operacional é "nenhum arquivo sob `docs/superpowers/validation` e `evals/` muda" (`git diff --exit-code`), mais a reprodução dos agregados da Fase 3.
8. **Revisão adversarial (2026-10-12):** um subagente Opus revisou o plano. Os achados CRITICAL e IMPORTANT já estão incorporados às fases.
9. **Fora de escopo:** adapter real de LLM, CLI do Plano 8, backlog #9–#12, publicação no npm, edição manual de arquivos gerados, alteração de evidências em `docs/superpowers/validation`.

## Grafo de dependências e paralelismo

```
F1 (Fase 1) ──► F2 (Fase 2) ──► F3+F4 (Fase 3)
      │                              
      └────────► F5 (Fase 4) ──► F7 (Fase 6)
                 F6 (Fase 5)   (independente; serial por ordem do usuário)
Fase 7 (spec, só docs) depende só de main; última por ordem do usuário.
```

- **Ordem de execução: serial, 1 → 7**, como pedido. Cada fase parte de `main` *depois do merge da anterior*. Se a anterior ainda não tiver merge, parta do branch dela e anote isso no PR (rebase após o merge).
- Dependências reais: F2 precisa de F1 (sem F1 a medição de tempo e a comparação de cobertura de `verify 0001` saem `failed`). F7 precisa de F5(a) (compile não pode gravar lock com erro de lint enquanto a proposta 0003 é escrita). F3 é independente em código, mas usa a suíte mais rápida da F2.
- **Paralelizáveis em tese** (sem arquivos em comum): Fase 5 (`src/core`) com a Fase 3 (`scripts/evals`). Não paraleliza por padrão: o usuário pediu ordem fixa.

## Invariantes verificados ao fim de toda fase (quality gate mínimo)

```bash
bun run typecheck
bun run lint
bun test <arquivos afetados>
bun run agentic compile --check
bun run skills:install --check
git config user.email   # deve ser joao.oliveira@softtor.com.br
```
Rode também `bun test` completo e `bun run agentic verify 0001` (= `done`) nas **Fases 1, 4 e 6**: a 1 e a 4 mudam o que conta como "passou" ou "válido", e a 6 é a última fase de código.

## Protocolo comum de cada fase (cold start)

1. A partir da Fase 2: `/ecc:resume-session`. Leia `CLAUDE.md`, `AGENTS.md` e esta seção da fase.
2. Worktree e branch a partir de `main` atualizado:
   ```bash
   git -C /home/jvtuta/code/nestjs-agentic-ddd-architecture fetch origin
   git -C /home/jvtuta/code/nestjs-agentic-ddd-architecture worktree add ../nadd-<fase> -b <branch> origin/main
   cd ../nadd-<fase> && bun install --frozen-lockfile
   ```
3. **Linha de base antes de editar:** rode o quality gate mínimo no worktree limpo e guarde a saída em `$SCRATCH/<fase>-baseline.txt`. Atenção: AGENTS.md avisa que os links `.agents/skills/agentic-ddd` e `.claude/skills/agentic-ddd` "dependem da permanência deste checkout". Se `skills:install --check` falhar no worktree limpo, isso é ruído ambiental. Registre e compare depois, sem "consertar".
4. `/ecc:plan` da fase, com critérios de aceite verificáveis (use os critérios desta seção como ponto de partida).
5. Teste falhando primeiro. Depois, a implementação mínima: diretrizes Karpathy, mudança cirúrgica, sem refatorar código vizinho.
6. `/ecc:quality-gate` com o gate mínimo acima.
7. `/ecc:code-review` do diff da fase, mais o agente específico da fase.
8. Commit(s) em Conventional Commits pt-BR, com autor Softtor.
9. `/ecc:checkpoint` e `/ecc:save-session`. Atualize a tabela de status no fim deste arquivo.
10. **PARE.** Apresente o resumo, os commits e o rascunho do corpo do PR, e peça aprovação antes de `git push` e `gh pr create`.

**Rollback por fase:** cada fase é um branch isolado. Para abandonar, rode `git worktree remove ../nadd-<fase>` e `git branch -D <branch>`. Depois do merge, use `git revert -m 1 <merge>`. Nenhuma fase migra dados ou altera evidência publicada.

---

## Fase 1 — F1: suíte vazia não reconhecida (bug, TDD)

- **Branch/worktree:** `fix/verify-empty-suite` em `../nadd-f1`
- **Modelo:** Haiku 5.5 para implementação; Sonnet 5.5 para a revisão.
- **Skills/agentes:** `ecc:tdd-workflow` com o agente `ecc:tdd-guide`; `ecc:bun-runtime` para confirmar o comportamento do Bun.

### Contexto
`src/compiler/verify/test-run.ts:103-107` calcula `emptySuite` só pelas frases `No tests found!` e `Ran 0 tests across N files.` no stderr. O Bun local (`1.4.2+744846f84`) imprime `error: 0 test files matching …`. Com isso falham:
- `src/cli/coordination.test.ts:231`;
- `test/skills-example.test.ts:131` (tutorial `skills:example`);
- `src/cli/verify.test.ts:72`, via verify aninhado. É por isso que `verify 0001` dá `failed` em G5.

Consumidores da flag: `src/compiler/project-state.ts:75` (`allowEmptySuite && evidence.emptySuite` é o único lugar que tolera `collectionError`), `scripts/evals/aggregate.ts:234` e `scripts/evals/report-schema.ts:108`. Hoje `emptySuite` **também** gera `collectionError`, e isso não muda.

O motivo de o CI passar não foi determinado: CI e local usam 1.4.2. Hipótese a registrar, sem precisar resolver: o `setup-bun@v2` instala um build diferente. Registre `bun --revision` local no comentário do teste. Se quiser fechar a dúvida de graça, inclua no PR um passo `bun --revision` no `ci.yml`.

Formas observadas no Bun 1.4.2 (revisão adversarial):
| stderr | exit | classificação |
|---|---|---|
| `No tests found!` | — | vazio |
| `Ran 0 tests across 1 file.` (singular) | 0 | vazio; a regex atual (`files\.`) **não** casa |
| `Ran 0 tests across N files.` | — | vazio |
| `error: 0 test files matching …` | ≠ 0 | vazio (forma local de F1) |
| `Test filter "./x" had no matches` | 1 | **não** vazio: é erro de configuração do filtro (relevante para a F2) |
| erro de import (`# Unhandled error between tests` + `Ran 1 test`) | ≠ 0 | **não** vazio: `collectionError` |

### Tarefas
1. Red: confirme que os três testes acima falham localmente e guarde a saída.
2. Extraia um predicado puro (ex.: `isEmptySuite({ stderr, cases })`) no mesmo arquivo e exporte-o só para teste. Teste-o com stderr sintético, **um teste por linha da tabela acima**, mais:
   - `# Unhandled error between tests` junto com qualquer frase "vazia" → *não* vazio;
   - `cases.length > 0` → nunca vazio.
3. Implementação: frases ancoradas em início de linha, cobrindo singular e plural. Não use detecção estrutural que possa transformar erro de setup em suíte vazia.
4. Green: rode de novo os três testes originais.
5. Não-regressão de falso done: confirme com os testes existentes que uma suíte com erro de import continua `failed` em `verify --item`. Se faltar um teste desses, adicione-o em `src/cli/coordination.test.ts` (fica no critério de diff abaixo).

### Verificação
```bash
bun test src/compiler/verify src/cli/coordination.test.ts test/skills-example.test.ts src/cli/verify.test.ts
bun test                           # suíte completa
bun run agentic verify 0001        # esperado: done
```
+ o gate mínimo.

### Critérios de saída
- Os três testes antes vermelhos passam. O predicado tem um teste por forma da tabela, inclusive os negativos.
- `bun test` completo verde; `verify 0001` local = `done`.
- `git diff --stat` mostra só `src/compiler/verify/test-run.ts`, o teste dele, eventualmente `src/cli/coordination.test.ts` e este plano (commit `docs(plans)` separado).

---

## Fase 2 — F2: suíte executada ~3x no CI

- **Branch/worktree:** `ci/verify-test-scope` em `../nadd-f2`
- **Modelo:** Haiku 5.5; revisão com Sonnet 5.5.
- **Depende de:** Fase 1 mergeada.

### Contexto
`src/cli/verify.test.ts:64-108` roda `verify 0001` e `verify 0002` na raiz. Sem bloco `verify` em `agentic.config.ts`, `resolveConfig` usa `['bun','test']` (`src/compiler/config.ts:90-91`), e cada verify executa a suíte inteira.

Já existe um mecanismo de escopo: `runTests` define `AGENTIC_DDD_VERIFY=1` (`VERIFY_ENV`) e os `test/evals-*.test.ts` usam `skipIf`. `test/evals-verification-scope.test.ts` fiscaliza isso. O novo bloco tem de conviver com esse mecanismo, não duplicá-lo. Ajuste o teste de escopo só se ele passar a ser redundante, e justifique.

**Só os `test/evals-*` têm `skipIf`.** `test/package*.test.ts`, `test/skills-install.test.ts` e `test/skills-example.test.ts` rodam aninhados em cada verify, e o verify ainda roda typecheck e lint (`src/compiler/verify/index.ts:59-66`). **Escopo-alvo (pedido do usuário):** framework + orders, ou seja, **toda a suíte, exceto `test/evals-*`** (`./src`, `./examples/orders` e cada `test/*.test.ts` que não seja `evals-*`, listados explicitamente). O G5 reprova quando a suíte do escopo falha. Por isso **não** retire do escopo `test/architecture.test.ts` (regra "`src/core` só importa `zod`"), `test/app.test.ts` nem os testes de pacote e de skills: sem eles, um change poderia dar `done` com a arquitetura quebrada. Esses testes não têm `covers`, e a comparação de `covers` não detectaria a perda. Um escopo mais estreito (ex.: só `./src` + `./examples/orders`) reduziria mais o custo, mas enfraquece o `done`. Só com decisão explícita do usuário, registrada no PR.

**Cuidado:** um filtro de caminho que não casa com nada produz `Test filter "…" had no matches` (exit 1), que pela F1 é erro, não suíte vazia. Todo caminho do escopo precisa existir.

**Decisão do usuário (2026-10-12): opção C + passo no CI.**
1. `agentic.config.ts` ganha `verify.test` = `./src`, `./examples/orders` e cada `test/*.test.ts` que não seja `evals-*`, numa lista explícita. Um teste em `test/evals-verification-scope.test.ts` exige que a lista seja exatamente essa, para que um arquivo novo em `test/` não saia do `done` em silêncio.
2. `src/cli/verify.test.ts` roda `verify 0001`/`0002` com `--config test/fixtures/orders-verify/agentic.config.ts`, uma fixture de config sobre o projeto real (`root: ../../..`), com o verify aninhado restrito a `./examples/orders`. É dessa troca que vem o ganho de tempo, já que os evals já se pulavam via `AGENTIC_DDD_VERIFY`.
3. `.github/workflows/ci.yml` ganha o passo `bun run agentic verify 0001`, exigindo `status == done` (checado com `bun -e`, sem depender de `jq`). Ele preserva a prova de ponta a ponta do exemplo com o escopo da raiz.

### Tarefas
1. **Medir antes**, no worktree limpo, já com F1:
   ```bash
   start=$(date +%s); bun test > $SCRATCH/f2-before-suite.txt 2>&1; echo "suite $(( $(date +%s) - start ))s"
   start=$(date +%s); bun run agentic verify 0001 > $SCRATCH/f2-before-0001.json; echo "verify0001 $(( $(date +%s) - start ))s"
   bun test --reporter=junit --reporter-outfile=$SCRATCH/f2-before-full.xml
   ```
   O `verify --json` traz gates e findings, não casos. Para os `covers`, rode o comando de teste que o verify usa **hoje** (`bun test`, com `AGENTIC_DDD_VERIFY=1`) com `--reporter=junit` e extraia os IDs com `parseJUnit` (`@agentic-ddd/compiler`) num script em `$SCRATCH`:
   ```bash
   AGENTIC_DDD_VERIFY=1 bun test --reporter=junit --reporter-outfile=$SCRATCH/f2-before-nested.xml
   bun $SCRATCH/extract-covers.ts $SCRATCH/f2-before-nested.xml | sort -u > $SCRATCH/covers-before.txt
   bun $SCRATCH/extract-cases.ts $SCRATCH/f2-before-nested.xml | sort > $SCRATCH/cases-before.txt   # file + name dos casos não pulados
   ```
2. Adicione em `agentic.config.ts` um bloco `verify: { test: ['bun','test', …escopo-alvo] }`.
3. Faça `verify.test.ts` usar esse escopo, que já vem do config, ou uma fixture. Não mude asserções de status.
4. **Medir depois** com os mesmos comandos. No passo dos `covers`, use o novo comando do config (`AGENTIC_DDD_VERIFY=1 bun test <escopo> --reporter=junit …`) e grave em `covers-after.txt`. Para provar que não houve perda de cobertura:
   - `covers-before.txt` e `covers-after.txt` são **idênticos**, e é esse conjunto que G4/G5 enxergam em `verify 0001`/`0002`;
   - a lista de testcases **não pulados** (`status !== 'skipped'`, `file` + `name`) do JUnit aninhado é **idêntica** antes e depois (`$SCRATCH/cases-before.txt` vs `cases-after.txt`). Esse é o check que pega a perda de testes sem `covers`, como o de arquitetura;
   - o diff das listas de testcases da suíte completa (`bun test`) é vazio. O escopo restringe só o verify aninhado, não o CI.
5. Registre as medições no corpo do PR. O tempo real do CI só se mede depois do push, já com aprovação.

### Verificação
```bash
bun test src/cli/verify.test.ts test/evals-verification-scope.test.ts src/compiler/config*.test.ts
bun run agentic verify 0001 && bun run agentic verify 0002   # done / needs-human
diff $SCRATCH/covers-before.txt $SCRATCH/covers-after.txt     # vazio
diff $SCRATCH/cases-before.txt $SCRATCH/cases-after.txt       # vazio (testes não pulados)
```
+ o gate mínimo.

### Critérios de saída
- `verify 0001` = `done` e `0002` = `needs-human`, com a mesma mensagem de G6.
- Diffs de cobertura vazios.
- Tempo local de `bun test` menor. Depois do push, o CI fica abaixo de 25m54s, a confirmar no PR.

---

## Fase 3 — F3 + F4: integridade das evals

- **Branch/worktree:** `fix/evals-evidence-integrity` em `../nadd-f3`
- **Modelo:** Sonnet 5.5 para integração e revisão.
- **Skills/agentes:** `ecc:eval-harness`, `ecc:agent-security-hardening`; agentes `ecc:security-reviewer` e `ecc:silent-failure-hunter`.

### Contexto
- **F3:** em `scripts/evals/reference.ts`, o código submetido roda no mesmo processo que gera a evidência. O JUnit é gravado dentro do workspace sem ser apagado antes: `.executor-junit.xml` em `:113-125` e `.reference-junit.xml` em `:158-178`. O diff de árvore ignora esses arquivos (`:210-217`), e `tests()` (`:18-36`) não confere nomes nem contagem esperados. Um corpo que grava XML falso e chama `process.exit(0)` forja aprovação (reproduzido). As 65 evidências publicadas estão íntegras: o risco é latente.
- **Restrição de isolamento:** os comandos rodam sob bubblewrap (`scripts/evals/isolation.ts:307-360`). O workspace é `--bind` e o resto é `--ro-bind`. `sandboxCommand` aceita `extraWritable` (`isolation.ts:349-352`), mas `workspaceCommand` só repassa `extraReadOnly` (`scripts/evals/commands.ts:16-20`). O `bwrap` está instalado nesta máquina, então os testes de evals rodam localmente.
- **Por que mover o JUnit não basta:** o código submetido roda **no mesmo processo** `bun test`. Ele lê o caminho do outfile em `process.argv` e escreve onde o Bun escreveria. O template do oráculo também é legível, então conferir nomes e contagem é uma camada a mais, não um segredo. Fato verificado no 1.4.2: com `process.exit(0)` no meio da suíte, o Bun **não** imprime o resumo (`N pass`, `Ran N tests across M file(s)`).
- **Mecanismo principal (decidido):**
  1. apagar o JUnit antes de rodar e falhar se ele existir no início;
  2. exigir no stderr o resumo final do Bun, com contagem igual à do JUnit e à do oráculo (depende do item 4: sem o preload, `process.exit` suprime o resumo);
  3. exigir nomes e contagem do oráculo;
  4. um `--preload` do harness que neutralize `process.exit`, para que o resumo final sempre saia (decidido pelo usuário em 2026-10-12; ver "Decisão para a Fase 3" no fim).

  Mover o JUnit para fora do workspace, via `extraWritable`, é defesa em profundidade, não a correção. O risco residual (código no mesmo processo forjando também o resumo depois de contornar o preload) fica registrado no PR e na spec das evals.
- **Oráculo:** `evals/implementation/tasks/reference/*.test.ts.txt` (5 arquivos: `entity-Task`, `method-Task-complete`, `usecase-create_task`, `usecase-complete_task`, `operator-task-operator`).
- **F4:** veredito divergente.
  - `scripts/evals/aggregate.ts:271-281` trata `finished && exitCode ≠ 0` como `infra_error`, e `cancelled` também como `infra_error`.
  - `scripts/evals/skills.ts:221-237` julga a resposta independentemente do `exitCode` e deixa `cancelled` como `not_run` (`skills.ts:167`).
  - `c.verdict` também é lido por `classifyRunStatus` (`scripts/evals/run.ts:36`) e por `scripts/evals/report.ts:29,115,117`.
  - Nenhum caso publicado é afetado. Por isso "reproduzir os agregados" não discrimina a escolha: qualquer semântica reproduz.

### Tarefas
1. **Linha de base de reprodutibilidade.** O CLI exige `--campaign` e `--out`, e `--out` tem de ser um diretório novo (`aggregate.ts:676-677`):
   ```bash
   bun run evals:aggregate --campaign evals/campaigns/cycle-20/index.json --out $SCRATCH/agg-before
   PUB=docs/superpowers/validation/2026-10-10-evals-20/real/aggregate
   diff $SCRATCH/agg-before/aggregate.json $PUB/aggregate.json && diff $SCRATCH/agg-before/aggregate.md $PUB/aggregate.md
   ```
   Se `agg-before` já divergir do publicado em `main`, isso é achado novo: PARE e reporte.
2. Testes de regressão (red):
   - um corpo submetido que lê o caminho do outfile em `process.argv`, grava XML falso nele e chama `process.exit(0)` tem de ser **REJEITADO**;
   - a mesma forja gravando no caminho fixo `.executor-junit.xml` → rejeitada;
   - JUnit com casos a menos, a mais ou com nomes trocados em relação ao oráculo → rejeitado;
   - JUnit pré-existente no workspace antes da execução → falha explícita;
   - stderr sem o resumo final do Bun, ou com contagem divergente do JUnit → rejeitado;
   - com o preload ativo, `process.exit(0)` chamado pelo corpo submetido não interrompe a suíte: o resumo final sai e a forja é rejeitada;
   - positivo: a submissão de referência legítima continua aprovada.
3. Implemente o mecanismo principal decidido acima. `tests()` passa a receber os nomes e a contagem esperados, extraídos do oráculo.
4. **F4:** extraia uma única função `verdictOf(execution, expect)`, usada pelo runner (`skills.ts`) e pelo agregador (`aggregate.ts`). Adote a **semântica do agregador**, que é a mais segura: exit ≠ 0 → `infra_error`. Para `cancelled`, decida entre `not_run` e `infra_error` e documente o efeito em `classifyRunStatus` e em `report.ts`. Teste em tabela cobrindo `timeout`, `cancelled`, `infra_error`, `finished` com exit ≠ 0, JSON inválido e acerto/erro, mais um teste de `classifyRunStatus` com os casos que mudam.
5. **Prova de inalterabilidade:**
   ```bash
   bun run evals:aggregate --campaign evals/campaigns/cycle-20/index.json --out $SCRATCH/agg-after
   diff -r $SCRATCH/agg-before $SCRATCH/agg-after          # vazio
   git diff --exit-code -- docs/superpowers/validation evals   # vazio
   ```
6. Revisão com `ecc:security-reviewer` (a forja continua possível por outro caminho?) e `ecc:silent-failure-hunter` (algum `catch` engole erro e vira aprovação?).

### Verificação
`bun test test/evals-*.test.ts`, os dois `diff` acima e o gate mínimo.

### Critérios de saída
- Os testes de forja passam, ou seja, a forja é rejeitada, inclusive a variante via `argv`. O risco residual está documentado.
- Uma única função de veredito, com teste em tabela e efeito em `classifyRunStatus` testado.
- Agregados reproduzidos idênticos; evidências publicadas intocadas.

---

## Fase 4 — F5: hardening do compilador

- **Branch/worktree:** `fix/compiler-validation-hardening` em `../nadd-f4`
- **Modelo:** Haiku 5.5 por item; revisão com o agente `ecc:typescript-reviewer` (Sonnet 5.5).
- **Skills:** `ecc:tdd-workflow`, com **um teste por item**, cada um red antes do fix.

### Itens (arquivo:linha → comportamento exigido)
| # | Onde | Hoje | Exigido (teste) |
|---|---|---|---|
| a | `src/compiler/compile.ts:186-199` | o modo escrita arquiva a proposta e grava o lock mesmo com erro de lint | com erro de lint, sai ≠ 0 e **não** arquiva a proposta nem grava o lock. Os artefatos gerados continuam sendo escritos: é a decisão documentada em `src/cli/cli.test.ts:144` ("erro de lint no modo write sai com 1 mas ainda escreve", commit `c9b29b9`), que não muda sem nova decisão explícita |
| b | `src/compiler/changes/proposal.ts:165-169` | `acceptance[].covers` não é validado contra o IR | na **proposta aberta**, `covers ⊆ IR ∪ ids de delta.added`, validado onde o IR existe (`reconcile`/`compile`), não em `parseProposal`, que não recebe o IR e também lê o archive (`proposal.ts:263`). Propostas arquivadas ficam fora. Testes: id inexistente → erro; positivo com a forma da 0002 (cobre `invariant:Order/cancelamento-exige-motivo`, que estava em `delta.added`) → aceito |
| c | `proposal.ts:130-135` | `delta` aceita chave desconhecida ou valor não-objeto | chave desconhecida ou valor não-objeto → erro |
| d | `src/compiler/validate.ts` (comparar com `src/runtime/operator-runtime.ts:52-58`) | limits de operator inválidos só falham em runtime | `validate` rejeita em tempo de compilação. A regra vai para `src/contracts/`, que o runtime já importa (`operator-runtime.ts:12`), e é compartilhada pelos dois, sem import entre compiler e runtime |
| e | `src/compiler/config.ts:58-63` | aceita módulo com nome ou caminho duplicado | duplicado → erro de config |
| f | `src/compiler/validate.ts:69-80` | aceita `transition.from: ['']` | estado vazio → erro |
| g | `src/compiler/write.ts:288-302` vs `:214-229` | `--check` não detecta link de espelho órfão que a escrita remove | `compile --check` falha com link órfão, repetindo exatamente a condição da escrita (`target.startsWith(skillsRoot)`). Negativo: `.claude/skills/agentic-ddd`, que aponta para `skills/` (link autoral), **não** é tratado como órfão |

Restrição de arquitetura: `src/compiler` e `src/runtime` não importam um do outro (issue #7 e teste de arquitetura).
### Verificação
```bash
bun test src/compiler src/cli test/architecture.test.ts
bun test                                   # suíte completa (F5 muda o que é "válido")
bun run agentic verify 0001                # done
git diff --stat -- '**/__snapshots__/**'   # esperado: vazio
```
+ o gate mínimo.

### Critérios de saída
- Sete testes novos, cada um visto falhando antes do fix.
- **Nenhuma mudança de snapshot.** Se alguma for inevitável, ela vem justificada linha a linha no corpo do PR.
- `compile --check` limpo no repositório.

---

## Fase 5 — F6: core

- **Branch/worktree:** `fix/core-value-object-equality` em `../nadd-f5`
- **Modelo:** Sonnet 5.5, porque é decisão de design; revisão com `ecc:type-design-analyzer`.
- **Skill:** `ecc:architecture-decision-records`. O ADR vem **antes** de mudar `equals`.

### Contexto
- **(a)** `src/core/value-object.ts:37-54`: o freeze profundo não protege Date/Map/Set (seus métodos mutam o estado interno), apesar do comentário.
- **(b)** `src/core/entity.ts:8`: `equals` compara o id com `===`, então duas entidades com o mesmo id em value object nunca são iguais.

### Tarefas
1. **(a)** Teste que mostra a mutação (`vo.props.date.setFullYear(…)`, `map.set`, `set.add`). Depois escolha uma saída:
   - proteger: clonar na entrada e expor cópias, ou rejeitar Date/Map/Set em props;
   - não proteger: corrigir o comentário e documentar a limitação no README/JSDoc.

   Escolha a de menor raio de impacto e justifique no PR.
2. **(b)** Escreva `docs/adr/ADR-0002.md` (formato do ADR-0001): contexto, opções (`===`; delegar a `ValueObject.equals` quando o id for VO; exigir id primitivo), decisão e consequências.
   - Se a decisão for mudar: teste antes, depois a mudança.
   - Se não houver consenso, apresente o ADR ao usuário com status "proposto" e só documente o comportamento atual (teste de caracterização + JSDoc).

### Verificação
`bun test src/core` + o gate mínimo.

### Critérios de saída
- (a) fechado com teste, ou documentado com um teste que fixa o comportamento.
- (b) ADR-0002 escrito; código alterado só com decisão "aceito".

---

## Fase 6 — F7: exemplo orders (mudança de regra de negócio)

- **Branch/worktree:** `feat/orders-cancellation-reason` em `../nadd-f6`
- **Modelo:** Haiku 5.5 para a implementação (via o agente `agentic-ddd-executor`); proposta e contratos com o agente `agentic-ddd-manager`.
- **Skills:** `agentic-ddd`, `orders-dev`.
- **Depende de:** Fase 4 mergeada (F5(a): o compile não pode gravar lock com erro).

### Contexto
- **(a)** O motivo do cancelamento é descartado (`examples/orders/domain/order.ts:121`, `order.events.ts:27-31`), contra o `## Motivo` de `changes/archive/0002-cancelamento-exige-motivo/proposal.md`.
- **(b)** `examples/orders/application/cancel-order.ts:12` usa `reason: z.string().min(1)` e responde `invalid_input` em vez de `CANCELLATION_REASON_REQUIRED`.
- **(c)** `Order.create` aceita NaN, quantidade ≤ 0 e itens compensados (`order.ts:69-81`).
- **(d)** Faltam testes negativos no use-case.

As propostas anteriores estão em `changes/archive/0001-*` e `0002-*`.

### Tarefas
1. **Antes de qualquer código:** escreva `changes/0003-<slug>/proposal.md` (ex.: `0003-pedido-valido-e-motivo-registrado`) com delta, critérios de aceite (com `covers` de IDs que existirão no IR) e `## Motivo`. Formato igual ao de `changes/archive/0002-*/proposal.md`.
2. Novas invariantes com `@Invariant({ id, text })` e ID estável; o evento de cancelamento carrega `reason`; o use-case delega a validação do motivo à entidade, para que a resposta seja `CANCELLATION_REASON_REQUIRED`.
3. Testes com `covers([...], título)`, incluindo os negativos do use-case.
4. `bun run agentic compile`. Isso **regenera** `.agents/skills`, `.agentic/runtime` e o bloco do `AGENTS.md`, o que é esperado: não é edição manual. Diga isso no PR.
5. Coordenação: `bun run agentic status`/`next` → `packet <item>` → `verify --item <item> --spec-hash <hash>`.

### Verificação (última fase de código: gate completo)
```bash
bun test
bun run agentic verify 0003     # done ou needs-human
bun run agentic verify 0001     # done
bun run agentic verify 0002     # needs-human (a F7 mexe em cancel_order/OrderCancelled, cobertos pela 0002)
bun test src/cli/verify.test.ts # fixa a mensagem do G6 e os warnings do G4 da 0002
bun run agentic compile --check
```
+ o gate mínimo.

### Critérios de saída
- `verify 0003` ∈ {done, needs-human}; `verify 0002` continua `needs-human` com a mesma mensagem de G6.
- `bun test` completo verde; `verify 0001` = done.
- Nenhum arquivo gerado editado à mão (`git diff` dos gerados = saída de `compile`).

---

## Fase 7 — Spec e plano do Plano 7 (issue #7), só documentação

- **Branch/worktree:** `docs/plan7-llm-adapter-spec` em `../nadd-f7`
- **Modelo:** Opus 5.5; agentes `ecc:architect` e `ecc:planner` via `/ecc:plan`.

### Contexto
Issue #7: primeiro adapter real de `LlmPort`, com um único provider justificado no design. Contratos de partida: `src/runtime/ports.ts` e `src/runtime/types.ts`. Os critérios estão na issue: testes de contrato offline, teste real opt-in, nenhuma chamada paga no CI, compiler e runtime sem imports entre si.

### Requisitos derivados de F8 (entram na spec, **não** são corrigidos nesta fase)
| # | Onde | Requisito |
|---|---|---|
| a | `src/runtime/ports.ts:9-11` | `LlmPort.complete` aceita `AbortSignal` (timeout e cancelamento cooperativos) |
| b | `src/runtime/run.ts:214-218` | preservar o erro original (`cause`) e classificar falhas do provider, sem colapsar tudo em `provider_error` |
| c | `run.ts:108-117, 211` | `stopReason ≠ end` sem `tool_call` não gera mensagem `tool` vazia até o `step_limit`: termina com um motivo explícito |
| d | `src/runtime/event-bus.ts:30-38` | subscriber que lança não interrompe a entrega nem falha um run cujo efeito já foi gravado |
| e | `event-bus.ts:7, 30` | `InMemoryEventBus.events` tem limite ou é opt-in |
| plausíveis | — | orçamento por `usage`; limite de tool calls por passo; definições de tools não compartilhadas entre runs |

### Tarefas
1. `/ecc:plan` com `ecc:architect` (escolha do provider, consultando a documentação oficial) e `ecc:planner` (passos).
2. Escreva `docs/superpowers/specs/2026-10-12-plan7-llm-adapter-design.md` e `docs/superpowers/plans/2026-10-12-plan7-llm-adapter.md`, no estilo dos planos v0-0X.
3. Atualize o índice `docs/superpowers/plans/2026-10-06-v0-00-index.md`, se ele listar os planos futuros.

### Critérios de saída
- O diff só mexe em `docs/`.
- F8 (a)–(e) aparecem como requisitos rastreáveis, com arquivo:linha.
- Nenhum código de adapter.

---

## Critérios de aceite globais

- Local: `bun test` completo verde e `bun run agentic verify 0001` = done.
- CI verde e mais rápido que 25m54s.
- Nenhum caminho novo de falso done: cada fase que amplia uma aceitação traz um teste negativo.
- Evidências publicadas inalteradas e reproduzíveis.
- Cada achado F1–F7 fechado com teste ou registrado como decisão documentada.

## Status

| Fase | Branch | Estado | PR |
|---|---|---|---|
| 1 — F1 | `fix/verify-empty-suite` | mergeada (`4982b4b`); o commit `b8ebe3d` do plano entrou depois do merge e foi reaplicado na Fase 2 | #23 |
| 2 — F2 | `ci/verify-test-scope` | mergeada (`117b45b`); CI do PR em 17m57s (linha de base 25m54s) | #24 |
| D1 | `ci/evals-parallel-job` | commitado; aguarda aprovação de push/PR | — |
| 3 — F3+F4 | `fix/evals-evidence-integrity` | pendente | — |
| 4 — F5 | `fix/compiler-validation-hardening` | pendente | — |
| 5 — F6 | `fix/core-value-object-equality` | pendente | — |
| 6 — F7 | `feat/orders-cancellation-reason` | pendente | — |
| 7 — Plano 7 | `docs/plan7-llm-adapter-spec` | pendente | — |

## Protocolo de mutação do plano

- **Dividir fase:** quando o diff passar de ~400 linhas ou misturar achados. Crie N.a/N.b, cada uma com o seu PR, e registre aqui.
- **Pular ou adiar:** só com aprovação do usuário. Registre o motivo na tabela de status.
- **Descoberta nova:** não entra na fase corrente. Vira item no fim deste arquivo e é levada ao usuário.

## Descobertas novas

### D1 — Job paralelo de CI para `test/evals-*` (aprovado como PR separado, 2026-10-12)

- **Origem:** medições da Fase 2. Na suíte completa local (985 s depois da F2), `test/evals-run.test.ts` leva ~694 s e `test/evals-implementation.test.ts` ~129 s. A F2 só tira ~4–7 min.
- **Proposta:** dividir o job `ci` em dois jobs paralelos: (1) `bun test` sem `test/evals-*` + `build`, `test:package`, `compile --check`, `skills:install --check` e o passo `verify 0001`; (2) só `test/evals-*`, com o probe do bubblewrap. Nenhum teste pode deixar de rodar: compare a lista de testcases dos dois jobs somados com a da suíte completa.
- **Critério:** CI verde, com tempo total menor que o do PR da Fase 2. Sem perda de cobertura.
- **Quando:** PR próprio, depois do merge da Fase 2 e antes da Fase 3 (escolha do usuário).
- **Feito:** o job `ci` roda `bun test --path-ignore-patterns='test/evals-*'` e não instala mais o bubblewrap (só `test/evals-*` importa `scripts/evals/isolation`); o job `evals` roda `bun test ./test/evals-*.test.ts` com o probe. Partição conferida com filtro vazio e JUnit: 387 + 85 = 472 casos, união por arquivo+suíte+nome igual à suíte completa, interseção vazia. `test/evals-verification-scope.test.ts` fica no job `evals`; `test/evals.test.ts` (sem hífen) fica no job `ci`. A `main` não tem proteção de branch; para um `evals` vermelho bloquear merge, os dois checks precisam virar obrigatórios.

### Decisão para a Fase 3 (usuário, 2026-10-12)

- Risco residual da forja do resumo do Bun: adotar o `--preload` que neutraliza `process.exit` (o resumo final sempre é impresso) e exigir esse resumo com contagem igual à do JUnit e à do oráculo. Deixa de ser opcional no brief da Fase 3.
