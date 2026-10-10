# Avaliações #17–#20 — registro de execução

Branch: feat/evals-cycle-17-20. Origem inicial: 0cbd74bcdaf662f1eb07afc613b3b89b08c2d425.

## Decisões

- A preparação offline de #18–#20 ocorreu enquanto #17 aguardava autorização de inferência. Após a resposta `sim` do usuário, os dois runs da #17 foram executados sequencialmente e certificados.
- O orçamento do plano era proposto; a autorização recebida cobre apenas #17, até 30 sessões/90 minutos. #20 continua exigindo autorização própria.
- Specs/planos de cada issue versionados antes da implementação.

## Critérios

- #17: ambas as configurações com cinco packets aceitos na primeira tentativa e verify 0001 done; evidências reais publicadas.
- #18: critérios demonstrados offline; dependência #17 satisfeita, integração pendente.
- #19: critérios demonstrados offline; dependência #17 satisfeita, integração pendente.
- #20: agregador verificado offline; seis posições registradas; campanhas reais pendentes.

## Entregas offline

- #17: [Codex](../../../evals/run.certify.codex-sol-high.json) e [Cursor](../../../evals/run.certify.cursor-codex-medium.json) derivados da referência sem trocar modelos, parâmetros ou autenticação. Fonte imutável: 0cbd74b (SHA completo nos manifestos). Controle positivo de runEvaluation responde às cinco perguntas e aceita os cinco packets; verify 0001 retorna done independente. Isso valida o runner offline, sem certificar os modelos reais.
- #18: [dataset adicional](../../../evals/skills/orders.extended.yaml), [teste](../../../test/evals-extended.test.ts). Dez casos dev/dez runtime, cinco positivos/cinco negativos por público. Todos exercitados com respostas corretas/incorretas/malformadas, argumentos completos validados com AJV. Fixture versiona overlays no clone privado antes de congelar; fonte original não é alterada.
- #19: [suíte completa](../../../test/evals-run.test.ts), 19 defeitos de corpos com auditoria aprovada e execução superficial verde, rejeitados pelo oráculo privado; controle positivo, correção fresca e quatro estados de falha completam 25 casos. Oráculos usam dois IDs/títulos fixos distintos e conferem chamadas de save para criação/conclusão.
- #20: [agregador](../../../scripts/evals/aggregate.ts), [testes](../../../test/evals-aggregate.test.ts). Validam posições/IDs/schema, hashes de manifestos/relatórios/artefatos e referências de evidência, recalculam respostas/aceitação por execução, gates e duas suítes de teste. Métricas pré-calculadas são opcionais e não são usadas.

## Revisão e reproduções

- O teste de ID fixo reproduziu falsa aceitação pelo oráculo anterior; depois dos dois pares determinísticos, a mesma submissão é rejeitada.
- O teste de verificação final indisponível reproduziu a omissão dos callbacks públicos por runEvaluation. O runner agora propaga onCase/onBenchmark após atualizar o ledger interno. O teste reduz o tempo somente após os cinco itens aceitos e confirma ausência de certificação da change.
- Revisão independente pela skill superpowers:requesting-code-review identificou duas falhas no agregador: erro de infraestrutura do verificador contado como comportamento, e evidências referenciadas ausentes aceitas. Ambas reproduzidas (RED) antes da correção e cobertas (GREEN). Sem findings menores adiados.
- As quatro suítes de orquestração de benchmarks não declaram cobertura de orders e são omitidas nas invocações recursivas do verify do exemplo (AGENTIC_DDD_VERIFY=1), seguindo a convenção já usada pelo teste da CLI. Executam integralmente no bun test principal. O CI inicial expôs dois timeouts ao repetir campanhas dentro da coleta de qualidade. A [reprodução e correção](2026-10-10-evals-19/ci-scope/README.md) demonstram que os benchmarks ficam skipped nessa coleta e todos os testes de domínio com covers executam e passam. Nenhum gate, timeout ou cobertura de domínio foi alterado.
- Proveniência/contratos desconhecidos na preparação são explícitos, não inferidos como equivalentes a execuções completas. Grupos descrevem runs executados; totais por configuração mantêm todas as posições planejadas. Baselines temporários brutos ficam no JSON e não definem equivalência.
- O agregador não oferece autenticação criptográfica de relatórios nem resistência adversarial; valida consistência interna e todos os hashes declarados.

## Evidências e verificação

