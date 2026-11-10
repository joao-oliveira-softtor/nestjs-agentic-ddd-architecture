import { DomainError, type UseCase } from '@agentic-ddd/core';
import type { ClassRef, Registry } from '@agentic-ddd/decorators';
import {
  AgenticError,
  createRuntime,
  runUseCase,
  schemaLookup,
  type OperatorRuntime,
  type RuntimeOptions,
} from '@agentic-ddd/runtime';
import {
  ERROR_CODE,
  Elysia,
  ElysiaCustomStatusResponse,
  InternalServerError,
  InvalidCookieSignature,
  InvalidFileType,
  NotFoundError,
  ParseError,
  ValidationError,
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
  /** Per-field issues (`summary`, `path`, `message`, `value`, ...), at most 64. */
  errors?: Array<{
    summary?: string;
    path?: string;
    message?: string;
    value?: unknown;
  }>;
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
          /** `runtime.use-case-timeout`, with `useCaseTimeoutMs` set. */
          504: DomainErrorBody;
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

const ELYSIA_ERRORS = [
  ElysiaCustomStatusResponse,
  InternalServerError,
  InvalidCookieSignature,
  InvalidFileType,
  NotFoundError,
  ParseError,
  ValidationError,
];

/**
 * `status()`, Elysia's own errors and the classes an app registered with `.error()`, whose
 * prototype Elysia marks with ERROR_CODE. An outside client's error (AxiosError, FetchError)
 * also has a `status`, but its status and message must not reach the client.
 * The mark is process-wide and inherited, so only the exact registered class counts:
 * `.error({ Error })` must not let every Error subclass through.
 */
function isElysiaError(error: unknown): boolean {
  if (ELYSIA_ERRORS.some((cls) => error instanceof cls)) return true;
  const prototype: unknown =
    typeof error === 'object' && error !== null
      ? Object.getPrototypeOf(error)
      : null;
  return prototype !== null && Object.hasOwn(prototype as object, ERROR_CODE);
}

const hooked = Symbol('agentic-ddd.rejectSecondMount');
type Agentic = { agentic?: unknown };
type Mountable = { decorator: object; getParent: () => Mountable | null };

/**
 * Elysia keeps the first `agentic` decorator, so a second plugin on one app would leave
 * its operators unreachable through `ctx.agentic` without a sign. `use()` assigns the
 * plugin's `getParent`, which is the only hook that sees the parent at mount time.
 * A parent that passes the check gets the same hook, so two sibling sub-apps that each hold an
 * `agentic()` fail when the second one reaches their common app; `hooked` installs it once per instance.
 * Known limit: a plugin that is an async function returning another instance never receives
 * `getParent`, so it is not detected.
 * shortcut: relies on that Elysia internal; `agentic.plugin.test.ts` fails if an upgrade drops it.
 */
function rejectSecondMount(app: Mountable): void {
  if (hooked in app) return;
  Object.defineProperty(app, hooked, { value: true });
  // Elysia's own getParent answers null until the instance is mounted.
  let getParent = app.getParent;
  Object.defineProperty(app, 'getParent', {
    configurable: true,
    get: () => getParent,
    set(assigned: () => Mountable) {
      const parent = assigned();
      // The same runtime arriving by a second path (one sub-app mounted twice) is not a second plugin.
      if (
        'agentic' in parent.decorator &&
        parent.decorator.agentic !== (app.decorator as Agentic).agentic
      )
        throw new Error(
          'Mount one agentic() per app: ctx.agentic would keep the first runtime',
        );
      rejectSecondMount(parent);
      getParent = assigned;
    },
  });
}

/** The use-cases that get a route: `http.routes`, or all, none of them approval-gated. */
function routesToMount<
  M extends { record: { name: string; target: ClassRef } },
>(options: AgenticOptions, registry: Registry, mounted: M[]): M[] {
  const listed = options.http?.routes;
  if (listed) {
    for (const name of listed)
      if (!mounted.some(({ record }) => record.name === name))
        throw new Error(`http.routes names ${name}, which is not in useCases`);
    return mounted.filter(({ record }) => listed.includes(record.name));
  }
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
  const routes = options.http
    ? routesToMount(options, runtime.registry, mounted)
    : [];
  const instances = new Map(
    mounted.map(({ record, instance }) => [record.target, instance]),
  );
  // register() rechecks the name right before storing it, so a duplicate still fails.
  await Promise.all(
    options.operators.map((operator) => runtime.register(operator, instances)),
  );
  const app = new Elysia({ name: 'agentic-ddd' }).decorate('agentic', runtime);
  rejectSecondMount(app as unknown as Mountable);
  if (!options.http) return app;
  const schemaFor = schemaLookup(runtime.registry);
  const prefix = (options.http.prefix ?? '/agentic').replace(/\/$/, '');
  return app.group(prefix, (group) => {
    for (const { record, instance } of routes)
      group.post(
        `/use-cases/${record.name}`,
        async ({ body, status }) => {
          try {
            // Elysia already validated and transformed `body` with record.input.
            return await runUseCase(record, instance, body, runtime.eventBus, {
              schemaFor,
              timeoutMs: runtime.useCaseTimeoutMs,
            });
          } catch (error) {
            if (
              error instanceof AgenticError &&
              error.code === 'runtime.use-case-timeout'
            )
              return status(504, {
                code: error.code,
                message: error.message,
              } satisfies DomainErrorBody);
            // Elysia's default 500 echoes error.message; the original stays on `cause` for the app's onError.
            if (!(error instanceof DomainError)) {
              // The app's own Elysia errors (NotFoundError, `status()`, `.error()` classes) keep their status.
              if (isElysiaError(error)) throw error;
              // Not enumerable, so an onError that serializes the 500 does not leak the original.
              throw Object.defineProperty(new InternalServerError(), 'cause', {
                value: error,
                enumerable: false,
                configurable: true,
                writable: true,
              });
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
