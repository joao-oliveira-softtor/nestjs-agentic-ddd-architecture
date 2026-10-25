export interface TutorialItem {
  readonly id: string;
  readonly file: string | null;
  readonly className: string | null;
  readonly method: string | null;
  readonly test: string;
  readonly criteria: readonly string[];
}
export const TASK_ITEMS = [
  {
    id: 'entity:Task',
    file: 'app/domain/task.ts',
    className: 'Task',
    method: 'create',
    test: 'app/test/entity-Task.test.ts',
    criteria: ['titulo-invalido', 'criacao'],
  },
  {
    id: 'method:Task.complete',
    file: 'app/domain/task.ts',
    className: 'Task',
    method: 'complete',
    test: 'app/test/method-Task-complete.test.ts',
    criteria: ['conclusao'],
  },
  {
    id: 'usecase:create_task',
    file: 'app/application/create-task.ts',
    className: 'CreateTask',
    method: 'execute',
    test: 'app/test/usecase-create_task.test.ts',
    criteria: ['persistencia-criacao'],
  },
  {
    id: 'usecase:complete_task',
    file: 'app/application/complete-task.ts',
    className: 'CompleteTask',
    method: 'execute',
    test: 'app/test/usecase-complete_task.test.ts',
    criteria: ['persistencia-conclusao'],
  },
  {
    id: 'operator:task-operator',
    file: null,
    className: null,
    method: null,
    test: 'app/test/operator-task-operator.test.ts',
    criteria: ['tools'],
  },
] as const;

/** Private oracle test names per item, as a multiset: each template loops over two ids. */
export const ORACLE_CASES: Readonly<Record<string, readonly string[]>> = {
  'entity:Task': [
    'cria tarefa normalizada e registra evento',
    'cria tarefa normalizada e registra evento',
    'rejeita título vazio ou só espaços',
    'rejeita título vazio ou só espaços',
  ],
  'method:Task.complete': Array(2).fill('conclui, emite e rejeita repetição'),
  'usecase:create_task': Array(2).fill('persiste, publica e rejeita duplicado'),
  'usecase:complete_task': Array(2).fill(
    'conclui, persiste, publica e rejeita id ausente',
  ),
  'operator:task-operator': Array(2).fill(
    'operator executa tools reais e publica eventos',
  ),
};

const matriculaItem = (
  id: string,
  file: string,
  className: string,
  method: string | null,
  criteria: readonly string[],
): TutorialItem => ({
  id,
  file: `app/${file}`,
  className,
  method,
  test: `app/test/${id.replaceAll(/[:.]/g, '-')}.test.ts`,
  criteria,
});
/** Na ordem das ondas do `matriculas`. */
const MATRICULAS_ITEMS: readonly TutorialItem[] = [
  matriculaItem(
    'valueobject:AlunoId',
    'domain/aluno-id.ts',
    'AlunoId',
    'criar',
    ['ids-invalidos'],
  ),
  matriculaItem(
    'valueobject:TurmaId',
    'domain/turma-id.ts',
    'TurmaId',
    'criar',
    ['ids-invalidos'],
  ),
  matriculaItem('entity:Aluno', 'domain/aluno.ts', 'Aluno', 'criar', [
    'aluno-e-turma',
  ]),
  matriculaItem('entity:Turma', 'domain/turma.ts', 'Turma', 'criar', [
    'aluno-e-turma',
  ]),
  matriculaItem(
    'entity:Matricula',
    'domain/matricula.ts',
    'Matricula',
    'criar',
    ['matricula-guarda-ids'],
  ),
  matriculaItem(
    'usecase:matricular_aluno',
    'application/matricular-aluno.ts',
    'MatricularAluno',
    'execute',
    ['aluno-inativo', 'turma-cheia'],
  ),
  matriculaItem(
    'adapter:InMemoryMatriculaRepository',
    'infrastructure/in-memory-matricula.repository.ts',
    'InMemoryMatriculaRepository',
    null,
    [],
  ),
];
const MATRICULAS_ORACLE_CASES: Readonly<Record<string, readonly string[]>> = {
  'valueobject:AlunoId': [
    'trap:C AlunoId rejeita valor vazio com ALUNO_ID_VAZIO',
    'trap:C AlunoId compara por valor',
    'base:AlunoId guarda o valor',
  ],
  'valueobject:TurmaId': [
    'trap:C TurmaId rejeita valor vazio com TURMA_ID_VAZIO',
    'trap:C TurmaId compara por valor',
    'base:TurmaId guarda o valor',
  ],
  'entity:Aluno': [
    'base:Aluno cria com nome sem espaços nas extremidades e o status informado',
    'base:Aluno rejeita nome vazio com ALUNO_NOME_OBRIGATORIO',
  ],
  'entity:Turma': [
    'base:Turma cria com as vagas informadas',
    'base:Turma rejeita menos de uma vaga com TURMA_VAGAS_INVALIDAS',
  ],
  'entity:Matricula': [
    'base:Matricula expõe alunoId e turmaId',
    'trap:A Matricula guarda só os ids, nunca as entidades inteiras',
  ],
  'usecase:matricular_aluno': [
    'base:matricular_aluno salva uma única matrícula com os ids e devolve o id dela',
    'base:matricular_aluno falha com ALUNO_NAO_ENCONTRADO e TURMA_NAO_ENCONTRADA',
    'trap:B matricular_aluno recusa aluno inativo com ALUNO_INATIVO e não salva',
    'trap:B matricular_aluno recusa turma cheia (contarPorTurma >= vagas) com TURMA_CHEIA',
    'trap:B matricular_aluno aceita a última vaga e não altera a Turma',
  ],
  'adapter:InMemoryMatriculaRepository': [
    'base:InMemoryMatriculaRepository conta zero sem matrículas e conta as gravadas',
    'trap:D InMemoryMatriculaRepository.contarPorTurma conta só as matrículas daquela turma',
  ],
};

