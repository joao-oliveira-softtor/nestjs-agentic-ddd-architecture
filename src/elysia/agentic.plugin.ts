import { DomainError, type UseCase } from '@agentic-ddd/core';
import { defaultRegistry, type ClassRef } from '@agentic-ddd/decorators';
import {
  createRuntime,
  runUseCase,
  type OperatorRuntime,
  type RuntimeOptions,
} from '@agentic-ddd/runtime';
import {
  Elysia,
  ElysiaCustomStatusResponse,
  InternalServerError,
  type CreateEden,
} from 'elysia';

type UseCases = Record<string, UseCase<any, any>>;
export interface HttpOptions<
  P extends string = string,
  R extends string = string,
> {
  /** Default '/agentic'. */
  prefix?: P;
  /**
   * Use-cases to expose, by name; default is all of `useCases`. A use-case that an operator
   * lists in `requiresApproval` is never exposed by default (a route skips the ApprovalPort):
   * mounting fails unless it is named here.
   */
  routes?: readonly R[];
}
export interface AgenticOptions<
  U extends UseCases = UseCases,
> extends RuntimeOptions {
  operators: readonly ClassRef[];
  /** Instances keyed by the `name` of their `@AgentUseCase`. */
  useCases: U;
  /** Mounts `POST {prefix}/use-cases/<name>`; the routes mutate the domain, so authenticate them in the app. */
  http?: HttpOptions<string, keyof U & string>;
}
export interface DomainErrorBody {
  code: string;
  message: string;
}

/** Elysia's own body-validation 422, which has no exported type; `'code' in error.value` tells it from a DomainErrorBody. */
export interface ValidationErrorBody {
  type: 'validation';
  on: string;
  summary?: string;
  message?: string;
  found?: unknown;
  property?: string;
  expected?: unknown;
}

type Base = Elysia<
  '',
  {
    decorator: { agentic: OperatorRuntime };
    store: {};
    derive: {};
    resolve: {};
  }
>;
type InputOf<C> = C extends UseCase<infer I, any> ? I : never;
type OutputOf<C> = C extends UseCase<any, infer O> ? O : never;
// The routes are built in a loop, so Eden gets their types from the instances.
// shortcut: body/response come from the UseCase<I, O> generics (parsed types), not the zod schema's input type, so transform/coerce/default schemas give clients the wrong body type; upgrade when the decorator/IR exposes schema types or the compiler emits the route table.
type UseCaseRoutes<
  P extends string,
  U extends UseCases,
  R extends keyof U & string,
> = CreateEden<
  `${P extends `${infer Head}/` ? Head : P}/use-cases`,
  {
    [K in R]: {
      post: {
        body: InputOf<U[K]>;
        params: {};
        query: unknown;
        headers: unknown;
        response: {
          200: OutputOf<U[K]>;
          422: DomainErrorBody | ValidationErrorBody;
        };
      };
    };
  }
>;
type WithRoutes<R> =
  Base extends Elysia<
    infer B,
    infer S,
    infer D,
    infer M,
    infer Routes,
    infer E,
    infer V
  >
    ? Elysia<B, S, D, M, Routes & R, E, V>
    : never;

function carriesHttpStatus(error: unknown): boolean {
  if (error instanceof ElysiaCustomStatusResponse) return true;
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 600;
}

/**
 * Elysia keeps the first `agentic` decorator, so a second plugin on one app would leave
 * its operators unreachable through `ctx.agentic` without a sign. `use()` assigns the
 * plugin's `getParent`, which is the only hook that sees the parent at mount time.
 * shortcut: relies on that Elysia internal; `agentic.plugin.test.ts` fails if an upgrade drops it.
 */
function rejectSecondMount(app: Base): void {
  let getParent: () => { decorator: object } = () => app;
  Object.defineProperty(app, 'getParent', {
    configurable: true,
    get: () => getParent,
    set(assigned: typeof getParent) {
      if ('agentic' in assigned().decorator)
        throw new Error(
          'Mount one agentic() per app: ctx.agentic would keep the first runtime',
        );
      getParent = assigned;
    },
  });
}

/** The use-cases that get a route: `http.routes`, or all, none of them approval-gated. */
function routesToMount<
  M extends { record: { name: string; target: ClassRef } },
