import type { Registry } from '@agentic-ddd/decorators';
import {
  buildIR,
  type CompileError,
  type IRBuildOptions,
  type IRBuildResult,
} from './ir';
import { compareStrings } from './canonical';
import { validate } from './validate';

function errorKey(error: CompileError): string {
  return `${error.source ?? ''}|${error.message}`;
}

export function analyze(
  registry: Registry,
  options: IRBuildOptions,
): IRBuildResult {
  const built = buildIR(registry, options);
  const errors = [
    ...built.errors,
    ...validate(built.ir, registry, options.root),
  ].sort((a, b) => compareStrings(errorKey(a), errorKey(b)));
  return { ir: built.ir, errors };
}
