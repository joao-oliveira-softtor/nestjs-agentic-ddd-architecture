---
id: "0001"
title: Matricular aluno em turma
status: proposed
origin: proposal-first
delta:
  added:
    - "valueobject:AlunoId"
    - "valueobject:TurmaId"
    - "invariant:AlunoId/aluno-id-nao-vazio"
    - "invariant:TurmaId/turma-id-nao-vazio"
    - "entity:Aluno"
    - "entity:Turma"
    - "entity:Matricula"
    - "invariant:Aluno/nome-obrigatorio"
    - "invariant:Turma/vagas-positivas"
    - "invariant:Matricula/guarda-ids"
    - "method:Aluno.criar"
    - "method:Turma.criar"
    - "method:Matricula.criar"
    - "port:MatriculaRepository"
    - "port:AlunoRepository"
    - "port:TurmaRepository"
    - "usecase:matricular_aluno"
    - "invariant:matricular_aluno/aluno-ativo"
    - "invariant:matricular_aluno/turma-com-vaga"
    - "adapter:InMemoryMatriculaRepository"
  modified: []
  removed: []
acceptance:
  - id: ids-invalidos
    covers: ["invariant:AlunoId/aluno-id-nao-vazio", "invariant:TurmaId/turma-id-nao-vazio"]
    given: um valor vazio
    when: criar AlunoId ou TurmaId
    then: rejeita com ALUNO_ID_VAZIO ou TURMA_ID_VAZIO; ids com o mesmo valor são iguais
  - id: aluno-e-turma
    covers: ["invariant:Aluno/nome-obrigatorio", "invariant:Turma/vagas-positivas"]
    given: nome vazio ou turma com menos de 1 vaga
    when: criar Aluno ou Turma
    then: rejeita com ALUNO_NOME_OBRIGATORIO ou TURMA_VAGAS_INVALIDAS
  - id: matricula-guarda-ids
    covers: ["invariant:Matricula/guarda-ids"]
    given: um aluno e uma turma
    when: criar a matrícula
    then: expõe alunoId e turmaId e não guarda as entidades
  - id: aluno-inativo
    covers: ["invariant:matricular_aluno/aluno-ativo"]
    given: um aluno inativo
    when: executar matricular_aluno
    then: rejeita com ALUNO_INATIVO e não salva
  - id: turma-cheia
    covers: ["invariant:matricular_aluno/turma-com-vaga"]
    given: uma turma com as vagas já ocupadas segundo contarPorTurma
    when: executar matricular_aluno
    then: rejeita com TURMA_CHEIA; com vaga, salva uma única matrícula e não altera a Turma
  - id: contagem-por-turma
    covers: ["adapter:InMemoryMatriculaRepository"]
    given: matrículas de turmas diferentes salvas
    when: contarPorTurma de uma turma
    then: conta somente as matrículas daquela turma
---

## Motivo

Exercitar o framework com regras entre agregados e armadilhas conhecidas. A vaga é conferida no use-case contando matrículas (`contarPorTurma`); a `Turma` não é mutada e um único agregado (a `Matricula`) é criado por transação.

Corrida conhecida: a conferência de vaga não é transacional, então duas matrículas simultâneas podem passar ao mesmo tempo. Fica documentada; a solução real (bloqueio ou reserva na `Turma`) cabe a cada domínio.
