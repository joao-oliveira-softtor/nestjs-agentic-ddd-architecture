import type { ZodType } from 'zod';
import { activeRegistry, type ClassRef, type OperatorLimits } from './registry.js';
import { captureSource } from './source.js';

export interface AgentUseCaseOptions {
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string;
  readonly whenNotToUse?: string;
  readonly input: ZodType;
  readonly output: ZodType;
  readonly uses: readonly string[];
  readonly emits?: readonly ClassRef[];
}

export function AgentUseCase(options: AgentUseCaseOptions): ClassDecorator {
  const source = captureSource();
  return (target) => {
    activeRegistry().useCases.push({
      target,
      name: options.name,
      description: options.description,
      whenToUse: options.whenToUse,
      whenNotToUse: options.whenNotToUse ?? null,
      input: options.input,
      output: options.output,
      uses: options.uses,
      emits: options.emits ?? [],
      source,
    });
  };
}

export const DEFAULT_LIMITS: OperatorLimits = { maxSteps: 8, timeoutMs: 30_000 };

export interface OperatorOptions {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly useCases: readonly ClassRef[];
  readonly requiresApproval?: readonly ClassRef[];
  readonly limits?: Partial<OperatorLimits>;
  readonly model?: string;
}

export function Operator(options: OperatorOptions): ClassDecorator {
  const source = captureSource();
  return (target) => {
    activeRegistry().operators.push({
      target,
      name: options.name,
      description: options.description,
      instructions: options.instructions,
      useCases: options.useCases,
      requiresApproval: options.requiresApproval ?? [],
      limits: { ...DEFAULT_LIMITS, ...options.limits },
      model: options.model ?? 'default',
      source,
    });
  };
}
