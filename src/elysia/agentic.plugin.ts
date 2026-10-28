import { DomainError, type UseCase } from '@agentic-ddd/core';
import type { ClassRef } from '@agentic-ddd/decorators';
import {
  createRuntime,
  runUseCase,
  type OperatorRuntime,
  type RuntimeOptions,
} from '@agentic-ddd/runtime';
import { Elysia, InternalServerError, type CreateEden } from 'elysia';

type UseCases = Record<string, UseCase<any, any>>;
export interface HttpOptions<P extends string = string> {
  /** Default '/agentic'. */
  prefix?: P;
}
export interface AgenticOptions<U extends UseCases = UseCases>
  extends RuntimeOptions {
  operators: readonly ClassRef[];
  /** Instances keyed by the `name` of their `@AgentUseCase`. */
  useCases: U;
  /** Mounts `POST {prefix}/use-cases/<name>`; the routes mutate the domain, so authenticate them in the app. */
  http?: HttpOptions;
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
type UseCaseRoutes<P extends string, U extends UseCases> = CreateEden<
  `${P extends `${infer Head}/` ? Head : P}/use-cases`,
  {
    [K in keyof U & string]: {
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

/**
 * Mounts the same decorated domain as `AgenticModule`: registers the operators
 * and decorates the app with the runtime as `agentic`. Operators get no HTTP
 * route (ADR-0007 D5); call `ctx.agentic.run(...)` with server-side context.
 * Mount one plugin per app with all modules: a second `agentic()` does not
 * replace the first one's `agentic` decorator.
 */
export function agentic<const U extends UseCases>(
  options: AgenticOptions<U> & { http?: undefined },
): Promise<Base>;
export function agentic<
  const U extends UseCases,
  const P extends string = '/agentic',
>(
  options: AgenticOptions<U> & { http: HttpOptions<P> },
): Promise<WithRoutes<UseCaseRoutes<P, U>>>;
// `http` may be absent at runtime, so no routes are promised.
export function agentic<const U extends UseCases>(
  options: AgenticOptions<U> & { http?: HttpOptions },
): Promise<Base>;
export async function agentic(options: AgenticOptions): Promise<Base> {
  const runtime = createRuntime(options);
  const mounted = Object.entries(options.useCases).map(([name, instance]) => {
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
    return { record, instance: instance as UseCase<unknown, unknown> };
  });
  const instances = new Map(
    mounted.map(({ record, instance }) => [record.target, instance]),
  );
  for (const operator of options.operators)
    await runtime.register(operator, instances);
  const app = new Elysia({ name: 'agentic-ddd' }).decorate('agentic', runtime);
  if (!options.http) return app;
  const prefix = (options.http.prefix ?? '/agentic').replace(/\/$/, '');
  return app.group(prefix, (group) => {
    for (const { record, instance } of mounted)
      group.post(
        `/use-cases/${record.name}`,
        async ({ body, status }) => {
          try {
            // Elysia already validated and transformed `body` with record.input.
            return await runUseCase(
              record,
              instance,
              body,
              runtime.eventBus,
            );
          } catch (error) {
            // Elysia's default 500 echoes error.message; the original stays on `cause` for the app's onError.
            if (!(error instanceof DomainError))
              throw Object.assign(new InternalServerError(), { cause: error });
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
