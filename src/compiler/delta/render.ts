import { posix } from 'node:path';
import type { ResolvedConventions } from '../conventions';
import type { IR } from '../ir';
import { RENDERER_IMPORTS } from './names';
import type { Fragment, FragmentImport } from './splice';
import {
  compareErrors,
  compareText,
  kebab,
  lcFirst,
  orEmpty,
  parseType,
  pascalOfSnake,
  splitOptional,
  validateDelta,
  type Delta,
  type DeltaError,
  type TypeExpr,
} from './schema';

export interface RenderedFile {
  /** Relative to the module root, forward slashes. */
  readonly path: string;
  readonly content: string;
}

/** A given/when/then acceptance example of a new invariant, for the neutral layer (not TypeScript). */
export interface RenderedExample {
  /** `invariant:<Entity>/<id>`. */
  readonly invariant: string;
  readonly given: string;
  readonly when: string;
  readonly then: string;
}

export type RenderResult =
  | {
      readonly ok: true;
      /** New files; never an existing one. */
      readonly files: RenderedFile[];
      /** Additions to existing files, for `splice`; sorted by path. */
      readonly fragments: Fragment[];
      readonly examples: RenderedExample[];
    }
  | { readonly ok: false; readonly errors: DeltaError[] };

export interface RenderOptions {
  readonly conventions: ResolvedConventions;
  readonly base?: IR | null;
  /**
   * REQUIRED. Module-relative paths of every file already in the module (decorated or not),
   * supplied by the caller. A rendered path equal to one of them, ignoring case, is refused as
   * `delta.path-collision`: the renderer never overwrites.
   */
  readonly existingFiles: readonly string[];
}

/**
 * The single door for client text (ADR-0007 D9): a single-quoted JS string literal. Backslash and
 * both quotes are escaped, `${` and the backtick are broken up, and every control, line-separator,
 * bidi, surrogate-half or invisible character becomes a \uXXXX escape. Other characters pass through.
 */
export function literal(s: string): string {
  return `'${s.replace(UNSAFE, (ch) => ESCAPES[ch] ?? escapeUnits(ch))}'`;
}

// Specials, any control, format, line or paragraph separator, and (with the u flag) lone surrogates.
const UNSAFE = /[\\'"`\p{Cc}\p{Cf}\p{Zl}\p{Zp}\ud800-\udfff]|\$(?=\{)/gu;
const ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  "'": "\\'",
  '"': '\\"',
  '`': '\\x60',
  $: '\\x24',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};
// One \uXXXX per UTF-16 code unit, so an astral format character becomes its surrogate pair.
const escapeUnits = (ch: string): string =>
  Array.from({ length: ch.length }, (_, i) => unicode(ch.charCodeAt(i))).join(
    '',
  );

const unicode = (c: number): string => `\\u${c.toString(16).padStart(4, '0')}`;

/** Items with their input index, by name, so errors keep pointing at the caller's array. */
function ordered<T extends { name: string }>(
  items: readonly T[],
): { item: T; i: number }[];
function ordered<T>(
  items: readonly T[],
  by: keyof T & string,
): { item: T; i: number }[];
function ordered<T>(
  items: readonly T[],
  by = 'name',
): { item: T; i: number }[] {
  const keyOf = (t: T): string => (t as Record<string, string>)[by]!;
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => cmp(keyOf(a.item), keyOf(b.item)) || a.i - b.i);
}
const cmp = compareText;
const sortedImports = (imports: Imports): FragmentImport[] =>
  imports
    .entries()
    .sort((a, b) => cmp(a.spec, b.spec) || cmp(a.name, b.name));
const sorted = (list: readonly string[] | undefined): string[] =>
  [...(list ?? [])].sort(cmp);
const camelOfSnake = (s: string): string => lcFirst(pascalOfSnake(s));
const list = (items: readonly string[]): string => `[${items.join(', ')}]`;

/** One file's imports: specifier -> names (true = type-only). */
class Imports {
  readonly #specs = new Map<string, Map<string, boolean>>();

