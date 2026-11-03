import { posix } from 'node:path';
import type { ResolvedConventions } from '../conventions';
import type { IR } from '../ir';
import { RENDERER_IMPORTS } from './names';
import {
  compareErrors,
  compareText,
  kebab,
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

export type RenderResult =
  | { readonly ok: true; readonly files: RenderedFile[] }
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
const ordered = <T extends { name: string }>(
  items: readonly T[],
): { item: T; i: number }[] =>
  items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => cmp(a.item.name, b.item.name) || a.i - b.i);
const cmp = compareText;
const sorted = (list: readonly string[] | undefined): string[] =>
  [...(list ?? [])].sort(cmp);
const lcFirst = (s: string): string => s[0]!.toLowerCase() + s.slice(1);
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

const field = (f: { name: string; type: string }, t: TypeExpr): string => {
  const { id, optional } = splitOptional(f.name);
  return `${id}: ${zodOf(t)}${optional ? '.optional()' : ''}`;
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
        .map((f) => `  ${field(f, parseType(f.type)!)},`)
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

export function renderDelta(
  input: Delta,
  options: RenderOptions,
): RenderResult {
  const checked = validateDelta(input, { base: options.base ?? null });
  if (!checked.ok) return checked;
  const delta = checked.delta;
  const { layers, suffixes } = options.conventions;
  const base = options.base ?? null;
  const modulePath = base?.modules.find((m) => m.name === delta.module)?.path;
  const errors: DeltaError[] = [];

  // Where every symbol the Delta can mention lives, relative to the module root.
  const where = new Map<string, string>();
  const eventsFile = (entity: string): string =>
    `${layers.domain}/${kebab(entity)}${suffixes.events}`;
  for (const e of delta.entities)
    where.set(e.name, `${layers.domain}/${kebab(e.name)}.ts`);
  for (const v of delta.valueObjects)
    where.set(v.name, `${layers.domain}/${kebab(v.name)}.ts`);
  for (const ev of delta.events) where.set(ev.name, eventsFile(ev.entity));
  for (const p of delta.ports)
    where.set(p.name, `${layers.domain}/${kebab(p.name)}.ts`);
  const fromBase = (
    items: readonly { name: string; module: string; source: string }[],
  ): void => {
    for (const item of items) {
      if (item.module !== delta.module || where.has(item.name)) continue;
      const file = item.source.replace(/:\d+$/, '');
      if (modulePath && file.startsWith(`${modulePath}/`))
        where.set(item.name, file.slice(modulePath.length + 1));
    }
  };
  if (base) {
    fromBase(base.entities);
    fromBase(base.valueObjects ?? []);
    fromBase(base.events);
    fromBase(base.ports ?? []);
  }
  const locate = (name: string, path: string): string | null => {
    const file = where.get(name);
    if (file === undefined)
      errors.push({
        code: 'delta.reference-unknown',
        path,
        message: `${name} cannot be located in module ${delta.module}`,
      });
    return file ?? null;
  };
  const spec = (from: string, to: string): string => {
    const rel = posix.relative(posix.dirname(from), to.replace(/\.ts$/, ''));
    return rel.startsWith('.') ? rel : `./${rel}`;
  };

  // Existing files are never overwritten: the caller lists every file in the module, and the
  // base's decorated files count too. Paths compare ignoring case (case-insensitive file systems).
  const key = (path: string): string =>
    path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  const taken = new Set(options.existingFiles.map(key));
  for (const item of [
    ...(base?.entities ?? []),
    ...(base?.valueObjects ?? []),
    ...(base?.events ?? []),
    ...(base?.useCases ?? []),
    ...(base?.ports ?? []),
  ]) {
    const file = item.source.replace(/:\d+$/, '');
    if (modulePath && file.startsWith(`${modulePath}/`))
      taken.add(key(file.slice(modulePath.length + 1)));
  }
  const files = new Map<string, { path: string; content: string }>();
  const put = (path: string, content: string, at: string): void => {
    const k = key(path);
    if (taken.has(k) || files.has(k))
      errors.push({
        code: 'delta.path-collision',
        path: at,
        message: `${path} already exists in the module or is rendered twice (paths compare ignoring case)`,
      });
    else files.set(k, { path, content });
  };

  ordered(delta.entities).forEach(({ item: entity, i: ei }) => {
    const at = `entities[${ei}]`;
    const file = where.get(entity.name)!;
    const imports = new Imports();
    imports.add('@agentic-ddd/core', 'AggregateRoot');
    imports.add('@agentic-ddd/decorators', 'AgentEntity');
    const typeImport = (source: string, path: string): void => {
      const ref = leafRef(source);
      if (ref === null || ref === entity.name) return;
      const to = locate(ref, path);
      if (to !== null) imports.add(spec(file, to), ref, true);
    };
    const hasInvariants =
      entity.invariants.length > 0 ||
      entity.methods.some((m) => (m.invariants ?? []).length > 0);
    if (hasInvariants) imports.add('@agentic-ddd/decorators', 'Invariant');
    if (entity.methods.length > 0) {
      imports.add('@agentic-ddd/core', 'notImplemented');
      imports.add('@agentic-ddd/decorators', 'AgentMethod');
    }

    const states = sorted(entity.states);
    const head = [
      `@AgentEntity({\n  description: ${literal(entity.description)},${
        states.length > 0 ? `\n  states: ${list(states.map(literal))},` : ''
      }\n})`,
      ...invariantDecorators(entity.invariants, ''),
    ];
    const methods = ordered(entity.methods).map(({ item: m, i: mi }) => {
      const mAt = `${at}.methods[${mi}]`;
      const opts = [`    description: ${literal(m.description)},`];
      if (m.transition)
        opts.push(
          `    transition: { from: ${list(sorted(m.transition.from).map(literal))}, to: ${literal(m.transition.to)} },`,
        );
      const emits = sorted(m.emits);
      if (emits.length > 0) {
        opts.push(`    emits: ${list(emits)},`);
        emits.forEach((ev) => {
          const to = locate(ev, `${mAt}.emits`);
          if (to !== null) imports.add(spec(file, to), ev);
        });
      }
      m.params.forEach((p, i) =>
        typeImport(p.type, `${mAt}.params[${i}].type`),
      );
      typeImport(m.returns, `${mAt}.returns`);
      const params = m.params.map(tsField).join(', ');
      return [
        `  @AgentMethod({\n${opts.join('\n')}\n  })`,
        ...invariantDecorators(m.invariants, '  '),
        `  ${m.static ? 'static ' : ''}${m.name}(${params}): ${m.returns} {\n    return notImplemented();\n  }`,
      ].join('\n');
    });
    const body = methods.length > 0 ? `{\n${methods.join('\n\n')}\n}` : '{}';
    put(
      file,
      `${imports.render()}\n\n${head.join('\n')}\nexport class ${entity.name} extends AggregateRoot<string> ${body}\n`,
      at,
    );
  });

  ordered(delta.valueObjects).forEach(({ item: vo, i: vi }) => {
    const at = `valueObjects[${vi}]`;
    const file = where.get(vo.name)!;
    const imports = new Imports();
    imports.add('@agentic-ddd/core', 'ValueObject');
    imports.add('@agentic-ddd/decorators', 'AgentValueObject');
    const fields = [...vo.fields].sort((a, b) => cmp(a.name, b.name));
    fields.forEach((f, i) => {
      const ref = leafRef(f.type);
      if (ref === null || ref === vo.name) return;
      const to = locate(ref, `${at}.fields[${i}].type`);
      if (to !== null) imports.add(spec(file, to), ref, true);
    });
    const props = fields.map((f) => `  readonly ${tsField(f)};`).join('\n');
    put(
      file,
      `${imports.render()}\n\nexport interface ${vo.name}Props {\n${props}\n}\n\n@AgentValueObject({ description: ${literal(vo.description)} })\nexport class ${vo.name} extends ValueObject<${vo.name}Props> {\n  constructor(props: ${vo.name}Props) {\n    super(props);\n  }\n}\n`,
      at,
    );
  });

  ordered(delta.ports).forEach(({ item: port, i: pi }) => {
    const at = `ports[${pi}]`;
    const file = where.get(port.name)!;
    const imports = new Imports();
    imports.add('@agentic-ddd/decorators', 'AgentPort');
    const root = locate(port.root, `${at}.root`);
    if (root !== null) imports.add(spec(file, root), port.root);
    const typeImport = (source: string, path: string): void => {
      const ref = leafRef(source);
      if (ref === null) return;
      const to = locate(ref, path);
      if (to !== null) imports.add(spec(file, to), ref, true);
    };
    const methods = ordered(port.methods);
    methods.forEach(({ item: m, i }) => {
      m.params.forEach((p, pj) =>
        typeImport(p.type, `${at}.methods[${i}].params[${pj}].type`),
      );
      typeImport(m.returns, `${at}.methods[${i}].returns`);
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
    put(
      file,
      `${imports.render()}\n\n@AgentPort({\n  description: ${literal(port.description)},\n  root: () => ${port.root},\n  methods: {\n${described}\n  },\n})\nexport abstract class ${port.name} {\n${abstracts}\n}\n`,
      at,
    );
  });

  // Events are grouped per owning entity, one file each.
  const byOwner = new Map<
    string,
    { item: Delta['events'][number]; i: number }[]
  >();
  delta.events.forEach((item, i) => {
    const group = byOwner.get(item.entity) ?? [];
    group.push({ item, i });
    byOwner.set(item.entity, group);
  });
  for (const owner of [...byOwner.keys()].sort(cmp)) {
    const group = byOwner.get(owner)!;
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
    put(
      eventsFile(owner),
      `${imports.render()}\n\n${blocks.join('\n\n')}\n`,
      `events[${Math.min(...group.map((g) => g.i))}]`,
    );
  }

  ordered(delta.useCases).forEach(({ item: uc, i: ui }) => {
    const at = `useCases[${ui}]`;
    const file = `${layers.application}/${uc.name.replace(/_/g, '-')}.ts`;
    const cls = pascalOfSnake(uc.name);
    const stem = camelOfSnake(uc.name);
    const imports = new Imports();
    imports.add('zod', 'z');
    imports.add('@agentic-ddd/core', 'notImplemented');
    imports.add('@agentic-ddd/core', 'UseCase', true);
    imports.add('@agentic-ddd/core', 'UseCaseContext', true);
    imports.add('@agentic-ddd/decorators', 'AgentUseCase');
    const emits = sorted(uc.emits);
    emits.forEach((ev) => {
      const to = locate(ev, `${at}.emits`);
      if (to !== null) imports.add(spec(file, to), ev);
    });
    const ports = sorted(uc.ports);
    ports.forEach((p) => {
      const to = locate(p, `${at}.ports`);
      if (to !== null) imports.add(spec(file, to), p);
    });
    const opts = [
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
    const ctor = ports
      .map((p) => `private readonly ${lcFirst(p)}: ${p}`)
      .join(', ');
    put(
      file,
      `${imports.render()}\n\nexport const ${stem}Input = ${zodObject(uc.input)};\nexport const ${stem}Output = ${zodObject(uc.output)};\nexport type ${cls}Input = z.infer<typeof ${stem}Input>;\nexport type ${cls}Output = z.infer<typeof ${stem}Output>;\n\n@AgentUseCase({\n${opts.join('\n')}\n})\nexport class ${cls} implements UseCase<${cls}Input, ${cls}Output> {\n${ctor ? `  constructor(${ctor}) {}\n\n` : ''}  async execute(_input: ${cls}Input, _ctx: UseCaseContext): Promise<${cls}Output> {\n    return notImplemented();\n  }\n}\n`,
      at,
    );
  });

  if (errors.length > 0)
    return {
      ok: false,
      errors: errors.sort(compareErrors),
    };
  return {
    ok: true,
    files: [...files.values()].sort((a, b) => cmp(a.path, b.path)),
  };
}
