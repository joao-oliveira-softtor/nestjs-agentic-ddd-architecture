/** Camadas com pasta própria dentro de cada módulo. */
export type ConventionLayer = 'domain' | 'application' | 'operators';

/** Destinos que domain e application podem proibir de importar. */
export type ImportTarget = 'application' | 'operators' | 'infrastructure';

export interface ConventionsConfig {
  readonly layers?: Partial<Record<ConventionLayer, string>>;
  readonly suffixes?: { readonly events?: string; readonly operator?: string };
  readonly infrastructure?: readonly string[];
  readonly forbiddenImports?: Partial<
    Record<'domain' | 'application', readonly ImportTarget[]>
  >;
}

export interface ResolvedConventions {
  readonly layers: Readonly<Record<ConventionLayer, string>>;
  readonly suffixes: { readonly events: string; readonly operator: string };
  readonly infrastructure: readonly string[];
  readonly forbiddenImports: Readonly<
    Record<'domain' | 'application', readonly ImportTarget[]>
  >;
}

export const DEFAULT_CONVENTIONS: ResolvedConventions = {
  layers: {
    domain: 'domain',
    application: 'application',
    operators: 'operators',
  },
  suffixes: { events: '.events.ts', operator: '.operator.ts' },
  infrastructure: ['infrastructure', 'infra'],
  forbiddenImports: {
    domain: ['application', 'operators', 'infrastructure'],
    application: ['operators', 'infrastructure'],
  },
};

const isStrings = (x: unknown): x is string[] =>
  Array.isArray(x) && x.every((v) => typeof v === 'string');

/** Shape check for conventions read back from a snapshot or a published lock (not the config rules). */
export function isResolvedConventions(x: unknown): x is ResolvedConventions {
  const o = x as Record<string, Record<string, unknown>> | null;
  if (o === null || typeof o !== 'object') return false;
  const { layers, suffixes, forbiddenImports } = o;
  const isObject = (v: unknown) => v !== null && typeof v === 'object';
  return (
    isObject(layers) &&
    ['domain', 'application', 'operators'].every(
      (k) => typeof layers![k] === 'string',
    ) &&
    isObject(suffixes) &&
    typeof suffixes!.events === 'string' &&
    typeof suffixes!.operator === 'string' &&
    isStrings(o.infrastructure) &&
    isObject(forbiddenImports) &&
    isStrings(forbiddenImports!.domain) &&
    isStrings(forbiddenImports!.application)
  );
}
