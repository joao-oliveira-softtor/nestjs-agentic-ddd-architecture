import { resolve } from 'node:path';
import { createRegistry, type Registry } from '@agentic-ddd/decorators';

const KEYS = [
  'entities',
  'valueObjects',
  'invariants',
  'methods',
  'events',
  'ports',
  'adapters',
  'useCases',
  'operators',
] as const;

export type RegistrySizes = Record<(typeof KEYS)[number], number>;

export function registrySizes(registry: Registry): RegistrySizes {
  return {
    entities: registry.entities.length,
    valueObjects: registry.valueObjects.length,
    invariants: registry.invariants.length,
    methods: registry.methods.length,
    events: registry.events.length,
    ports: registry.ports.length,
    adapters: registry.adapters.length,
    useCases: registry.useCases.length,
    operators: registry.operators.length,
  };
}

/**
 * Registry with only what belongs to this configuration: records whose source file
 * was imported by it, and records added since `before` (new transitive imports, which
 * must still raise the "outside the modules" error).
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