export type Benchmark = 'tasks' | 'matriculas';
export interface Tutorial {
  readonly items: readonly TutorialItem[];
  readonly oracleCases: Readonly<Record<string, readonly string[]>>;
  /** Relativo à raiz do repositório. */
  readonly referenceDir: string;
  readonly changeSlug: string;
  /** Cada item parte do esqueleto com as soluções dos colaboradores. */
  readonly seedDependencies: boolean;
}
export const TUTORIALS: Record<Benchmark, Tutorial> = {
  tasks: {
    items: TASK_ITEMS,
    oracleCases: ORACLE_CASES,
    referenceDir: 'evals/implementation/tasks/reference',
    changeSlug: '0001-tasks',
    seedDependencies: false,
  },
  matriculas: {
    items: MATRICULAS_ITEMS,
    oracleCases: MATRICULAS_ORACLE_CASES,
    referenceDir: 'evals/implementation/matriculas/reference',
    changeSlug: '0001-matriculas',
    seedDependencies: true,
  },
};
/** Item pelo id em qualquer tutorial (os ids não se repetem entre eles). */
export const findItem = (id: string): TutorialItem | undefined =>
  Object.values(TUTORIALS)
    .flatMap((t) => t.items)
    .find((i) => i.id === id);

/** Trecho do `agentic ir` que importa para achar colaboradores. */
export interface IrView {
  entities?: { id: string; references?: string[] }[];
  useCases?: { id: string; ports?: string[] }[];
  adapters?: { id: string; implements: string }[];
  ports?: { id: string; root: string }[];
}
/**
 * Fecho transitivo de `dependsOn` ∪ `references` ∪ raízes dos ports do use-case ∪ raiz do
 * port do adapter: o que o item usa sem que o grafo registre aresta (D4).
 */
export function collaborators(
  id: string,
  dependsOn: Readonly<Record<string, readonly string[]>>,
  ir: IrView,
): string[] {
  const root = (port: string) => ir.ports?.find((p) => p.id === port)?.root;
  const direct = (item: string): string[] =>
    [
      ...(dependsOn[item] ?? []),
      ...(ir.entities?.find((e) => e.id === item)?.references ?? []),
      ...(ir.useCases?.find((u) => u.id === item)?.ports ?? []).map(root),
      ...[ir.adapters?.find((a) => a.id === item)?.implements].map((p) =>
        p ? root(p) : undefined,
      ),
    ].filter((x): x is string => !!x);
  const seen = new Set<string>();
  const queue = direct(id);
  for (let next; (next = queue.pop());)
    if (next !== id && !seen.has(next)) {
      seen.add(next);
      queue.push(...direct(next));
    }
  return [...seen].sort();
}
