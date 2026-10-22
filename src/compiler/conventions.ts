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
