# Avaliações #17–#20 — registro de execução

Branch: feat/evals-cycle-17-20. Origem inicial: 0cbd74bcdaf662f1eb07afc613b3b89b08c2d425.

## Decisões

- A execução offline de #18–#20 continua enquanto #17 aguarda autorização de inferência. Isso prepara todas as entregas reversíveis; #17 não será certificada sem runs reais.
- O orçamento do plano é um limite proposto e diz expressamente que não autoriza inferência. Nenhuma sessão real foi iniciada.
- Specs/planos de cada issue versionados antes da implementação.

## Critérios

- #17: manifestos fixos preparados; certificação real pendente.
- #18: critérios demonstrados offline; integração e dependência #17 pendentes.
- #19: critérios demonstrados offline; integração e dependência #17 pendentes.
- #20: agregador verificado offline; seis posições em preparação; campanhas reais pendentes.

## Entregas offline

- #17: [Codex](../../../evals/run.certify.codex-sol-high.json) e [Cursor](../../../evals/run.certify.cursor-codex-medium.json) derivados da referência sem trocar modelos, parâmetros ou autenticação. Fonte imutável: 0cbd74b (SHA completo nos manifestos). Controle positivo de runEvaluation responde às cinco perguntas e aceita os cinco packets; verify 0001 retorna done independente. Isso valida o runner offline, sem certificar os modelos reais.
- #18: [dataset adicional](../../../evals/skills/orders.extended.yaml), [teste](../../../test/evals-extended.test.ts). Dez casos dev/dez runtime, cinco positivos/cinco negativos por público. Todos exercitados com respostas corretas/incorretas/malformadas, argumentos completos validados com AJV. Fixture versiona overlays no clone privado antes de congelar; fonte original não é alterada.
- #19: [suíte completa](../../../test/evals-run.test.ts), 19 defeitos de corpos com auditoria aprovada e execução superficial verde, rejeitados pelo oráculo privado; controle positivo, correção fresca e quatro estados de falha completam 25 casos. Oráculos usam dois IDs/títulos fixos distintos e conferem chamadas de save para criação/conclusão.
- #20: [agregador](../../../scripts/evals/aggregate.ts), [testes](../../../test/evals-aggregate.test.ts). Validam posições/IDs/schema, hashes de manifestos/relatórios/artefatos e referências de evidência, recalculam respostas/aceitação por execução, gates e duas suítes de teste. Métricas pré-calculadas são opcionais e não são usadas.

## Revisão e reproduções

- O teste de ID fixo reproduziu falsa aceitação pelo oráculo anterior; depois dos dois pares determinísticos, a mesma submissão é rejeitada.
- O teste de verificação final indisponível reproduziu a omissão dos callbacks públicos por runEvaluation. O runner agora propaga onCase/onBenchmark após atualizar o ledger interno. O teste reduz o tempo somente após os cinco itens aceitos e confirma ausência de certificação da change.
- Revisão independente pela skill superpowers:requesting-code-review identificou duas falhas no agregador: erro de infraestrutura do verificador contado como comportamento, e evidências referenciadas ausentes aceitas. Ambas reproduzidas (RED) antes da correção e cobertas (GREEN). Sem findings menores adiados.
- A suíte de runEvaluation não declara cobertura de orders e é omitida nas invocações recursivas do verify do exemplo (AGENTIC_DDD_VERIFY=1), seguindo a convenção já usada pelo teste da CLI. Executa integralmente no bun test principal. Sem esse limite, a CLI lançava novamente todas as campanhas offline.
- Proveniência/contratos desconhecidos na preparação são explícitos, não inferidos como equivalentes a execuções completas. Grupos descrevem runs executados; totais por configuração mantêm todas as posições planejadas. Baselines temporários brutos ficam no JSON e não definem equivalência.
- O agregador não oferece autenticação criptográfica de relatórios nem resistência adversarial; valida consistência interna e todos os hashes declarados.

## Evidências e verificação

- [Checks completos](2026-10-10-evals-checks.log.txt): 455 testes em 56 arquivos, zero falhas, 14 snapshots e 2404 assertions. Typecheck, lint, build, compile --check e skills:install --check concluídos com exit 0. O exemplo mantém verify 0001 = done e verify 0002 = needs-human.
- #17: [preflight](2026-10-10-evals-17/preflight.json), [controle scripted JSON](2026-10-10-evals-17/scripted-control/report.json), [Markdown](2026-10-10-evals-17/scripted-control/report.md) e [hashes de todos os artefatos](2026-10-10-evals-17/scripted-control/artifact-manifest.json). Cinco perguntas corretas, cinco packets aceitos e verify 0001 done; 10 sessões scripted, nenhuma inferência real. Fingerprints da origem iguais antes/depois. Para reproduzir, copie [control.ts.txt](2026-10-10-evals-17/control.ts.txt) para /tmp/control-script.ts; da raiz de um checkout limpo, execute `bun /tmp/control-script.ts <diretório-externo-novo>`.
- O primeiro controle manual registrou a fixture sob a chave do adapter em vez do ID da configuração. O runner usou o scripted padrão, que deixa itens bloqueados. [Relatório inicial preservado](2026-10-10-evals-17/scripted-setup-error/report.json); a chave foi corrigida na fixture, sem mudar instruções/gates, e o controle foi executado em novo diretório.
- #18: [hashes/dados](2026-10-10-evals-18/datasets.json), [RED](2026-10-10-evals-18/red.log.txt) e [GREEN](2026-10-10-evals-18/green.log.txt). Quatro testes exercitam os 20 casos e validam o original byte-idêntico.
- #19: [RED](2026-10-10-evals-19/red.log.txt) e [GREEN](2026-10-10-evals-19/green.log.txt), 25 testes. A primeira execução completa teve duas expectativas erradas nas fixtures ([log](2026-10-10-evals-19/initial-fixture-errors.log.txt)): executável ausente dentro do sandbox gera process_nonzero; o timeout final precisa permitir as duas leituras de status/next anteriores. As expectativas foram corrigidas e os 25 testes passaram na suíte completa.
- #20: [reproduções da revisão](2026-10-10-evals-20/review-red.log.txt) e [GREEN](2026-10-10-evals-20/green.log.txt), nove testes; ausência de métricas derivadas também é exercitada.
- APIs públicas, orders, dataset original e artefatos históricos não tiveram alterações. Specs e planos próprios estão versionados desde d6ef40b, antes do código.

## Inferência real

Nenhuma sessão real iniciada. #17 exige orçamento de duas execuções (até 30 sessões/90 minutos no total). #20 exige autorização própria para seis execuções (até 210 sessões/270 minutos). Falhas reais serão preservadas e reproduzidas offline antes de alterar instruções; sem repetição automática, reparo manual ou relaxamento de gates. Issues de certificação/campanha continuam abertas.
