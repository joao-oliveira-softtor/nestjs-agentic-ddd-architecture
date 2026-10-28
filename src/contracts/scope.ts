import { relative, resolve } from 'node:path';
import { Registry } from '@agentic-ddd/decorators';
import { canonicalPath, toPosix, type IRModule } from './ir';

/** Isolates declarations by the compiler's complete module paths (no imports/I/O). */
export function declarationsInModules(
  registry: Registry,
  root: string,
  modules: readonly IRModule[],
): Registry {
  const scoped = new Registry();
  root = canonicalPath(root);
  for (const key of [
    'entities',
    'valueObjects',
    'invariants',
    'methods',
    'events',
    'ports',
    'adapters',
    'useCases',
    'operators',
  ] as const) {
    (scoped[key] as unknown[]).push(
      ...registry[key].filter((record) => {
        const file = toPosix(relative(root, canonicalPath(record.source.file)));
        return modules.some((module) => {
          const path = toPosix(relative(root, resolve(root, module.path)));
          return file === path || file.startsWith(`${path}/`);
        });
      }),
    );
  }
  return scoped;
}
