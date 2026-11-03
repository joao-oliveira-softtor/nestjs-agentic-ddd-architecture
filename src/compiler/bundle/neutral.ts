import type { AcceptanceCriterion } from '../changes/proposal';
import type { Delta } from '../delta/schema';
import { parseType, splitOptional, type TypeExpr } from '../delta/schema';
import { AgenticError } from '../ir';

/** The sentence every neutral text carries (ADR-0007 D12). */
export const NO_CERTIFICATION =
  'This layer has no `done` certification: only the nestjs-ts target layer is certified, so a team implementing from here owns its own verification.';

export interface NeutralField {
  readonly name: string;
  readonly type: string;
  readonly optional: boolean;
}
export interface NeutralExample {
  readonly given: string;
  readonly when: string;
  readonly then: string;
}
export interface NeutralInvariant {
  /** `invariant:<Entity>/<id>`. */
  readonly id: string;
  readonly owner: string;
  readonly method: string | null;
  readonly text: string;
  readonly examples: readonly NeutralExample[];
}
export interface NeutralMethod {
  readonly name: string;
  readonly description: string;
  readonly static: boolean;
  readonly inputs: readonly NeutralField[];
  readonly returns: string;
  readonly emits: readonly string[];
  readonly transition: {
    readonly from: readonly string[];
    readonly to: string;
  } | null;
  readonly invariants: readonly string[];
}
export interface NeutralModel {
  readonly module: string;
  readonly certification: string;
  /** An entity with `existing: true` lists only the members this change adds to it. */
  readonly entities: readonly {
    readonly name: string;
    readonly existing: boolean;
    readonly description: string | null;
    readonly states: readonly string[];
    readonly invariants: readonly string[];
    readonly methods: readonly NeutralMethod[];
  }[];
  readonly valueObjects: readonly {
    readonly name: string;
    readonly description: string;
    readonly fields: readonly NeutralField[];
  }[];
  readonly events: readonly {
    readonly name: string;
    readonly entity: string;
    readonly description: string;
    readonly payload: readonly NeutralField[];
  }[];
  readonly ports: readonly {
    readonly name: string;
    readonly description: string;
    readonly root: string;
    readonly methods: readonly {
      readonly name: string;
      readonly description: string;
      readonly inputs: readonly NeutralField[];
      readonly returns: string;
    }[];
  }[];
  /** A use-case with `existing: true` lists only the `uses` and `emits` this change adds. */
  readonly useCases: readonly {
    readonly name: string;
    readonly existing: boolean;
    readonly description: string | null;
    readonly whenToUse: string | null;
    readonly whenNotToUse: string | null;
    readonly inputs: readonly NeutralField[];
    readonly outputs: readonly NeutralField[];
    readonly uses: readonly string[];
    readonly emits: readonly string[];
    readonly ports: readonly string[];
  }[];
  /** State changes the Delta declares on methods; empty when it declares none (none are inferred). */
  readonly transitions: readonly {
    readonly entity: string;
    readonly method: string;
    readonly from: readonly string[];
    readonly to: string;
  }[];
  readonly invariants: readonly NeutralInvariant[];
  readonly acceptance: readonly AcceptanceCriterion[];
}

export interface NeutralItem {
  readonly id: string;
  readonly layer: string;
  readonly wave: number;
}
export interface NeutralFile {
  readonly path: string;
  readonly content: string;
}
export interface NeutralBuild {
  readonly model: NeutralModel;
  readonly files: readonly NeutralFile[];
  /** Per item, the bundle path of its brief. */
  readonly briefs: readonly { readonly item: string; readonly path: string }[];
}

const PRIMITIVE_NAMES = {
  string: 'text',
  number: 'number',
  boolean: 'boolean',
  Date: 'timestamp',
} as const;

function typeName(expr: TypeExpr): string {
  if (expr.kind === 'primitive') return PRIMITIVE_NAMES[expr.name];
  if (expr.kind === 'array') return `list of ${typeName(expr.of)}`;
  return expr.name;
}

const neutralType = (source: string): string => {
  if (source === 'void') return 'nothing';
  const parsed = parseType(source);
  return parsed ? typeName(parsed) : source;
};

const fields = (
  list: readonly { name: string; type: string }[],
): NeutralField[] =>
  list.map((f) => {
    const { id, optional } = splitOptional(f.name);
    return { name: id, type: neutralType(f.type), optional };
  });

const stripKind = (ref: string): string => ref.replace(/^method:/, '');

const briefName = (id: string): string =>
  `${id.replaceAll(/[^a-zA-Z0-9_]+/g, '-')}.md`;

type DeltaMethod = Delta['entities'][number]['methods'][number];
type DeltaInvariant = Delta['entities'][number]['invariants'][number];

