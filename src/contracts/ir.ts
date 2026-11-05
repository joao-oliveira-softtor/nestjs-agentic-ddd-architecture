import { relative, sep } from 'node:path';
import { z, type ZodType } from 'zod';
import {
  canonicalPath,
  type ClassRef,
  type Registry,
  type SourceLoc,
} from '@agentic-ddd/decorators';
import { byId, sha256, stableStringify } from './canonical';
import type { ErrorCode } from './codes';
import { moduleOfPath } from './module-path';

export {
  AgenticError,
  ERROR_CODES,
  formatCoded,
  type Coded,
  type ErrorCode,
} from './codes';

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
  readonly contains?: string[];
  readonly references?: string[];
  readonly source: string;
}

export interface IRValueObject {
  readonly id: string;
  readonly name: string;
  readonly module: string;
  readonly description: string;
  readonly invariants: IRInvariant[];
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

export interface IRPort {
  readonly id: string;
  readonly name: string;
  readonly module: string;
  readonly description: string;
  readonly root: string;
  readonly methods: { readonly name: string; readonly description: string }[];
  readonly source: string;
}

export interface IRAdapter {
  readonly id: string;
  readonly name: string;
  readonly module: string;
  readonly description: string;
  readonly implements: string;
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
  readonly ports?: string[];
  readonly invariants?: IRInvariant[];
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
  readonly valueObjects?: IRValueObject[];
  readonly events: IREvent[];
  readonly ports?: IRPort[];
  readonly adapters?: IRAdapter[];
  readonly useCases: IRUseCase[];
  readonly operators: IROperator[];
}

export interface CompileError {
  readonly code: ErrorCode;
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

export const UNASSIGNED_MODULE = '<unassigned>';

export function toPosix(path: string): string {
  return path.split(sep).join('/');
}

// Re-exported for callers that compare roots; the SourceLoc file is already canonical from captureSource.
export { canonicalPath };

export function sourceOf(root: string, loc: SourceLoc): string {
  return `${toPosix(relative(canonicalPath(root), loc.file))}:${loc.line}`;
}

export function irHash(ir: IR): string {
  return sha256(stableStringify(ir));
}

export function buildIR(
  registry: Registry,
  options: IRBuildOptions,
): IRBuildResult {
  const errors: CompileError[] = [];
  const root = canonicalPath(options.root);
  const loc = (s: SourceLoc): string => sourceOf(root, s);

  const moduleOf = (s: SourceLoc): string => {
    const file = toPosix(relative(root, s.file));
    const found = moduleOfPath(options.modules, file);
    if (found) return found.name;
    errors.push({
      code: 'ir.outside-modules',
      message: 'element declared outside the modules of agentic.config.ts',
      source: loc(s),
    });
    return UNASSIGNED_MODULE;
  };

  const eventId = (cls: ClassRef, at: SourceLoc): string => {
    if (!registry.events.some((e) => e.target === cls)) {
      errors.push({
        code: 'ir.emits-target-missing',
        message: `emits points to ${cls.name}, which has no @AgentEvent`,
        source: loc(at),
      });
    }
    return `event:${cls.name}`;
  };

  const useCaseId = (cls: ClassRef, at: SourceLoc, owner: string): string => {
    const found = registry.useCases.find((u) => u.target === cls);
    if (found) return `usecase:${found.name}`;
    errors.push({
      code: 'ir.usecase-missing',
      message: `${owner}: ${cls.name} has no @AgentUseCase`,
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
        code: 'ir.schema-unrepresentable',
        message: `${what}: Zod schema cannot be represented as JSON Schema (${(error as Error).message})`,
        source: loc(at),
      });
      return {};
    }
  };

