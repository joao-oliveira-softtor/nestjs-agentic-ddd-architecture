import { runOperator } from './run';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { UseCase } from '@agentic-ddd/core';
import {
  defaultRegistry,
  type ClassRef,
  type OperatorRecord,
  type Registry,
  type UseCaseRecord,
} from '@agentic-ddd/decorators';
import { buildIR, irHash, type IRModule } from '../contracts/ir';
import type { ApprovalPort, EventBus, LlmPort } from './ports';
import { InMemoryEventBus } from './event-bus';
import type { LlmTool, OperatorRunResult, RunInput } from './types';

export type UseCaseInstances = ReadonlyMap<ClassRef, UseCase<unknown, unknown>>;
export interface RuntimeOptions {
  llm: LlmPort;
  approval?: ApprovalPort;
  eventBus?: EventBus;
  runtimeDir?: string;
  root?: string;
  /** Must match the compiler's complete module configuration. */
  modules: readonly IRModule[];
  registry?: Registry;
}
export interface MountedOperator {
  record: OperatorRecord;
  system: string;
  tools: LlmTool[];
  useCases: Map<
    string,
    { record: UseCaseRecord; instance: UseCase<unknown, unknown> }
  >;
}

export class OperatorRuntime {
  readonly eventBus: EventBus;
  #operators = new Map<string, MountedOperator>();
  constructor(private readonly options: RuntimeOptions) {
    this.eventBus = options.eventBus ?? new InMemoryEventBus();
  }

  async register(target: ClassRef, instances: UseCaseInstances): Promise<void> {
    const root = resolve(this.options.root ?? process.cwd());
    const registry = this.options.registry ?? defaultRegistry;
    const record = registry.operators.find((o) => o.target === target);
    if (!record) throw new Error(`Operator ${target.name} is not declared`);
    if (this.#operators.has(record.name))
      throw new Error(`Duplicate operator ${record.name}`);
    if (
      !Number.isInteger(record.limits.maxSteps) ||
      record.limits.maxSteps <= 0 ||
      !Number.isFinite(record.limits.timeoutMs) ||
      record.limits.timeoutMs <= 0
    )
      throw new Error(`Invalid limits for ${record.name}`);
    const { ir, errors } = buildIR(registry, {
      root,
      modules: this.options.modules,
    });
    if (errors.length)
      throw new Error(
        `Invalid declarations: ${errors.map((e) => e.message).join('; ')}; run agentic-ddd compile`,
      );
    const path = resolve(
      root,
      this.options.runtimeDir ?? '.agentic/runtime',
      record.name,
      'SKILL.md',
    );
    const skill = await readFile(path, 'utf8').catch(() => {
      throw new Error(
        `Missing runtime skill for ${record.name}; run agentic-ddd compile`,
      );
    });
    const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(skill);
    const hash = front?.[1]?.match(
      /^  agentic-ddd\.ir-hash: "([a-f0-9]{64})"\r?$/m,
    )?.[1];
    if (hash !== irHash(ir))
      throw new Error(
        `Stale runtime skill for ${record.name}; run agentic-ddd compile`,
      );
    const useCases: MountedOperator['useCases'] = new Map();
    const tools: LlmTool[] = [];
    for (const cls of record.useCases) {
      const declared = registry.useCases.find((u) => u.target === cls);
      const instance = instances.get(cls);
      if (!declared || !instance)
        throw new Error(`Missing declared use-case instance: ${cls.name}`);
      if (useCases.has(declared.name))
        throw new Error(`Duplicate tool ${declared.name}`);
      useCases.set(declared.name, { record: declared, instance });
      const schema = ir.useCases.find((u) => u.name === declared.name)!;
      tools.push({
        name: declared.name,
        description: [
          declared.description,
          `Quando usar: ${declared.whenToUse}`,
          ...(declared.whenNotToUse
            ? [`Quando não usar: ${declared.whenNotToUse}`]
            : []),
        ].join('\n'),
        inputSchema: schema.inputSchema,
      });
    }
    if (record.requiresApproval.some((cls) => !record.useCases.includes(cls)))
      throw new Error('Approval target outside allowlist');
    tools.sort((a, b) => a.name.localeCompare(b.name));
    this.#operators.set(record.name, {
      record,
      system: `${record.instructions}\n\n${front![2]}`,
      tools,
      useCases,
    });
  }

  async run(name: string, input: RunInput): Promise<OperatorRunResult> {
    const operator = this.#operators.get(name);
    if (!operator) throw new Error(`Unknown operator: ${name}`);
    return runOperator(operator, input, {
      ...this.options,
      eventBus: this.eventBus,
    });
  }
}