  add(spec: string, name: string, typeOnly = false): void {
    // Only names the schema reserves may be imported from a fixed module, so they cannot drift.
    const fixed = (RENDERER_IMPORTS as Record<string, readonly string[]>)[spec];
    if (!spec.startsWith('.') && !fixed?.includes(name))
      throw new Error(
        `renderer imports ${name} from ${spec} without declaring it`,
      );
    const names = this.#specs.get(spec) ?? new Map<string, boolean>();
    names.set(name, (names.get(name) ?? true) && typeOnly);
    this.#specs.set(spec, names);
  }

  entries(): FragmentImport[] {
    return [...this.#specs.entries()].flatMap(([spec, names]) =>
      [...names.entries()].map(([name, typeOnly]) => ({ spec, name, typeOnly })),
    );
  }

  render(): string {
    const rank = (spec: string): number => (spec.startsWith('.') ? 1 : 0);
    return [...this.#specs.keys()]
      .sort((a, b) => rank(a) - rank(b) || cmp(a, b))
      .map((spec) => {
        const names = [...this.#specs.get(spec)!.entries()]
          .sort(([a], [b]) => cmp(a, b))
          .map(([n, typeOnly]) => (typeOnly ? `type ${n}` : n));
        return `import { ${names.join(', ')} } from ${literal(spec)};`;
      })
      .join('\n');
  }
}

/** `name: z.T()` or `name: z.T().optional()`; the type text was validated, so it parses. */
const zodField = (f: { name: string; type: string }): string => {
  const { id, optional } = splitOptional(f.name);
  const schema = zodOf(parseType(f.type)!);
  return `${id}: ${optional ? `${schema}.optional()` : schema}`;
};

/** `name?: T` or `name: T`. */
const tsField = (f: { name: string; type: string }): string => {
  const { id, optional } = splitOptional(f.name);
  return `${id}${optional ? '?' : ''}: ${f.type}`;
};

function zodOf(t: TypeExpr): string {
  if (t.kind === 'array') return `z.array(${zodOf(t.of)})`;
  if (t.kind === 'ref') return 'z.unknown()';
  // JSON Schema cannot represent a Date, so schemas carry it as an ISO string.
  return t.name === 'Date' ? 'z.iso.datetime()' : `z.${t.name}()`;
}

const zodObject = (
  fields: readonly { name: string; type: string }[],
): string =>
  fields.length === 0
    ? 'z.object({})'
    : `z.object({\n${[...fields]
        .sort((a, b) => cmp(a.name, b.name))
        .map((f) => `  ${zodField(f)},`)
        .join('\n')}\n})`;

const leafRef = (source: string): string | null => {
  let t = parseType(source);
  while (t?.kind === 'array') t = t.of;
  return t?.kind === 'ref' ? t.name : null;
};

const invariantDecorators = (
  invariants: readonly { id: string; text: string }[] | undefined,
  indent: string,
): string[] =>
  [...(invariants ?? [])]
    .sort((a, b) => cmp(a.id, b.id))
    .map(
      (i) =>
        `${indent}@Invariant({\n${indent}  id: ${literal(i.id)},\n${indent}  text: ${literal(i.text)},\n${indent}})`,
    );

type EntityDecl = Delta['entities'][number];
type EntityMethodDecl = EntityDecl['methods'][number];
type InvariantDecl = EntityDecl['invariants'][number];
type EntityAdditionDecl = NonNullable<Delta['entityAdditions']>[number];
type UseCaseAdditionDecl = NonNullable<Delta['useCaseAdditions']>[number];
type EventDecl = Delta['events'][number];
type UseCaseDecl = Delta['useCases'][number];
type Layers = ResolvedConventions['layers'];

/** The path of a decorated base file relative to its module root, or null when it is outside. */
function moduleRelative(
  source: string,
  modulePath: string | undefined,
): string | null {
  const file = source.replace(/:\d+$/, '');
  return modulePath && file.startsWith(`${modulePath}/`)
    ? file.slice(modulePath.length + 1)
    : null;
}

/** Where every symbol the Delta declares lives, relative to the module root. */
function declaredLocations(
  delta: Delta,
  { layers }: ResolvedConventions,
  eventsFileOf: (entity: string) => string,
): Map<string, string> {
  const where = new Map<string, string>();
  const domain = (name: string): string =>
    `${layers.domain}/${kebab(name)}.ts`;
  for (const e of delta.entities) where.set(e.name, domain(e.name));
  for (const v of delta.valueObjects) where.set(v.name, domain(v.name));
  for (const ev of delta.events)
    where.set(ev.name, eventsFileOf(ev.entity));
  for (const p of delta.ports) where.set(p.name, domain(p.name));
  return where;
}

/** Adds what the base declares in this module and the Delta does not redeclare. */
function addBaseLocations(
  where: Map<string, string>,
  base: IR,
  module: string,
  modulePath: string | undefined,
): void {
  const groups = [
    base.entities,
    orEmpty(base.valueObjects),
    base.events,
    orEmpty(base.ports),
  ];
  for (const item of groups.flat()) {
    if (item.module !== module || where.has(item.name)) continue;
    const file = moduleRelative(item.source, modulePath);
    if (file !== null) where.set(item.name, file);
  }
}

/** The file the base declares the events of an entity in (read from what its methods emit), or null. */
function baseEventsFile(
  base: IR | null,
  module: string,
  modulePath: string | undefined,
  entity: string,
): string | null {
  const owner = base?.entities.find(
    (e) => e.name === entity && e.module === module,
  );
  const emitted = new Set(owner?.methods.flatMap((m) => m.emits));
  const files = (base?.events ?? [])
    .filter((ev) => ev.module === module && emitted.has(ev.id))
    .flatMap((ev) => moduleRelative(ev.source, modulePath) ?? []);
  return files.sort(cmp)[0] ?? null;
}

const eventsFile = (layers: Layers, suffix: string, entity: string): string =>
  `${layers.domain}/${kebab(entity)}${suffix}`;

const pathKey = (path: string): string =>
  posix.normalize(path.replace(/\\/g, '/')).toLowerCase();

/**
 * Existing files are never overwritten: the caller lists every file in the module, and the
 * base's decorated files count too. Paths compare ignoring case (case-insensitive file systems).
 */
function takenPaths(
  existingFiles: readonly string[],
  base: IR | null,
  modulePath: string | undefined,
): Set<string> {
  const taken = new Set(existingFiles.map(pathKey));
  for (const item of decoratedItems(base)) {
    const file = moduleRelative(item.source, modulePath);
    if (file !== null) taken.add(pathKey(file));
  }
  return taken;
}

/** Every base item that owns a decorated file. */
const decoratedItems = (base: IR | null): readonly { source: string }[] =>
  base === null
    ? []
    : [
        ...base.entities,
        ...orEmpty(base.valueObjects),
        ...base.events,
        ...base.useCases,
        ...orEmpty(base.ports),
      ];

const relativeSpec = (from: string, to: string): string => {
  const rel = posix.relative(posix.dirname(from), to.replace(/\.ts$/, ''));
  return rel.startsWith('.') ? rel : `./${rel}`;
};

/** The file of a use-case the base declares in this module, or null when it cannot be located. */
function baseUseCaseFile(
  base: IR | null,
  module: string,
  modulePath: string | undefined,
  name: string,
): string | null {
  const target = base?.useCases.find(
    (u) => u.module === module && u.name === name,
  );
  return target ? moduleRelative(target.source, modulePath) : null;
}

const exampleRows = (
  entity: string,
  invariants: readonly InvariantDecl[] | undefined,
): RenderedExample[] =>
  orEmpty(invariants).flatMap((inv) =>
    inv.examples.map((e) => ({
      invariant: `invariant:${entity}/${inv.id}`,
      given: e.given,
      when: e.when,
      // eslint-disable-next-line unicorn/no-thenable
      then: e.then,
    })),
  );

/** The acceptance examples of every new invariant, ordered by invariant. */
function collectExamples(delta: Delta): RenderedExample[] {
  const owners = [
    ...delta.entities,
    ...orEmpty(delta.entityAdditions).map((a) => ({ ...a, name: a.entity })),
  ];
  return owners
    .flatMap((o) => [
      ...exampleRows(o.name, o.invariants),
      ...o.methods.flatMap((m) => exampleRows(o.name, m.invariants)),
    ])
    .sort((a, b) => cmp(a.invariant, b.invariant));
}

/** Events are grouped per owning entity, one file each. */
function groupByOwner(
  events: readonly EventDecl[],
): Map<string, { item: EventDecl; i: number }[]> {
  const byOwner = new Map<string, { item: EventDecl; i: number }[]>();
  events.forEach((item, i) => {
    const group = byOwner.get(item.entity) ?? [];
    group.push({ item, i });
    byOwner.set(item.entity, group);
  });
  return byOwner;
}

/** The `@AgentUseCase({...})` option lines. */
function useCaseOptions(
  uc: UseCaseDecl,
  stem: string,
  emits: readonly string[],
  ports: readonly string[],
): string[] {
  return [
    `  name: ${literal(uc.name)},`,
    `  description: ${literal(uc.description)},`,
    `  whenToUse: ${literal(uc.whenToUse)},`,
    ...(uc.whenNotToUse === undefined
      ? []
      : [`  whenNotToUse: ${literal(uc.whenNotToUse)},`]),
    `  input: ${stem}Input,`,
    `  output: ${stem}Output,`,
    `  uses: ${list(sorted(uc.uses).map(literal))},`,
    `  emits: ${list(emits)},`,
    ...(ports.length > 0 ? [`  ports: () => ${list(ports)},`] : []),
  ];
}

/** One rendering run: a method per kind of rendered file; problems land in `#errors`. */
class Renderer {
  readonly #delta: Delta;
  readonly #conventions: ResolvedConventions;
  readonly #where: Map<string, string>;
  readonly #taken: Set<string>;
  readonly #base: IR | null;
  readonly #modulePath: string | undefined;
  readonly #errors: DeltaError[] = [];
  readonly #files = new Map<string, { path: string; content: string }>();
  readonly #fragments: Fragment[] = [];

  constructor(delta: Delta, options: RenderOptions) {
    const base = options.base ?? null;
    const modulePath = base?.modules.find((m) => m.name === delta.module)?.path;
    this.#delta = delta;
    this.#base = base;
    this.#modulePath = modulePath;
    this.#conventions = options.conventions;
    const { layers, suffixes } = options.conventions;
    this.#where = declaredLocations(delta, options.conventions, (entity) =>
      (!delta.entities.some((e) => e.name === entity)
        ? baseEventsFile(base, delta.module, modulePath, entity)
        : null) ?? eventsFile(layers, suffixes.events, entity),
    );
    if (base) addBaseLocations(this.#where, base, delta.module, modulePath);
    this.#taken = takenPaths(options.existingFiles, base, modulePath);
  }

  render(): RenderResult {
    const d = this.#delta;
    ordered(d.entities).forEach(({ item, i }) => this.entity(item, i));
    ordered(orEmpty(d.entityAdditions), 'entity').forEach(({ item, i }) =>
      this.entityAddition(item, i),
    );
    ordered(d.valueObjects).forEach(({ item, i }) =>
      this.valueObject(item, i),
    );
    ordered(d.ports).forEach(({ item, i }) => this.port(item, i));
    const byOwner = groupByOwner(d.events);
    for (const owner of [...byOwner.keys()].sort(cmp))
      this.eventFile(owner, byOwner.get(owner)!);
    ordered(d.useCases).forEach(({ item, i }) => this.useCase(item, i));
    ordered(orEmpty(d.useCaseAdditions), 'useCase').forEach(({ item, i }) =>
      this.useCaseAddition(item, i),
    );
    if (this.#errors.length > 0)
      return { ok: false, errors: this.#errors.sort(compareErrors) };
    return {
      ok: true,
      files: [...this.#files.values()].sort((a, b) => cmp(a.path, b.path)),
      fragments: this.#fragments.sort((a, b) => cmp(a.path, b.path)),
      examples: collectExamples(d),
    };
  }

  locate(name: string, path: string): string | null {
    const file = this.#where.get(name);
    if (file === undefined)
      this.#errors.push({
        code: 'delta.reference-unknown',
        path,
        message: `${name} cannot be located in module ${this.#delta.module}`,
      });
    return file ?? null;
  }

  /** Imports `name` into the file at `from`, unless it cannot be located (then it is an error). */
  importName(
    imports: Imports,
    from: string,
    name: string,
    path: string,
    typeOnly = false,
  ): void {
    const to = this.locate(name, path);
    // A name declared in the very file being written is in scope already: no self-import.
    if (to !== null && to !== from)
      imports.add(relativeSpec(from, to), name, typeOnly);
  }

  /** Imports the declared type a type text refers to, except `self`. */
  importType(
    imports: Imports,
    from: string,
    source: string,
    path: string,
    self?: string,
  ): void {
    const ref = leafRef(source);
    if (ref !== null && ref !== self)
      this.importName(imports, from, ref, path, true);
  }

  put(path: string, content: string, at: string): void {
    const k = pathKey(path);
    if (this.#taken.has(k) || this.#files.has(k))
      this.#errors.push({
        code: 'delta.path-collision',
        path: at,
        message: `${path} already exists in the module or is rendered twice (paths compare ignoring case)`,
      });
    else this.#files.set(k, { path, content });
  }

  entity(entity: EntityDecl, ei: number): void {
    const at = `entities[${ei}]`;
    const file = this.#where.get(entity.name)!;
    const imports = new Imports();
    imports.add('@agentic-ddd/core', 'AggregateRoot');
    imports.add('@agentic-ddd/decorators', 'AgentEntity');
    if (entity.invariants.length > 0)
      imports.add('@agentic-ddd/decorators', 'Invariant');

    // The declared order is the lifecycle order shown in the dev skill, so it is not sorted.
    const states = entity.states ?? [];
    const head = [
      `@AgentEntity({\n  description: ${literal(entity.description)},${
        states.length > 0 ? `\n  states: ${list(states.map(literal))},` : ''
      }\n})`,
      ...invariantDecorators(entity.invariants, ''),
    ];
    const methods = ordered(entity.methods).map(({ item: m, i: mi }) =>
      this.entityMethod(imports, file, entity.name, m, `${at}.methods[${mi}]`),
    );
    const body = methods.length > 0 ? `{\n${methods.join('\n\n')}\n}` : '{}';
    this.put(
      file,
      `${imports.render()}\n\n${head.join('\n')}\nexport class ${entity.name} extends AggregateRoot<string> ${body}\n`,
      at,
    );
  }

  /** Additions to an existing entity become a fragment: its file is never re-rendered. */
  entityAddition(add: EntityAdditionDecl, ai: number): void {
    const at = `entityAdditions[${ai}]`;
    const file = this.locate(add.entity, `${at}.entity`);
    if (file === null) return;
    const imports = new Imports();
    if (add.invariants.length > 0)
      imports.add('@agentic-ddd/decorators', 'Invariant');
    const members = ordered(add.methods).map(({ item: m, i: mi }) => ({
      name: m.name,
      text: this.entityMethod(
        imports,
        file,
        add.entity,
        m,
        `${at}.methods[${mi}]`,
      ),
    }));
    this.#fragments.push({
      path: file,
      imports: sortedImports(imports),
      target: { kind: 'class', name: add.entity },
      classDecorators: invariantDecorators(add.invariants, ''),
      members,
    });
  }

