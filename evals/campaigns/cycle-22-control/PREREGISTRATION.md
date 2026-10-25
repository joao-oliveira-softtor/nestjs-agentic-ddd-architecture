# Pré-registro do controle cycle-22 (#88)

Este arquivo é versionado **antes de qualquer execução real**. A campanha compara o framework
completo (F) com um controle sem skill nem regras (C0) no tutorial `matriculas`, conforme a
ADR-0006 (D10). Ela produz uma **medição**; a decisão é do usuário. O ensaio offline ponta a
ponta, só com o adapter `scripted`, está em `test/evals-control-rehearsal.test.ts`, que também
confere este texto contra os manifestos.

## Braços

Todos com `benchmark: matriculas`, `maxCorrectionsPerItem: 1`, `skillDatasets: []`,
`authentication: oauth-token`, duas repetições (r1 e r2) e `sourceRef`
`1beb36316370b2377a6b4038f3a9d5038e002469` (último commit de implementação do PR da #88).

| Braço | Configuração | `promptMode` | Modelo              | Esforço  |
| ----- | ------------ | ------------ | ------------------- | -------- |
| C0    | `c0-bare`    | `bare`       | `claude-sonnet-5-5` | `medium` |
| F     | `f-brief`    | `brief`      | `claude-sonnet-5-5` | `medium` |

- **C0**: prompt mínimo (root, item, arquivo, teste, formato de resposta). Sem skill, regras,
  packet, brief nem critérios no workspace durante os turnos (o harness tira `.agents/`,
  `.claude/`, `.cursor/`, `.codex/`, `.agentic/`, `.ai/`, `AGENTS.md` e `CLAUDE.md` do workspace e
  os devolve antes da auditoria e da verificação). Retentativa **só** quando a execução não
  terminou (transporte), sem findings e sem patch.
- **F**: framework completo, `brief`, packet e gates. Retentativa quando os gates do framework
  (auditoria, `verify --item`, cobertura) reprovam, com os findings deles. Os findings do
  oráculo privado são retirados da correção.
- Mesmo modelo e mesmo esforço nos dois braços (decisão do usuário, 2026-10-23; a ADR diz "mesmo
  modelo" e o manifesto exige nome concreto).

## Condições

- Framework v0.5; esqueleto do tutorial `matriculas` (7 itens: `valueobject:AlunoId`,
  `valueobject:TurmaId`, `entity:Aluno`, `entity:Turma`, `entity:Matricula`,
  `usecase:matricular_aluno`, `adapter:InMemoryMatriculaRepository`).
- **Dependências prontas** (decisão do usuário, 2026-10-23): em cada item, nos dois braços, o
  baseline é o esqueleto com as soluções de referência dos **colaboradores** do item. Lê-se
  "dependências" como colaboradores de execução (fecho de `dependsOn`, alvos de `references`,
  ports do use-case e port do adapter), porque `references` e ports não criam aresta no grafo.
  Nada é promovido: todo item roda nos dois braços e não se mede propagação de erro.
- Tetos numéricos idênticos nos quatro manifestos: `maxInvocations` 14 (7 itens × 2, pior caso
  exato), `skillTimeoutMs` 120000, `implementationTimeoutMs` 600000 (10 min), `totalTimeoutMs`
  12000000 (14 × 10 min + 60 min de folga para baseline, `status` e `verify`).
- **Teto total da campanha: 4 × 14 = 56 invocações.** Refazimentos não entram nos 56 e cada um
  exige nova autorização.
- Ordem intercalada: r1 de C0 e F, depois r2 na mesma ordem. Execuções sequenciais.

## Pareamento e métricas

Pareamento por item: 7 itens × 2 repetições, cada par é o mesmo item e a mesma repetição nos
dois braços (`controlMetrics` em `scripts/evals/aggregate.ts`).

- **Primária**: `oracleAccepted` na **primeira** tentativa (oráculo privado verde), por item.
- **Secundária**: `oracleAccepted` na **última** tentativa.
- **`tacticalViolations`**: achados T1/T2 do gate tático. Só o C0 consegue acrescentar campos
  (no F a auditoria e o sandbox impedem), portanto é **descritiva**, nunca comparada.
- **`trapDefects`**: casos `trap:*` do oráculo que falharam, por armadilha A a D (A aluno
  inteiro, B regra entre agregados, C VO com invariante, D consulta própria). Se o oráculo
  tiver `collectionError` (a submissão quebrou o import), **todos** os casos `trap:*` do item
  contam como defeito.
- Resposta `blocked`, `failed` ou malformada também é medida; só árvore insegura (`Unsafe
submission tree`) fica sem medição.

## Regra de leitura

Soma, nos 14 pares, da diferença F menos C0 em `oracleAccepted` da primeira tentativa. Diferença
total **menor que 3 itens** (em módulo) é **inconclusiva**: nenhuma conclusão sobre o efeito do
framework. Diferença de 3 ou mais é apresentada como achado descritivo, com os valores por
item, sem teste estatístico. Execução com `infra_error`, relatório que não terminou
`completed`, slot `not_run` ou ausente torna a campanha inconclusiva até o refazimento
autorizado.

## Desvios declarados

- **Assimetria da retentativa é o tratamento**: o F corrige com os findings dos gates; o C0 só
  repete se a execução não terminou, sem findings.
- Não há `verify 0001` final no `matriculas` (nada é promovido, então não há árvore final).
- O gate T só mede violação nos itens `entity:` e `valueobject:`.
- O C0 ainda pode **ler** a skill do framework montada só para leitura em
  `<frameworkRoot>/skills/agentic-ddd` e alcançar `bun run agentic ...` pelo `package.json` e o
  framework pelo link em `node_modules`, sem ser apontado para eles.
- A proposta arquivada `changes/archive/0001-matriculas/` e os testes com `covers` das
  dependências semeadas ficam visíveis nos dois braços, porque fazem parte do esqueleto.
- O `covers` dos critérios é inalcançável para o C0 (sem o packet); só `oracleAccepted` compara
  os braços.
- Workspace com `.claude/` e `CLAUDE.md` no F carregados por `--setting-sources project`; no C0
  eles estão ocultos durante o turno.

## Execução real

Só com **autorização explícita do usuário** e **orçamento à parte** (teto de 56 invocações). O
primeiro passo declarado da autorização é atualizar o `sourceRef` nos manifestos e neste texto
para o SHA do merge (ou para o head novo, depois de um rebase), porque o teste do texto acusa a
divergência. Credencial: `claude setup-token` rodado pelo usuário, exportado como
`CLAUDE_CODE_OAUTH_TOKEN` só na sessão de shell da execução, nunca em arquivo. Relatórios fora
do repositório até o PR de resultados; depois, `bun run evals:aggregate --campaign
evals/campaigns/cycle-22-control/index.json --out <diretório novo>`.
