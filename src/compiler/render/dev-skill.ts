import { stableStringify } from '../canonical';
import { workItems } from '../graph';
import type { IR, IRModule } from '../ir';
import { GENERATED_HEADER, frontmatter } from './frontmatter';
import { code, guardedBy, idList, stripKind, table } from './markdown';
import { renderStateMachine } from './state-machine';

export function renderDevSkill(
  ir: IR,
  module: IRModule,
  hash: string,
): Map<string, string> {
  const inModule = <T extends { readonly module: string }>(
    xs: readonly T[],
  ): T[] => xs.filter((x) => x.module === module.name);
  const entities = inModule(ir.entities);
  const events = inModule(ir.events);
  const useCases = inModule(ir.useCases);
  const operators = inModule(ir.operators);
  const items = inModule(workItems(ir));

  const summaryWithNames =
    [
      entities.length > 0
        ? `entidades ${entities.map((e) => e.name).join(', ')}`
        : null,
      useCases.length > 0
        ? `use-cases ${useCases.map((u) => u.name).join(', ')}`
        : null,
      operators.length > 0
        ? `operators ${operators.map((o) => o.name).join(', ')}`
        : null,
    ]
      .filter((part): part is string => part !== null)
      .join('; ') || 'sem elementos declarados';

  const descriptionWithNames = `Domínio ${module.name}: ${summaryWithNames}. Use quando for implementar, alterar, testar ou revisar código em ${module.path}.`;

  let description: string;
  if (descriptionWithNames.length > 1024) {
    // Use count-based form
    const parts = [
      entities.length > 0 ? `${entities.length} entidades` : null,
      useCases.length > 0 ? `${useCases.length} use-cases` : null,
      operators.length > 0 ? `${operators.length} operators` : null,
    ]
      .filter((part): part is string => part !== null)
      .join(', ');

    description = `Domínio ${module.name}: ${parts || 'sem elementos declarados'}. Use quando for implementar, alterar, testar ou revisar código em ${module.path}.`;
  } else {
    description = descriptionWithNames;
  }

  const lines: string[] = [
    frontmatter({
      name: `${module.name}-dev`,
      description,
      audience: 'dev',
      irHash: hash,
    }),
    GENERATED_HEADER(module.path),
    '',
    `# Módulo ${code(module.name)}`,
    '',
    `Código em ${code(module.path)}. Esta skill descreve o domínio declarado (requisitos, regras e contratos); ela não registra estado de implementação.`,
    '',
  ];

  if (entities.length > 0) {
    lines.push('## Entidades', '');
    for (const entity of entities) {
      lines.push(
        `### ${entity.name} — ${code(entity.id)}`,
        '',
        entity.description,
        '',
        `Fonte: ${code(entity.source)} · Estados: ${entity.states.length > 0 ? entity.states.map(code).join(', ') : '—'}`,
        '',
      );
      if (entity.invariants.length > 0) {
        const rows = entity.invariants.map((i) => [
          code(i.id),
          i.text,
          guardedBy(i.on),
          code(i.source),
        ]);
        lines.push(
          table(['Invariante', 'Regra', 'Garantida por', 'Fonte'], rows),
          '',
        );
      }
      if (entity.methods.length > 0) {
        const rows = entity.methods.map((m) => [
          code(stripKind(m.id)),
          m.description,
          m.transition
            ? `${m.transition.from.map(code).join(', ')} → ${code(m.transition.to)}`
            : '—',
          idList(m.emits),
          code(m.source),
        ]);
        lines.push(
          table(['Método', 'Descrição', 'Transição', 'Emite', 'Fonte'], rows),
          '',
        );
      }
    }
  }

  if (events.length > 0) {
    lines.push(
      '## Eventos',
      '',
      table(
        ['Evento', 'Descrição', 'Fonte'],
        events.map((e) => [code(e.name), e.description, code(e.source)]),
      ),
      '',
    );
  }

  if (useCases.length > 0) {
    const rows = useCases.map((u) => [
      code(u.name),
      u.description,
      idList(u.uses),
      idList(u.emits),
      code(u.source),
    ]);
    lines.push(
      '## Use-cases',
      '',
      table(['Use-case', 'Descrição', 'Aciona', 'Emite', 'Fonte'], rows),
      '',
    );
  }

  if (operators.length > 0) {
    const rows = operators.map((o) => [
      code(o.name),
      idList(o.useCases),
      idList(o.requiresApproval),
      code(o.source),
    ]);
    lines.push(
      '## Operators',
      '',
      table(['Operator', 'Use-cases', 'Exige aprovação', 'Fonte'], rows),
      '',
    );
  }

  if (items.length > 0) {
    const dependencies = items.map((i) => [
      code(i.id),
      i.layer,
      i.dependsOn.length > 0 ? i.dependsOn.map(code).join(', ') : '—',
    ]);
    lines.push(
      '## Dependências entre itens',
      '',
      table(['Item', 'Camada', 'Depende de'], dependencies),
      '',
    );
    const obligations = items.map((i) => [
      code(i.id),
      i.obligations.map(code).join(', '),
    ]);
    lines.push(
      '## Obrigações de teste',
      '',
      'Cada ID abaixo precisa de ao menos um teste nomeado com `covers([...ids], título)` de `@agentic-ddd/testing`.',
      '',
      table(['Item', 'IDs a cobrir'], obligations),
      '',
    );
  }

  lines.push(
    '## Como estender',
    '',
    table(
      ['Artefato', 'Onde criar', 'Como declarar'],
      [
        [
          'Entidade',
          code(`${module.path}/domain/<nome>.ts`),
          '`@AgentEntity({ description, states })` + `@Invariant({ id, text })` na classe',
        ],
        [
          'Método de entidade',
          'na classe da entidade',
          '`@AgentMethod({ description, transition?, emits? })`; regra garantida pelo método: `@Invariant` no método; auxiliares: `#privado`',
        ],
        [
          'Evento',
          code(`${module.path}/domain/<agregado>.events.ts`),
          '`@AgentEvent({ description, payload })` estendendo `DomainEvent`',
        ],
        [
          'Use-case',
          code(`${module.path}/application/<nome>.ts`),
          "`@AgentUseCase({ name, description, whenToUse, input, output, uses: ['method:<Entidade>.<método>'], emits? })`",
        ],
        [
          'Operator',
          code(`${module.path}/operators/<nome>.operator.ts`),
          '`@Operator({ name, description, instructions, useCases, requiresApproval? })`',
        ],
      ],
    ),
    '',
    'Corpo declarado e ainda não implementado usa `notImplemented()` de `@agentic-ddd/core`.',
    '',
    '## Referências',
    '',
    '- [Schemas de eventos e use-cases](references/schemas.json)',
    '- [Máquina de estados](references/state-machine.md)',
    '',
  );

  const schemas = {
    events: Object.fromEntries(events.map((e) => [e.name, e.payloadSchema])),
    useCases: Object.fromEntries(
      useCases.map((u) => [
        u.name,
        { input: u.inputSchema, output: u.outputSchema },
      ]),
    ),
  };
  return new Map([
    ['SKILL.md', lines.join('\n')],
    ['references/schemas.json', stableStringify(schemas)],
    ['references/state-machine.md', renderStateMachine(entities, module.path)],
  ]);
}