  /** One method with its decorators; imports what it needs into `imports` (the file it lands in). */
  entityMethod(
    imports: Imports,
    file: string,
    entityName: string,
    m: EntityMethodDecl,
    mAt: string,
  ): string {
    imports.add('@agentic-ddd/core', 'notImplemented');
    imports.add('@agentic-ddd/decorators', 'AgentMethod');
    if (orEmpty(m.invariants).length > 0)
      imports.add('@agentic-ddd/decorators', 'Invariant');
    const opts = [`    description: ${literal(m.description)},`];
    if (m.transition)
      opts.push(
        `    transition: { from: ${list(sorted(m.transition.from).map(literal))}, to: ${literal(m.transition.to)} },`,
      );
    const emits = sorted(m.emits);
    if (emits.length > 0) {
      opts.push(`    emits: ${list(emits)},`);
      emits.forEach((ev) =>
        this.importName(imports, file, ev, `${mAt}.emits`),
      );
    }
    m.params.forEach((p, i) =>
      this.importType(
        imports,
        file,
        p.type,
        `${mAt}.params[${i}].type`,
        entityName,
      ),
    );
    this.importType(imports, file, m.returns, `${mAt}.returns`, entityName);
    const params = m.params.map(tsField).join(', ');
    return [
      `  @AgentMethod({\n${opts.join('\n')}\n  })`,
      ...invariantDecorators(m.invariants, '  '),
      `  ${m.static ? 'static ' : ''}${m.name}(${params}): ${m.returns} {\n    return notImplemented();\n  }`,
    ].join('\n');
  }

