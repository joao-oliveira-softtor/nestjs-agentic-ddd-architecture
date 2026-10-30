import { posix } from 'node:path';
import type { ResolvedConventions } from '../conventions';
import type { IR } from '../ir';
import {
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
}

/**
 * The single door for client text (ADR-0007 D9): a single-quoted JS string literal. Backslash and
 * both quotes are escaped, `${` and the backtick are broken up, and every control, line-separator,
 * bidi, surrogate-half or invisible character becomes a \uXXXX escape. Other characters pass through.
 */
export function literal(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const c = s.charCodeAt(i);
    if (ch === '\\') out += '\\\\';
    else if (ch === "'") out += "\\'";
    else if (ch === '"') out += '\\"';
    else if (ch === '`') out += '\\x60';
    else if (ch === '$' && s[i + 1] === '{') out += '\\x24';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += ch + s[i + 1];
        i++;
      } else out += unicode(c);
    } else if (
      c < 0x20 ||
      (c >= 0x7f && c <= 0x9f) ||
      (c >= 0xdc00 && c <= 0xdfff) ||
      (c >= 0x200b && c <= 0x200f) ||
      (c >= 0x2028 && c <= 0x202e) ||
      (c >= 0x2060 && c <= 0x2069) ||
      c === 0xfeff
    )
      out += unicode(c);
    else out += ch;
  }
  return `'${out}'`;
}

const unicode = (c: number): string => `\\u${c.toString(16).padStart(4, '0')}`;

const byName = <T extends { name: string }>(list: readonly T[]): T[] =>
  [...list].sort((a, b) => cmp(a.name, b.name));
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (list: readonly string[] | undefined): string[] =>
  [...(list ?? [])].sort(cmp);
const lcFirst = (s: string): string => s[0]!.toLowerCase() + s.slice(1);
const camelOfSnake = (s: string): string => lcFirst(pascalOfSnake(s));
const list = (items: readonly string[]): string => `[${items.join(', ')}]`;

/** One file's imports: specifier -> names (true = type-only). */
class Imports {
  readonly #specs = new Map<string, Map<string, boolean>>();

  add(spec: string, name: string, typeOnly = false): void {
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

  // Existing files are never overwritten: a path the base already owns is a collision.
  const baseFiles = new Set(
    [
      ...(base?.entities ?? []),
      ...(base?.valueObjects ?? []),
      ...(base?.events ?? []),
      ...(base?.useCases ?? []),
      ...(base?.ports ?? []),
    ].map((i) => i.source.replace(/:\d+$/, '')),
  );
  const files = new Map<string, string>();
  const put = (path: string, content: string, at: string): void => {
    if (
      files.has(path) ||
      (modulePath && baseFiles.has(`${modulePath}/${path}`))
    )
      errors.push({
        code: 'delta.name-collision',
        path: at,
        message: `${path} is already written or exists in the base`,
      });
    files.set(path, content);
  };

  const entities = byName(delta.entities);
  entities.forEach((entity) => {
    const at = `entities[${delta.entities.indexOf(entity)}]`;
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
    const methods = byName(entity.methods).map((m) => {
      const mAt = `${at}.methods[${entity.methods.indexOf(m)}]`;
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

  byName(delta.valueObjects).forEach((vo) => {
    const at = `valueObjects[${delta.valueObjects.indexOf(vo)}]`;
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

  byName(delta.ports).forEach((port) => {
    const at = `ports[${delta.ports.indexOf(port)}]`;
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
    const methods = byName(port.methods);
    methods.forEach((m) => {
      const i = port.methods.indexOf(m);
      m.params.forEach((p, pi) =>
        typeImport(p.type, `${at}.methods[${i}].params[${pi}].type`),
      );
      typeImport(m.returns, `${at}.methods[${i}].returns`);
    });
    const described = methods
      .map((m) => `    ${m.name}: ${literal(m.description)},`)
      .join('\n');
    const abstracts = methods
      .map(
        (m) =>
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
  const owners = [...new Set(delta.events.map((e) => e.entity))].sort(cmp);
  for (const owner of owners) {
    const imports = new Imports();
    imports.add('zod', 'z');
    imports.add('@agentic-ddd/core', 'DomainEvent');
    imports.add('@agentic-ddd/decorators', 'AgentEvent');
    const blocks = byName(delta.events.filter((e) => e.entity === owner)).map(
      (ev) => {
        const payload = `${lcFirst(ev.name)}Payload`;
        return `const ${payload} = ${zodObject(ev.payload)};\n\n@AgentEvent({\n  description: ${literal(ev.description)},\n  payload: ${payload},\n})\nexport class ${ev.name} extends DomainEvent<z.infer<typeof ${payload}>> {}`;
      },
    );
    put(
      eventsFile(owner),
      `${imports.render()}\n\n${blocks.join('\n\n')}\n`,
      `events[${delta.events.findIndex((e) => e.entity === owner)}]`,
    );
  }

  byName(delta.useCases).forEach((uc) => {
    const at = `useCases[${delta.useCases.indexOf(uc)}]`;
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
      errors: errors.sort(
        (a, b) => cmp(a.path, b.path) || cmp(a.message, b.message),
      ),
    };
  return {
    ok: true,
    files: [...files.entries()]
      .sort(([a], [b]) => cmp(a, b))
      .map(([path, content]) => ({ path, content })),
  };
}