>(options: AgenticOptions, mounted: M[]): M[] {
  const listed = options.http?.routes;
  if (listed) {
    for (const name of listed)
      if (!mounted.some(({ record }) => record.name === name))
        throw new Error(`http.routes names ${name}, which is not in useCases`);
    return mounted.filter(({ record }) => listed.includes(record.name));
  }
  const registry = options.registry ?? defaultRegistry;
  for (const { record } of mounted) {
    const gate = registry.operators.find(
      (operator) =>
        options.operators.includes(operator.target) &&
        operator.requiresApproval.includes(record.target),
    );
    if (gate)
      throw new Error(
        `Use-case ${record.name} requires approval in operator ${gate.name}; list it in http.routes to expose it`,
      );
  }
  return mounted;
}

/** The `@AgentUseCase` record of an instance, which must be keyed by that record's name. */
function mountedUseCase(
  runtime: OperatorRuntime,
  name: string,
  instance: UseCase<unknown, unknown>,
) {
  let record: ReturnType<OperatorRuntime['useCase']>;
  // Like Nest's useClass, an instance of a subclass of the declared class is accepted.
  for (
    let cls: unknown = instance.constructor;
    !record && typeof cls === 'function';
    cls = Object.getPrototypeOf(cls)
  )
    record = runtime.useCase(cls as ClassRef);
  if (!record)
    throw new Error(
      `Use-case ${name} is not an @AgentUseCase of the configured modules`,
    );
  if (record.name !== name)
    throw new Error(
      `Use-case key ${name} must match its @AgentUseCase name ${record.name}`,
    );
  return { record, instance };
}

/**
 * Mounts the same decorated domain as `AgenticModule`: registers the operators
 * and decorates the app with the runtime as `agentic`. Operators get no HTTP
 * route (ADR-0007 D5); call `ctx.agentic.run(...)` with server-side context.
 * Mount one plugin per app with all modules: a second `agentic()` fails
 * the mount, because it would not replace the first one's `agentic` decorator.
 */
export function agentic<const U extends UseCases>(
  options: AgenticOptions<U> & { http?: undefined },
): Promise<Base>;
export function agentic<
  const U extends UseCases,
  const P extends string = '/agentic',
  const R extends keyof U & string = keyof U & string,
>(
  options: AgenticOptions<U> & { http: HttpOptions<P, R> },
): Promise<WithRoutes<UseCaseRoutes<P, U, R>>>;
// `http` may be absent at runtime, so no routes are promised.
export function agentic<const U extends UseCases>(
  options: AgenticOptions<U> & { http?: HttpOptions<string, keyof U & string> },
): Promise<Base>;
export async function agentic(options: AgenticOptions): Promise<Base> {
  const runtime = createRuntime(options);
  const mounted = Object.entries(options.useCases).map(([name, instance]) =>
    mountedUseCase(runtime, name, instance),
  );
  const routes = options.http ? routesToMount(options, mounted) : [];
  const instances = new Map(
    mounted.map(({ record, instance }) => [record.target, instance]),
  );
  for (const operator of options.operators)
    await runtime.register(operator, instances);
  const app = new Elysia({ name: 'agentic-ddd' }).decorate('agentic', runtime);
  rejectSecondMount(app);
  if (!options.http) return app;
  const prefix = (options.http.prefix ?? '/agentic').replace(/\/$/, '');
  return app.group(prefix, (group) => {
    for (const { record, instance } of routes)
      group.post(
        `/use-cases/${record.name}`,
        async ({ body, status }) => {
          try {
            // Elysia already validated and transformed `body` with record.input.
            return await runUseCase(record, instance, body, runtime.eventBus);
          } catch (error) {
            // Elysia's default 500 echoes error.message; the original stays on `cause` for the app's onError.
            if (!(error instanceof DomainError)) {
              // The app's own Elysia errors (NotFoundError, `status()`, `.error()` classes) keep their status.
              if (carriesHttpStatus(error)) throw error;
              throw Object.assign(new InternalServerError(), { cause: error });
            }
            return status(422, {
              code: error.code,
              message: error.message,
            } satisfies DomainErrorBody);
          }
        },
        { body: record.input },
      );
    return group;
  }) as unknown as Base;
}
