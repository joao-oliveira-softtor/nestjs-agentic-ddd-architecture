import type { Registry } from '@agentic-ddd/decorators';
import { buildIR, type CompileError, type IRBuildOptions, type IRBuildResult } from './ir.js';
import { validate } from './validate.js';

function errorKey(error: CompileError): string {
  return `${error.source ?? ''}|${error.message}`;
}

export function analyze(registry: Registry, options: IRBuildOptions): IRBuildResult {
  const built = buildIR(registry, options);
  const errors = [...built.errors, ...validate(built.ir, registry, options.root)].sort((a, b) =>
    errorKey(a) < errorKey(b) ? -1 : errorKey(a) > errorKey(b) ? 1 : 0,
  );
  return { ir: built.ir, errors };
}
