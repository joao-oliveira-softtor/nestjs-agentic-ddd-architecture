import { relative, sep } from 'node:path';
import { z, type ZodType } from 'zod';
import type { ClassRef, Registry, SourceLoc } from '@agentic-ddd/decorators';
import { byId, sha256, stableStringify } from './canonical.js';

export type JsonSchema = Record<string, unknown>;

export interface IRModule {
  readonly name: string;
  readonly path: string;
}

export interface IRTransition {
  readonly from: string[];
  readonly to: string;
}

export interface IRInvariant {
  readonly id: string;
  readonly text: string;
  readonly on: string | null;
  readonly source: string;
}

export interface IRMethod {
  readonly id: string;
  readonly name: string;
  readonly static: boolean;
  readonly description: string;
  readonly transition: IRTransition | null;
  readonly emits: string[];
  readonly source: string;
}

export interface IREntity {
  readonly id: string;
  readonly name: string;
  readonly module: string;
  readonly description: string;
  readonly states: string[];
  readonly invariants: IRInvariant[];
  readonly methods: IRMethod[];
  readonly source: string;
}

export interface IREvent {
  readonly id: string;
  readonly name: string;
  readonly module: string;
  readonly description: string;
  readonly payloadSchema: JsonSchema;
  readonly source: string;
}

export interface IRUseCase {
  readonly id: string;
  readonly name: string;
  readonly module: string;
  readonly description: string;
  readonly whenToUse: string;
  readonly whenNotToUse: string | null;
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;
  readonly uses: string[];
  readonly emits: string[];
  readonly source: string;
}

export interface IROperator {
  readonly id: string;
  readonly name: string;
  readonly module: string;
  readonly description: string;
  readonly instructions: string;
  readonly useCases: string[];
  readonly requiresApproval: string[];
  readonly limits: { readonly maxSteps: number; readonly timeoutMs: number };
  readonly model: string;
  readonly source: string;
}

export interface IR {
  readonly irVersion: 1;
  readonly modules: IRModule[];
  readonly entities: IREntity[];
  readonly events: IREvent[];
  readonly useCases: IRUseCase[];
  readonly operators: IROperator[];
}

export interface CompileError {
  readonly message: string;
  readonly source: string | null;
}

export interface IRBuildOptions {
  readonly root: string;
  readonly modules: readonly IRModule[];
}

export interface IRBuildResult {
  readonly ir: IR;
  readonly errors: CompileError[];
}

export const UNASSIGNED_MODULE = '<sem-modulo>';

export function toPosix(path: string): string {
  return path.split(sep).join('/');
}

export function sourceOf(root: string, loc: SourceLoc): string {
  return `${toPosix(relative(root, loc.file))}:${loc.line}`;
}

export function irHash(ir: IR): string {
  return sha256(stableStringify(ir));
}