- [Manifesto SHA-256](2026-10-10-evals-evidence-manifest.json) dos datasets, configurações, contratos de avaliação, specs/planos e todas as evidências publicadas neste ciclo; o próprio manifesto não inclui seu hash.
- [Checks iniciais preservados](2026-10-10-evals-checks.log.txt): 455 testes em 56 arquivos, zero falhas, 14 snapshots e 2404 assertions. Typecheck, lint, build, compile --check e skills:install --check concluídos com exit 0. O exemplo mantém verify 0001 = done e verify 0002 = needs-human.
- [Checks após a correção do CI](2026-10-10-evals-19/ci-scope/full-checks.log.txt): 456 testes em 57 arquivos, zero falhas, 14 snapshots e 2410 assertions. Typecheck, lint, build, compile --check e skills:install --check concluídos com exit 0 no commit 01bc637351f82dbcff371fa2b5e62249e65a4d38. Os dois verifies do exemplo passaram com os resultados preservados.
- [CI remoto aprovado](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/actions/runs/38060375953) no mesmo commit: [estado e etapas](2026-10-10-evals-19/ci-scope/ci-green.json), [log completo](2026-10-10-evals-19/ci-scope/ci-green.log.txt). A publicação posterior acrescenta somente documentos e evidências.
- #17: [preflight](2026-10-10-evals-17/preflight.json), [controle scripted JSON](2026-10-10-evals-17/scripted-control/report.json), [Markdown](2026-10-10-evals-17/scripted-control/report.md) e [hashes de todos os artefatos](2026-10-10-evals-17/scripted-control/artifact-manifest.json). Cinco perguntas corretas, cinco packets aceitos e verify 0001 done; 10 sessões scripted, nenhuma inferência real. Fingerprints da origem iguais antes/depois. Para reproduzir, copie [control.ts.txt](2026-10-10-evals-17/control.ts.txt) para /tmp/control-script.ts; da raiz de um checkout limpo, execute `bun /tmp/control-script.ts <diretório-externo-novo>`.
- O primeiro controle manual registrou a fixture sob a chave do adapter em vez do ID da configuração. O runner usou o scripted padrão, que deixa itens bloqueados. [Relatório inicial preservado](2026-10-10-evals-17/scripted-setup-error/report.json); a chave foi corrigida na fixture, sem mudar instruções/gates, e o controle foi executado em novo diretório.
- #18: [hashes/dados](2026-10-10-evals-18/datasets.json), [RED](2026-10-10-evals-18/red.log.txt) e [GREEN](2026-10-10-evals-18/green.log.txt). Quatro testes exercitam os 20 casos e validam o original byte-idêntico.
- #19: [RED](2026-10-10-evals-19/red.log.txt) e [GREEN](2026-10-10-evals-19/green.log.txt), 25 testes. A primeira execução completa teve duas expectativas erradas nas fixtures ([log](2026-10-10-evals-19/initial-fixture-errors.log.txt)): executável ausente dentro do sandbox gera process_nonzero; o timeout final precisa permitir as duas leituras de status/next anteriores. As expectativas foram corrigidas e os 25 testes passaram na suíte completa.
- #20: [reproduções da revisão](2026-10-10-evals-20/review-red.log.txt) e [GREEN](2026-10-10-evals-20/green.log.txt), nove testes; ausência de métricas derivadas também é exercitada.
- Campanha #20: [índice de seis posições](../../../evals/campaigns/cycle-20/index.json), [preflight](2026-10-10-evals-20/campaign-preflight.log.txt), [JSON agregado](2026-10-10-evals-20/planned/aggregate.json) e [Markdown](2026-10-10-evals-20/planned/aggregate.md). Fonte comum: dc9a25d133fa71975dfd77713e00ea653a273a82, congelada em checkout limpo contendo o dataset e os oráculos ampliados. Todos os manifestos preservam modelos/parâmetros/autenticação/contextos da referência; 25 perguntas/cinco packets, repetitions 1, 35 sessões/45 minutos. Seis posições not_run com motivo inference_budget_not_authorized; acurácia/uso indisponíveis, cobertura 0/150 e zero certificações observadas. Duas saídas independentes do CLI são byte-idênticas (JSON, Markdown e manifesto de hashes).
- Reprodução da agregação, sem inferência: `bun run evals:aggregate --campaign evals/campaigns/cycle-20/index.json --out <diretório-novo>`.
- APIs públicas, orders, dataset original e artefatos históricos não tiveram alterações. Specs e planos próprios estão versionados desde d6ef40b, antes do código.

## Inferência real

[Certificação #17 e evidências completas](2026-10-10-evals-17/real/README.md): Codex 4/5 e Cursor 3/5 nas perguntas; ambos com cinco packets aceitos inicialmente/finalmente e verify 0001 done independente. 20 sessões reais, cerca de 15,6 minutos, zero correções. Fonte/runner comuns e fingerprint da origem iguais antes/depois nos dois runs. Os três julgamentos literais incorretos foram reproduzidos offline sem alterar instruções/expectativas. Todos os hashes e schemas dos relatórios foram conferidos antes da publicação.

#20 permanece com seis posições não executadas e exige autorização própria (até 210 sessões/270 minutos). Seus inputs serão diferentes; os runs da #17 não preenchem posições da campanha #20. Sem repetição automática, reparo manual ou relaxamento de gates.
