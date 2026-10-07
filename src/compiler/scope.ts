import { resolve } from 'node:path';
import { createRegistry, type Registry } from '@agentic-ddd/decorators';

const KEYS = [
  'entities',
  'invariants',
  'methods',
  'events',
  'useCases',
  'operators',
] as const;

export type RegistrySizes = Record<(typeof KEYS)[number], number>;

export function registrySizes(registry: Registry): RegistrySizes {
  return {
    entities: registry.entities.length,
    invariants: registry.invariants.length,
    methods: registry.methods.length,
    events: registry.events.length,
    useCases: registry.useCases.length,
    operators: registry.operators.length,
  };
}

/**
 * Registry só com o que pertence a esta configuração: registros cujo arquivo de
 * origem foi importado por ela e registros acrescentados desde `before`
 * (imports transitivos novos, que ainda precisam gerar o erro de "fora dos módulos").
 */
export function scopeRegistry(
  source: Registry,
  files: readonly string[],
  before: RegistrySizes,
): Registry {
  const owned = new Set(files.map((file) => resolve(file)));
  const scoped = createRegistry();
  for (const key of KEYS) {
    const records = source[key] as { source: { file: string } }[];
    (scoped[key] as unknown[]).push(
      ...records.filter(
        (record, index) =>
          index >= before[key] || owned.has(resolve(record.source.file)),
      ),
    );
  }
  return scoped;
}