export function buildIR(
  registry: Registry,
  options: IRBuildOptions,
): IRBuildResult {
  const errors: CompileError[] = [];
  const modules = [...options.modules].sort(
    (a, b) => b.path.length - a.path.length,
  );
  const loc = (s: SourceLoc): string => sourceOf(options.root, s);

  const moduleOf = (s: SourceLoc): string => {
    const file = toPosix(relative(options.root, s.file));
    const found = modules.find(
      (m) => file === m.path || file.startsWith(`${m.path}/`),
    );
    if (found) return found.name;
    errors.push({
      message: 'elemento declarado fora dos módulos de agentic.config.ts',
      source: loc(s),
    });
    return UNASSIGNED_MODULE;
  };

  const eventId = (cls: ClassRef, at: SourceLoc): string => {
    if (!registry.events.some((e) => e.target === cls)) {
      errors.push({
        message: `emits aponta para ${cls.name}, que não tem @AgentEvent`,
        source: loc(at),
      });
    }
    return `event:${cls.name}`;
  };

  const useCaseId = (cls: ClassRef, at: SourceLoc, owner: string): string => {
    const found = registry.useCases.find((u) => u.target === cls);
    if (found) return `usecase:${found.name}`;
    errors.push({
      message: `${owner}: ${cls.name} não tem @AgentUseCase`,
      source: loc(at),
    });
    return `usecase:${cls.name}`;
  };

  const schema = (
    zod: ZodType,
    at: SourceLoc,
    what: string,
    io: 'input' | 'output' = 'output',
  ): JsonSchema => {
    try {
      const json: JsonSchema = {
        ...(z.toJSONSchema(zod, { io }) as JsonSchema),
      };
      delete json.$schema;
      return json;
    } catch (error) {
      errors.push({
        message: `${what}: schema Zod não representável em JSON Schema (${(error as Error).message})`,
        source: loc(at),
      });
      return {};
    }
  };

  const entities = registry.entities
    .map((rec): IREntity => {
      const name = rec.target.name;
      return {
        id: `entity:${name}`,
        name,
        module: moduleOf(rec.source),
        description: rec.description,
        states: [...rec.states],
        invariants: registry.invariants
          .filter((i) => i.entity === rec.target)
          .map((i) => ({
            id: `invariant:${name}/${i.id}`,
            text: i.text,
            on: i.method === null ? null : `method:${name}.${i.method}`,
            source: loc(i.source),
          }))
          .sort(byId),
        methods: registry.methods
          .filter((m) => m.entity === rec.target)
          .map((m) => ({
            id: `method:${name}.${m.name}`,
            name: m.name,
            static: m.isStatic,
            description: m.description,
            transition: m.transition
              ? { from: [...m.transition.from], to: m.transition.to }
              : null,
            emits: m.emits.map((e) => eventId(e, m.source)).sort(),
            source: loc(m.source),
          }))
          .sort(byId),
        source: loc(rec.source),
      };
    })
    .sort(byId);

  const events = registry.events
    .map((rec): IREvent => ({
      id: `event:${rec.target.name}`,
      name: rec.target.name,
      module: moduleOf(rec.source),
      description: rec.description,
      payloadSchema: schema(
        rec.payload,
        rec.source,
        `event:${rec.target.name} payload`,
        'output',
      ),
      source: loc(rec.source),
    }))
    .sort(byId);

  const useCases = registry.useCases
    .map((rec): IRUseCase => ({
      id: `usecase:${rec.name}`,
      name: rec.name,
      module: moduleOf(rec.source),
      description: rec.description,
      whenToUse: rec.whenToUse,
      whenNotToUse: rec.whenNotToUse,
      inputSchema: schema(
        rec.input,
        rec.source,
        `usecase:${rec.name} input`,
        'input',
      ),
      outputSchema: schema(
        rec.output,
        rec.source,
        `usecase:${rec.name} output`,
        'output',
      ),
      uses: [...rec.uses].sort(),
      emits: rec.emits.map((e) => eventId(e, rec.source)).sort(),
      source: loc(rec.source),
    }))
    .sort(byId);

  const operators = registry.operators
    .map((rec): IROperator => {
      const owner = `operator:${rec.name}`;
      return {
        id: owner,
        name: rec.name,
        module: moduleOf(rec.source),
        description: rec.description,
        instructions: rec.instructions,
        useCases: rec.useCases
          .map((u) => useCaseId(u, rec.source, owner))
          .sort(),
        requiresApproval: rec.requiresApproval
          .map((u) => useCaseId(u, rec.source, owner))
          .sort(),
        limits: {
          maxSteps: rec.limits.maxSteps,
          timeoutMs: rec.limits.timeoutMs,
        },
        model: rec.model,
        source: loc(rec.source),
      };
    })
    .sort(byId);

  return {
    ir: {
      irVersion: 1,
      modules: [...options.modules]
        .map((m) => ({ name: m.name, path: m.path }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
      entities,
      events,
      useCases,
      operators,
    },
    errors,
  };
}
