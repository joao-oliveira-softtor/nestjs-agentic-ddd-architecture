import { relative, resolve } from 'node:path';
import { Registry } from '@agentic-ddd/decorators';
import { toPosix, type IRModule } from './ir';

/** Isolates declarations by the compiler's complete module paths (no imports/I/O). */
export function declarationsInModules(
  registry: Registry,
  root: string,
  modules: readonly IRModule[],
): Registry {
  const scoped = new Registry();
  for (const key of [
    'entities',
    'invariants',
    'methods',
    'events',
    'useCases',
    'operators',
  ] as const) {
    (scoped[key] as unknown[]).push(
      ...registry[key].filter((record) => {
        const file = toPosix(relative(root, record.source.file));
        return modules.some((module) => {
          const path = toPosix(relative(root, resolve(root, module.path)));
          return file === path || file.startsWith(`${path}/`);
        });
      }),
    );
  }
  return scoped;
}
