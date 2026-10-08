import type { UseCase } from '@agentic-ddd/core';
import {
  Module,
  type DynamicModule,
  type Provider,
  type Type,
} from '@nestjs/common';
import { defaultRegistry } from '@agentic-ddd/decorators';
import {
  OperatorRuntime,
  InMemoryEventBus,
  type RuntimeOptions,
  type LlmPort,
  type ApprovalPort,
  type EventBus,
} from '@agentic-ddd/runtime';
import { resolve } from 'node:path';
import { declarationsInModules } from '../contracts/scope';

export const LLM_PORT = Symbol('agentic-ddd.LlmPort');
export const APPROVAL_PORT = Symbol('agentic-ddd.ApprovalPort');
export const EVENT_BUS = Symbol('agentic-ddd.EventBus');
export interface FeatureOptions {
  operators: readonly Type[];
  /** Class tokens or Nest providers whose `provide` is the decorated use-case class. */
  useCases: readonly Provider[];
  providers?: readonly Provider[];
  imports?: DynamicModule['imports'];
}
const denyApproval = {
  async request() {
    return { approved: false, reason: 'ApprovalPort is not configured' };
  },
};

@Module({})
export class AgenticModule {
  static forRoot(options: RuntimeOptions): DynamicModule {
    return {
      module: AgenticModule,
      global: true,
      providers: [
        { provide: LLM_PORT, useValue: options.llm },
        { provide: APPROVAL_PORT, useValue: options.approval ?? denyApproval },
        {
          provide: EVENT_BUS,
          useValue: options.eventBus ?? new InMemoryEventBus(),
        },
        {
          provide: OperatorRuntime,
          inject: [LLM_PORT, APPROVAL_PORT, EVENT_BUS],
          useFactory: (
            llm: LlmPort,
            approval: ApprovalPort,
            eventBus: EventBus,
          ) =>
            new OperatorRuntime({
              ...options,
              llm,
              approval,
              eventBus,
              registry:
                options.registry ??
                declarationsInModules(
                  defaultRegistry,
                  resolve(options.root ?? process.cwd()),
                  options.modules,
                ),
            }),
        },
      ],
      exports: [LLM_PORT, APPROVAL_PORT, EVENT_BUS, OperatorRuntime],
    };
  }

  static forFeature(options: FeatureOptions): DynamicModule {
    const tokens = options.useCases.map((provider) =>
      typeof provider === 'function' ? provider : provider.provide,
    );
    if (tokens.some((token) => typeof token !== 'function'))
      throw new Error('Use-case providers must use decorated class tokens');
    return {
      module: AgenticModule,
      imports: options.imports,
      providers: [
        ...(options.providers ?? []),
        ...options.useCases,
        ...options.operators,
        {
          provide: Symbol('agentic-ddd.feature-registration'),
          inject: [OperatorRuntime, ...tokens],
          useFactory: async (
            runtime: OperatorRuntime,
            ...instances: UseCase<unknown, unknown>[]
          ) => {
            const injected = new Map(
              tokens.map((token, i) => [token as Type, instances[i]!]),
            );
            for (const operator of options.operators)
              await runtime.register(operator, injected);
            return true;
          },
        },
      ],
      exports: [...tokens, ...options.operators],
    };
  }
}