  valueObject(vo: Delta['valueObjects'][number], vi: number): void {
    const at = `valueObjects[${vi}]`;
    const file = this.#where.get(vo.name)!;
    const imports = new Imports();
    imports.add('@agentic-ddd/core', 'ValueObject');
    imports.add('@agentic-ddd/decorators', 'AgentValueObject');
    const fields = [...vo.fields].sort((a, b) => cmp(a.name, b.name));
    fields.forEach((f, i) =>
      this.importType(imports, file, f.type, `${at}.fields[${i}].type`, vo.name),
    );
    const props = fields.map((f) => `  readonly ${tsField(f)};`).join('\n');
    this.put(
      file,
      `${imports.render()}\n\nexport interface ${vo.name}Props {\n${props}\n}\n\n@AgentValueObject({ description: ${literal(vo.description)} })\nexport class ${vo.name} extends ValueObject<${vo.name}Props> {\n  constructor(props: ${vo.name}Props) {\n    super(props);\n  }\n}\n`,
      at,
    );
  }

  port(port: Delta['ports'][number], pi: number): void {
    const at = `ports[${pi}]`;
    const file = this.#where.get(port.name)!;
    const imports = new Imports();
    imports.add('@agentic-ddd/decorators', 'AgentPort');
    this.importName(imports, file, port.root, `${at}.root`);
    const methods = ordered(port.methods);
    methods.forEach(({ item: m, i }) => {
      m.params.forEach((p, pj) =>
        this.importType(
          imports,
          file,
          p.type,
          `${at}.methods[${i}].params[${pj}].type`,
        ),
      );
      this.importType(imports, file, m.returns, `${at}.methods[${i}].returns`);
    });
    const described = methods
      .map(({ item: m }) => `    ${m.name}: ${literal(m.description)},`)
      .join('\n');
    const abstracts = methods
      .map(
        ({ item: m }) =>
          `  abstract ${m.name}(${m.params.map(tsField).join(', ')}): Promise<${m.returns}>;`,
      )
      .join('\n');
    this.put(
      file,
      `${imports.render()}\n\n@AgentPort({\n  description: ${literal(port.description)},\n  root: () => ${port.root},\n  methods: {\n${described}\n  },\n})\nexport abstract class ${port.name} {\n${abstracts}\n}\n`,
      at,
    );
  }

