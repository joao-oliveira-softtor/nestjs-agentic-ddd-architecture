# Regressão de coleta aninhada no CI

O [CI do commit e0e0c23](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/actions/runs/38057271961) teve 453 testes verdes e dois timeouts de 300 segundos em verify 0001/0002 do exemplo. A coleta de qualidade aninhada repetia campanhas de benchmark independentes, além dos testes do domínio ([log](ci-failure.log.txt)).

[Reprodução RED](red.log.txt): runTests, com o ambiente real AGENTIC_DDD_VERIFY=1, ainda executava benchmarks, levando 146,831 segundos. [GREEN](green.log.txt): as quatro suítes de orquestração são registradas como skipped nessa coleta e todos os testes de domínio com covers executam e passam, em cerca de 0,5 segundo. O teste test/evals-verification-scope.test.ts verifica esse comportamento em subprocesso real.

As suítes de implementação, runEvaluation, dataset adicional e agregação não cobrem regras de orders. Elas continuam executando integralmente no bun test principal; na coleta aninhada seguem a convenção existente de evitar recursão da CLI. Seus setups privados também são omitidos quando a suíte é skipped. Nenhum gate do framework, timeout da CLI, cobertura de orders, oráculo ou limite de inferência foi alterado.

[Testes da CLI após o ajuste](cli-green.log.txt): seis passaram. verify 0001 retornou done em 104,568 segundos; verify 0002 manteve needs-human em 109,731 segundos, ambos dentro do limite original de 300 segundos.

Ruling: evitar campanhas independentes dentro da coleta de qualidade do domínio — elas têm execução obrigatória no CI principal e não declaram covers de orders. Se essa distinção fosse aplicada incorretamente, poderia omitir testes relevantes; a regressão exige execução de todos os testes de domínio com covers e a suíte completa verifica a execução dos benchmarks no nível principal.

A certificação real da #17 foi executada antes deste ajuste, com fonte e runner fixos preservados nos relatórios. Nenhuma sessão real adicional foi iniciada.
