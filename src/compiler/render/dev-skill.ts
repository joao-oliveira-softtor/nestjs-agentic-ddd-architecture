import { stableStringify } from '../canonical';
import { workItems } from '../graph';
import { DEFAULT_CONVENTIONS, type ResolvedConventions } from '../conventions';
import type { IR, IRModule } from '../ir';
import type { LockChange } from '../lock';
import { rulesFor, ruleHash, type Rule } from '../rules';
import { GENERATED_HEADER, frontmatter } from './frontmatter';
import { renderHistory } from './history';
import { code, guardedBy, idList, stripKind, table } from './markdown';
import { renderStateMachine } from './state-machine';

export function renderDevSkill(
  ir: IR,
  module: IRModule,
  hash: string,
  options: {
    readonly history?: readonly LockChange[];
    readonly devSkillsDir?: string;
    readonly rules?: readonly Rule[];
    readonly conventions?: ResolvedConventions;
  } = {},
): Map<string, string> {
  const { layers, suffixes } = options.conventions ?? DEFAULT_CONVENTIONS;
  const inModule = <T extends { readonly module: string }>(
    xs: readonly T[],
  ): T[] => xs.filter((x) => x.module === module.name);
  const entities = inModule(ir.entities);
  const valueObjects = inModule(ir.valueObjects ?? []);
  const events = inModule(ir.events);
  const useCases = inModule(ir.useCases);
  const operators = inModule(ir.operators);
  const items = inModule(workItems(ir));

  const summaryWithNames =
    [
      entities.length > 0
        ? `entities ${entities.map((e) => e.name).join(', ')}`
        : null,
      valueObjects.length > 0
        ? `value objects ${valueObjects.map((v) => v.name).join(', ')}`
        : null,
      useCases.length > 0
        ? `use-cases ${useCases.map((u) => u.name).join(', ')}`
        : null,
      operators.length > 0
        ? `operators ${operators.map((o) => o.name).join(', ')}`
        : null,
    ]
      .filter((part): part is string => part !== null)
      .join('; ') || 'no declared elements';

  const descriptionWithNames = `Domain ${module.name}: ${summaryWithNames}. Use when implementing, changing, testing or reviewing code in ${module.path}.`;

  let description: string;
  if (descriptionWithNames.length > 1024) {
    // Use count-based form
    const parts = [
      entities.length > 0 ? `${entities.length} entities` : null,
      valueObjects.length > 0 ? `${valueObjects.length} value objects` : null,
      useCases.length > 0 ? `${useCases.length} use-cases` : null,
      operators.length > 0 ? `${operators.length} operators` : null,
    ]
      .filter((part): part is string => part !== null)
      .join(', ');

    description = `Domain ${module.name}: ${parts || 'no declared elements'}. Use when implementing, changing, testing or reviewing code in ${module.path}.`;
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
    `# Module ${code(module.name)}`,
    '',
    `Code in ${code(module.path)}. This skill describes the declared domain (requirements, rules and contracts); it does not record implementation state.`,
    '',
  ];

  if (entities.length > 0) {
    lines.push('## Entities', '');
    for (const entity of entities) {
      lines.push(
        `### ${entity.name} — ${code(entity.id)}`,
        '',
        entity.description,
        '',
        `Source: ${code(entity.source)} · States: ${entity.states.length > 0 ? entity.states.map(code).join(', ') : '—'}`,
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
          table(['Invariant', 'Rule', 'Guaranteed by', 'Source'], rows),
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
          table(
            ['Method', 'Description', 'Transition', 'Emits', 'Source'],
            rows,
          ),
          '',
        );
      }
    }
  }

  if (valueObjects.length > 0) {
    lines.push('## Value objects', '');
    for (const vo of valueObjects) {
      lines.push(
        `### ${vo.name} — ${code(vo.id)}`,
        '',
        vo.description,
        '',
        `Source: ${code(vo.source)}`,
        '',
      );
      if (vo.invariants.length > 0) {
        const rows = vo.invariants.map((i) => [
          code(i.id),
          i.text,
          code(i.source),
        ]);
        lines.push(table(['Invariant', 'Rule', 'Source'], rows), '');
      }
    }
  }

  if (events.length > 0) {
    lines.push(
      '## Events',
      '',
      table(
        ['Event', 'Description', 'Source'],
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
      table(['Use-case', 'Description', 'Triggers', 'Emits', 'Source'], rows),
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
      table(['Operator', 'Use-cases', 'Requires approval', 'Source'], rows),
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
      '## Dependencies between items',
      '',
      table(['Item', 'Layer', 'Depends on'], dependencies),
      '',
    );
    const obligations = items.map((i) => [
      code(i.id),
      i.obligations.map(code).join(', '),
    ]);
    lines.push(
      '## Test obligations',
      '',
      'Each ID below needs at least one test named with `covers([...ids], title)` from `@agentic-ddd/testing`.',
      '',
      table(['Item', 'IDs to cover'], obligations),
      '',
    );
  }

  const sources = items.map((i) => i.source.replace(/:\d+$/, ''));
  const teamRules = rulesFor(
    (options.rules ?? []).filter((r) => r.paths !== null),
    sources,
  );
  const rulesSection =
    teamRules.length > 0
      ? [
          '## Team rules',
          '',
          table(
            ['File', 'Globs', 'sha256'],
            teamRules.map((r) => [
              code(r.file!),
              r.paths!.map(code).join(', '),
              code(ruleHash(r)),
            ]),
          ),
          '',
        ]
      : [];

  lines.push(
    '## How to extend',
    '',
    table(
      ['Artifact', 'Where to create', 'How to declare'],
      [
        [
          'Entity',
          code(`${module.path}/${layers.domain}/<name>.ts`),
          '`@AgentEntity({ description, states })` + `@Invariant({ id, text })` on the class',
        ],
        [
          'Entity method',
          'in the entity class',
          '`@AgentMethod({ description, transition?, emits? })`; rule guaranteed by the method: `@Invariant` on the method; helpers: `#private`',
        ],
        [
          'Event',
          code(`${module.path}/${layers.domain}/<aggregate>${suffixes.events}`),
          '`@AgentEvent({ description, payload })` extending `DomainEvent`',
        ],
        [
          'Use-case',
          code(`${module.path}/${layers.application}/<name>.ts`),
          "`@AgentUseCase({ name, description, whenToUse, input, output, uses: ['method:<Entity>.<method>'], emits? })`",
        ],
        [
          'Operator',
          code(`${module.path}/${layers.operators}/<name>${suffixes.operator}`),
          '`@Operator({ name, description, instructions, useCases, requiresApproval? })`',
        ],
      ],
    ),
    '',
    'A declared body that is not yet implemented uses `notImplemented()` from `@agentic-ddd/core`.',
    '',
    ...rulesSection,
    '## References',
    '',
    '- [Change history](references/history.md)',
    '- [Event and use-case schemas](references/schemas.json)',
    '- [State machine](references/state-machine.md)',
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
  const historyPath = `${options.devSkillsDir ?? '.agents/skills'}/${module.name}-dev/references/history.md`;
  return new Map([
    ['SKILL.md', lines.join('\n')],
    [
      'references/history.md',
      renderHistory(ir, module, options.history ?? [], historyPath),
    ],
    ['references/schemas.json', stableStringify(schemas)],
    ['references/state-machine.md', renderStateMachine(entities, module.path)],
  ]);
}
