---
id: "0001"
title: Criar e concluir tarefas
status: proposed
origin: proposal-first
delta:
  added:
    - "entity:Task"
    - "invariant:Task/titulo-obrigatorio"
    - "method:Task.create"
    - "method:Task.complete"
    - "event:TaskCreated"
    - "event:TaskCompleted"
    - "usecase:create_task"
    - "usecase:complete_task"
    - "operator:task-operator"
  modified: []
  removed: []
acceptance:
  - id: titulo-invalido
    covers: ["invariant:Task/titulo-obrigatorio"]
    given: um título vazio ou com apenas espaços
    when: criar uma tarefa
    then: rejeita com TASK_TITLE_REQUIRED
  - id: criacao
    covers: ["method:Task.create"]
    given: id t1 e título com espaços nas extremidades
    when: criar a tarefa
    then: fica pending, normaliza o título e registra TaskCreated
  - id: conclusao
    covers: ["method:Task.complete"]
    given: uma tarefa pending
    when: concluir e tentar concluir novamente
    then: registra TaskCompleted, fica completed e rejeita repetição com TASK_ALREADY_COMPLETED
  - id: persistencia-criacao
    covers: ["usecase:create_task"]
    given: repositório vazio e id t1
    when: executar create_task e repetir o mesmo id
    then: salva, publica TaskCreated, retorna pending e rejeita duplicado com TASK_ALREADY_EXISTS
  - id: persistencia-conclusao
    covers: ["usecase:complete_task"]
    given: tarefa t1 persistida e um id inexistente
    when: executar complete_task
    then: salva completed, publica TaskCompleted e rejeita id ausente com TASK_NOT_FOUND
  - id: tools
    covers: ["operator:task-operator"]
    given: FakeLlm solicitando create_task e complete_task
    when: executar task-operator com repositório em memória
    then: conclui a tarefa usando somente suas duas tools e publica os dois eventos
---

## Motivo

Exercitar o fluxo declaração primeiro com um domínio isolado, sem alterar orders nem pressupor testes ou corpos já implementados.