export function neutralModel(
  delta: Delta,
  acceptance: readonly AcceptanceCriterion[],
): NeutralModel {
  const invariants: NeutralInvariant[] = [];
  const transitions: NeutralModel['transitions'][number][] = [];
  const invariantIds = (
    owner: string,
    method: string | null,
    list: readonly DeltaInvariant[] | undefined,
  ): string[] =>
    (list ?? []).map((inv) => {
      const id = `invariant:${owner}/${inv.id}`;
      if (inv.examples.length === 0)
        throw new AgenticError(
          'bundle.delta-invalid',
          `${id} has no given/when/then example`,
        );
      invariants.push({
        id,
        owner,
        method,
        text: inv.text,
        examples: inv.examples.map((e) => ({
          given: e.given,
          when: e.when,
          // eslint-disable-next-line unicorn/no-thenable
          then: e.then,
        })),
      });
      return id;
    });
  const method = (owner: string, m: DeltaMethod): NeutralMethod => {
    if (m.transition)
      transitions.push({
        entity: owner,
        method: m.name,
        from: m.transition.from,
        to: m.transition.to,
      });
    return {
      name: m.name,
      description: m.description,
      static: m.static ?? false,
      inputs: fields(m.params),
      returns: neutralType(m.returns),
      emits: m.emits ?? [],
      transition: m.transition ?? null,
      invariants: invariantIds(owner, m.name, m.invariants),
    };
  };
  const entity = (
    name: string,
    existing: boolean,
    description: string | null,
    states: readonly string[],
    inv: readonly DeltaInvariant[],
    methods: readonly DeltaMethod[],
  ) => ({
    name,
    existing,
    description,
    states,
    // Entity invariants are registered before the methods', so ids list in declaration order.
    invariants: invariantIds(name, null, inv),
    methods: methods.map((m) => method(name, m)),
  });
  const entities = [
    ...(delta.entityAdditions ?? []).map((a) =>
      entity(a.entity, true, null, [], a.invariants, a.methods),
    ),
    ...delta.entities.map((e) =>
      entity(
        e.name,
        false,
        e.description,
        e.states ?? [],
        e.invariants,
        e.methods,
      ),
    ),
  ];
  return {
    module: delta.module,
    certification: NO_CERTIFICATION,
    entities,
    valueObjects: delta.valueObjects.map((v) => ({
      name: v.name,
      description: v.description,
      fields: fields(v.fields),
    })),
    events: delta.events.map((e) => ({
      name: e.name,
      entity: e.entity,
      description: e.description,
      payload: fields(e.payload),
    })),
    ports: delta.ports.map((p) => ({
      name: p.name,
      description: p.description,
      root: p.root,
      methods: p.methods.map((m) => ({
        name: m.name,
        description: m.description,
        inputs: fields(m.params),
        returns: neutralType(m.returns),
      })),
    })),
    useCases: [
      ...(delta.useCaseAdditions ?? []).map((u) => ({
        name: u.useCase,
        existing: true,
        description: null,
        whenToUse: null,
        whenNotToUse: null,
        inputs: [],
        outputs: [],
        uses: u.uses.map(stripKind),
        emits: u.emits,
        ports: [],
      })),
      ...delta.useCases.map((u) => ({
        name: u.name,
        existing: false,
        description: u.description,
        whenToUse: u.whenToUse,
        whenNotToUse: u.whenNotToUse ?? null,
        inputs: fields(u.input),
        outputs: fields(u.output),
        uses: u.uses.map(stripKind),
        emits: u.emits,
        ports: u.ports ?? [],
      })),
    ],
    transitions,
    invariants,
    acceptance,
  };
}

const exampleLines = (invs: readonly NeutralInvariant[]): string[] =>
  invs.flatMap((inv) => [
    '',
    `### ${inv.id}`,
    '',
    inv.text,
    ...inv.examples.flatMap((e, i) => [
      '',
      `Example ${i + 1}`,
      `- Given: ${e.given}`,
      `- When: ${e.when}`,
      `- Then: ${e.then}`,
    ]),
  ]);

const fieldList = (label: string, list: readonly NeutralField[]): string[] =>
  list.length === 0
    ? []
    : [
        `${label}:`,
        ...list.map(
          (f) => `- ${f.name} (${f.optional ? 'optional ' : ''}${f.type})`,
        ),
      ];

function methodLines(m: NeutralMethod): string[] {
  return [
    m.description,
    '',
    ...fieldList('Inputs', m.inputs),
    `Returns: ${m.returns}`,
    ...(m.transition
      ? [
          `State change: from ${m.transition.from.join(' or ')} to ${m.transition.to}`,
        ]
      : []),
    ...(m.emits.length ? [`Announces events: ${m.emits.join(', ')}`] : []),
  ];
}

interface Job {
  readonly lines: string[];
  readonly invariants: NeutralInvariant[];
}

