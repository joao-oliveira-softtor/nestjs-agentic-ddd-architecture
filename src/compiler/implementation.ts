import type { Registry } from '@agentic-ddd/decorators';
import type { IR } from './ir';

const implemented = (fn: unknown): boolean =>
  typeof fn === 'function' &&
  !/\bnotImplemented\(\)/.test(Function.prototype.toString.call(fn));

/** Runtime signal only: never serialized into the domain IR. */
export function implementation(
  ir: IR,
  registry: Registry,
): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const entity of ir.entities) {
    const methods = registry.methods.filter(
      (m) => m.entity.name === entity.name,
    );
    result.set(
      entity.id,
      methods.filter((m) => m.isStatic).every((m) => implemented(m.fn)),
    );
    for (const method of methods.filter((m) => !m.isStatic))
      result.set(
        `method:${entity.name}.${method.name}`,
        implemented(method.fn),
      );
  }
  for (const useCase of registry.useCases)
    result.set(
      `usecase:${useCase.name}`,
      implemented(useCase.target.prototype.execute),
    );
  for (const operator of ir.operators) result.set(operator.id, true);
  return result;
}