  eventFile(owner: string, group: { item: EventDecl; i: number }[]): void {
    const imports = new Imports();
    imports.add('zod', 'z');
    imports.add('@agentic-ddd/core', 'DomainEvent');
    imports.add('@agentic-ddd/decorators', 'AgentEvent');
    const blocks = group
      .sort((a, b) => cmp(a.item.name, b.item.name) || a.i - b.i)
      .map(({ item: ev }) => {
        const payload = `${lcFirst(ev.name)}Payload`;
        return `const ${payload} = ${zodObject(ev.payload)};\n\n@AgentEvent({\n  description: ${literal(ev.description)},\n  payload: ${payload},\n})\nexport class ${ev.name} extends DomainEvent<z.infer<typeof ${payload}>> {}`;
      });
    const path = this.#where.get(group[0]!.item.name)!;
    // Events of an entity that already has an events file are appended to it.
    if (this.appendsToExisting(owner, path))
      this.#fragments.push({
        path,
        imports: sortedImports(imports),
        target: null,
        appended: blocks,
      });
    else
      this.put(
        path,
        `${imports.render()}\n\n${blocks.join('\n\n')}\n`,
        `events[${Math.min(...group.map((g) => g.i))}]`,
      );
  }

  /** The owner is not declared by this Delta and its events file already exists. */
  appendsToExisting(owner: string, path: string): boolean {
    return (
      !this.#delta.entities.some((e) => e.name === owner) &&
      this.#taken.has(pathKey(path))
    );
  }

  useCase(uc: UseCaseDecl, ui: number): void {
    const at = `useCases[${ui}]`;
    const file = `${this.#conventions.layers.application}/${uc.name.replace(/_/g, '-')}.ts`;
    const cls = pascalOfSnake(uc.name);
    const stem = camelOfSnake(uc.name);
    const imports = new Imports();
    imports.add('zod', 'z');
    imports.add('@agentic-ddd/core', 'notImplemented');
    imports.add('@agentic-ddd/core', 'UseCase', true);
    imports.add('@agentic-ddd/core', 'UseCaseContext', true);
    imports.add('@agentic-ddd/decorators', 'AgentUseCase');
    const emits = sorted(uc.emits);
    emits.forEach((ev) => this.importName(imports, file, ev, `${at}.emits`));
    const ports = sorted(uc.ports);
    ports.forEach((p) => this.importName(imports, file, p, `${at}.ports`));
    const opts = useCaseOptions(uc, stem, emits, ports);
    const ctor = ports
      .map((p) => `private readonly ${lcFirst(p)}: ${p}`)
      .join(', ');
    this.put(
      file,
      `${imports.render()}\n\nexport const ${stem}Input = ${zodObject(uc.input)};\nexport const ${stem}Output = ${zodObject(uc.output)};\nexport type ${cls}Input = z.infer<typeof ${stem}Input>;\nexport type ${cls}Output = z.infer<typeof ${stem}Output>;\n\n@AgentUseCase({\n${opts.join('\n')}\n})\nexport class ${cls} implements UseCase<${cls}Input, ${cls}Output> {\n${ctor ? `  constructor(${ctor}) {}\n\n` : ''}  async execute(_input: ${cls}Input, _ctx: UseCaseContext): Promise<${cls}Output> {\n    return notImplemented();\n  }\n}\n`,
      at,
    );
  }

  /** `uses` and `emits` added to an existing use-case become a fragment of its file. */
  useCaseAddition(add: UseCaseAdditionDecl, ai: number): void {
    const at = `useCaseAdditions[${ai}]`;
    const { module } = this.#delta;
    const file = baseUseCaseFile(this.#base, module, this.#modulePath, add.useCase);
    if (file === null) {
      this.#errors.push({
        code: 'delta.reference-unknown',
        path: `${at}.useCase`,
        message: `${add.useCase} cannot be located in module ${module}`,
      });
      return;
    }
    const imports = new Imports();
    const emits = sorted(add.emits);
    emits.forEach((ev) => this.importName(imports, file, ev, `${at}.emits`));
    this.#fragments.push({
      path: file,
      imports: sortedImports(imports),
      target: { kind: 'use-case', name: add.useCase },
      arrays: [
        { property: 'uses', elements: sorted(add.uses).map(literal) },
        { property: 'emits', elements: emits },
      ].filter((a) => a.elements.length > 0),
    });
  }
}

export function renderDelta(
  input: Delta,
  options: RenderOptions,
): RenderResult {
  const checked = validateDelta(input, { base: options.base ?? null });
  if (!checked.ok) return checked;
  return new Renderer(checked.delta, options).render();
}