function entityJob(model: NeutralModel, name: string): Job | null {
  const e = model.entities.find((x) => x.name === name);
  if (!e) return null;
  return {
    lines: [
      e.existing
        ? `Extend the existing entity ${e.name} with the members listed in model.json and nothing else.`
        : `Implement the entity ${e.name}: ${e.description ?? ''}`,
      ...(e.states.length ? [`States: ${e.states.join(', ')}`] : []),
      ...(e.methods.length
        ? [
            `Operations: ${e.methods.map((m) => m.name).join(', ')} (each has its own brief)`,
          ]
        : []),
    ],
    invariants: model.invariants.filter(
      (i) => i.owner === name && i.method === null,
    ),
  };
}

function methodJob(model: NeutralModel, path: string): Job | null {
  const [owner = '', name = ''] = path.split('.');
  const m = model.entities
    .find((x) => x.name === owner)
    ?.methods.find((x) => x.name === name);
  if (!m) return null;
  return {
    lines: [`Implement the operation ${name} of ${owner}.`, '', ...methodLines(m)],
    invariants: model.invariants.filter(
      (i) => i.owner === owner && i.method === name,
    ),
  };
}

function useCaseJob(model: NeutralModel, name: string): Job | null {
  const u = model.useCases.find((x) => x.name === name);
  if (!u) return null;
  return {
    lines: [
      u.existing
        ? `Extend the existing use-case ${u.name} with what is listed here.`
        : `Implement the use-case ${u.name}: ${u.description ?? ''}`,
      ...(u.whenToUse ? [`Use it when: ${u.whenToUse}`] : []),
      ...(u.whenNotToUse ? [`Do not use it when: ${u.whenNotToUse}`] : []),
      ...fieldList('Inputs', u.inputs),
      ...fieldList('Outputs', u.outputs),
      ...(u.uses.length ? [`Calls operations: ${u.uses.join(', ')}`] : []),
      ...(u.ports.length ? [`Needs ports: ${u.ports.join(', ')}`] : []),
      ...(u.emits.length ? [`Announces events: ${u.emits.join(', ')}`] : []),
    ],
    invariants: [],
  };
}

function jobOf(id: string, model: NeutralModel): Job {
  const [kind = '', path = ''] = id.split(/:(.*)/s);
  const found =
    kind === 'entity'
      ? entityJob(model, path)
      : kind === 'method'
        ? methodJob(model, path)
        : kind === 'usecase'
          ? useCaseJob(model, path)
          : null;
  if (found) return found;
  const described: readonly { name: string; description: string }[] =
    kind === 'event'
      ? model.events
      : kind === 'port'
        ? model.ports
        : model.valueObjects;
  const simple = described.find((x) => x.name === path);
  return {
    lines: [
      simple
        ? `Implement ${kind} ${simple.name}: ${simple.description} Its full shape is in model.json.`
        : `Implement the element ${id} as described in model.json.`,
    ],
    invariants: [],
  };
}

export function neutralBrief(item: NeutralItem, model: NeutralModel): string {
  const job = jobOf(item.id, model);
  return [
    `# Brief: ${item.id}`,
    '',
    `Wave ${item.wave}, ${item.layer} layer. Finish every item of an earlier wave first.`,
    '',
    '## Job',
    '',
    ...job.lines,
    ...(job.invariants.length
      ? ['', '## Business rules and examples', ...exampleLines(job.invariants)]
      : []),
    '',
    '## Rules',
    '',
    '- model.json, one folder up, is the full specification; this brief is the slice for one item.',
    '- Use your own language, layout and test tools. Keep invariant ids and business text exactly as written.',
    `- ${NO_CERTIFICATION}`,
    '',
  ].join('\n');
}

const README = [
  '# Neutral layer',
  '',
  'The change described without any programming language, for a team that does not use the nestjs-ts target.',
  '',
  '- `model.json`: new and extended entities, value objects, events, ports and use-cases; state transitions (an empty list means the Delta declares none); every invariant with its stable id, text and given/when/then examples; the acceptance criteria of the proposal, if there is one.',
  '- `briefs/`: one brief per item, in wave order.',
  '',
  NO_CERTIFICATION,
  '',
].join('\n');

export function buildNeutral(input: {
  readonly delta: Delta;
  readonly acceptance: readonly AcceptanceCriterion[];
  readonly items: readonly NeutralItem[];
}): NeutralBuild {
  const model = neutralModel(input.delta, input.acceptance);
  const briefs = input.items.map((item) => ({
    item: item.id,
    path: `neutral/briefs/${briefName(item.id)}`,
  }));
  return {
    model,
    briefs,
    files: [
      { path: 'neutral/README.md', content: README },
      {
        path: 'neutral/model.json',
        content: `${JSON.stringify(model, null, 2)}\n`,
      },
      ...input.items.map((item, i) => ({
        path: briefs[i]!.path,
        content: neutralBrief(item, model),
      })),
    ],
  };
}