  // Calls the thunk and converts to ids inside the try; anything that does not resolve stays out of the list.
  const relation = (
    rec: Registry['entities'][number],
    field: 'contains' | 'references',
  ): string[] => {
    const thunk = rec[field];
    if (!thunk) return [];
    const owner = `entity:${rec.target.name}`;
    const fail = (code: ErrorCode, message: string): void => {
      errors.push({
        code,
        message: `${owner}: ${message}`,
        source: loc(rec.source),
      });
    };
    try {
      const list = thunk();
      if (!Array.isArray(list)) {
        fail('ir.relation-not-list', `${field} did not return a list`);
        return [];
      }
      const ids = new Set<string>();
      for (const cls of list as unknown[]) {
        if (typeof cls !== 'function') {
          fail(
            'ir.relation-not-class',
            `${field} has an entry that is not a class`,
          );
        } else if (registry.entities.some((e) => e.target === cls)) {
          ids.add(`entity:${cls.name}`);
        } else if (registry.valueObjects.some((v) => v.target === cls)) {
          ids.add(`valueobject:${cls.name}`);
        } else {
          fail(
            'ir.relation-target-invalid',
            `${field} cites ${cls.name}, which has neither @AgentEntity nor @AgentValueObject`,
          );
        }
      }
      return [...ids].sort();
    } catch (error) {
      fail(
        'ir.thunk-threw',
        `${field} threw ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  };

  const entities = registry.entities
    .map((rec): IREntity => {
      const name = rec.target.name;
      const contains = relation(rec, 'contains');
      const references = relation(rec, 'references');
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
        ...(contains.length > 0 && { contains }),
        ...(references.length > 0 && { references }),
        source: loc(rec.source),
      };
    })
    .sort(byId);

  const vos = registry.valueObjects
    .map((rec): IRValueObject => {
      const name = rec.target.name;
      return {
        id: `valueobject:${name}`,
        name,
        module: moduleOf(rec.source),
        description: rec.description,
        invariants: registry.invariants
          .filter((i) => i.entity === rec.target)
          .map((i): IRInvariant => ({
            id: `invariant:${name}/${i.id}`,
            text: i.text,
            on: null,
            source: loc(i.source),
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

  const portTargets = new Map<ClassRef, string>();
  const ports = registry.ports
    .flatMap((rec): IRPort[] => {
      const id = `port:${rec.target.name}`;
      const fail = (code: ErrorCode, message: string): IRPort[] => {
        errors.push({
          code,
          message: `${id}: ${message}`,
          source: loc(rec.source),
        });
        return [];
      };
      let root: unknown;
      try {
        root = rec.root();
      } catch (error) {
        return fail(
          'ir.thunk-threw',
          `root threw ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (typeof root !== 'function')
        return fail('ir.root-not-class', 'root did not return a class');
      if (!registry.entities.some((e) => e.target === root))
        return fail(
          'ir.root-not-entity',
          `root cites ${root.name}, which has no @AgentEntity`,
        );
      portTargets.set(rec.target, id);
      return [
        {
          id,
          name: rec.target.name,
          module: moduleOf(rec.source),
          description: rec.description,
          root: `entity:${root.name}`,
          methods: Object.entries(rec.methods)
            .map(([name, description]) => ({ name, description }))
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
          source: loc(rec.source),
        },
      ];
    })
    .sort(byId);

  const adapters = registry.adapters
    .flatMap((rec): IRAdapter[] => {
      const id = `adapter:${rec.target.name}`;
      const fail = (code: ErrorCode, message: string): IRAdapter[] => {
        errors.push({
          code,
          message: `${id}: ${message}`,
          source: loc(rec.source),
        });
        return [];
      };
      let port: unknown;
      try {
        port = rec.implements();
      } catch (error) {
        return fail(
          'ir.thunk-threw',
          `implements threw ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (typeof port !== 'function')
        return fail(
          'ir.implements-not-class',
          'implements did not return a class',
        );
      const portId = portTargets.get(port as ClassRef);
      if (portId === undefined)
        return fail(
          'ir.implements-not-port',
          `implements cites ${port.name}, which has no @AgentPort`,
        );
      return [
        {
          id,
          name: rec.target.name,
          module: moduleOf(rec.source),
          description: rec.description,
          implements: portId,
          source: loc(rec.source),
        },
      ];
    })
    .sort(byId);

  const portIds = (rec: Registry['useCases'][number]): string[] => {
    if (!rec.ports) return [];
    const fail = (code: ErrorCode, message: string): string[] => {
      errors.push({
        code,
        message: `usecase:${rec.name}: ${message}`,
        source: loc(rec.source),
      });
      return [];
    };
    try {
      const ids = new Set<string>();
      for (const cls of rec.ports()) {
        if (typeof cls !== 'function') {
          fail('ir.ports-not-class', 'ports has an entry that is not a class');
        } else if (!registry.ports.some((p) => p.target === cls)) {
          fail(
            'ir.ports-not-port',
            `ports cites ${cls.name}, which has no @AgentPort`,
          );
        } else {
          const id = portTargets.get(cls);
          if (id) ids.add(id);
        }
      }
      return [...ids].sort();
    } catch (error) {
      return fail(
        'ir.thunk-threw',
        `ports threw ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const useCases = registry.useCases
    .map((rec): IRUseCase => {
      const usePorts = portIds(rec);
      const invs: IRInvariant[] = registry.invariants
        .filter((i) => i.entity === rec.target)
        .map((i) => ({
          id: `invariant:${rec.name}/${i.id}`,
          text: i.text,
          on: null,
          source: loc(i.source),
        }))
        .sort(byId);
      return {
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
        ...(usePorts.length > 0 && { ports: usePorts }),
        ...(invs.length > 0 && { invariants: invs }),
        source: loc(rec.source),
      };
    })
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

  // ADR-0006 D2: a new key on an existing element (and at the top of the IR) goes in as ...(xs.length > 0 && { xs }); never xs: undefined or xs: [].
  return {
    ir: {
      irVersion: 1,
      modules: [...options.modules]
        .map((m) => ({ name: m.name, path: m.path }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
      entities,
      ...(vos.length > 0 && { valueObjects: vos }),
      events,
      ...(ports.length > 0 && { ports }),
      ...(adapters.length > 0 && { adapters }),
      useCases,
      operators,
    },
    errors,
  };
}
