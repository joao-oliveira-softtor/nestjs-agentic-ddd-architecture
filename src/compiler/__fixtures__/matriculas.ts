import { AggregateRoot, ValueObject } from '@agentic-ddd/core';
import {
  AgentEntity,
  AgentValueObject,
  createRegistry,
  withRegistry,
  type Registry,
} from '@agentic-ddd/decorators';

export const ENROLLMENT_MODULE = {
  name: 'matriculas',
  path: 'src/compiler/__fixtures__',
} as const;

export function defineEnrollment(): Registry {
  const registry = createRegistry();
  withRegistry(registry, () => {
    @AgentValueObject({ description: 'Identificador de aluno.' })
    class AlunoId extends ValueObject<{ valor: string }> {}

    @AgentValueObject({ description: 'Identificador de turma.' })
    class TurmaId extends ValueObject<{ valor: string }> {}

    @AgentEntity({ description: 'Aluno da escola.' })
    class Aluno extends AggregateRoot<string> {}

    @AgentEntity({
      description: 'Turma da escola.',
      references: () => [Matricula],
    })
    class Turma extends AggregateRoot<string> {}

    @AgentEntity({
      description: 'Matrícula de um aluno em uma turma.',
      contains: () => [AlunoId, TurmaId],
      references: () => [Aluno, Turma],
    })
    class Matricula extends AggregateRoot<string> {}

    void Aluno;
    void Turma;
    void Matricula;
  });
  return registry;
}
