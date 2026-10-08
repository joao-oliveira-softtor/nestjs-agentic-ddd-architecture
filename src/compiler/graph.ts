import { byId } from './canonical';
import type { IR } from './ir';

export type Layer = 'domain' | 'application' | 'operators';

export interface WorkItem {
  readonly id: string;
  readonly layer: Layer;
  readonly module: string;
  readonly source: string;
  readonly dependsOn: string[];
  readonly obligations: string[];
}

export function itemOfMethod(ir: IR, methodId: string): string {
  for (const entity of ir.entities) {
    const method = entity.methods.find((m) => m.id === methodId);
    if (method) return method.static ? entity.id : method.id;
  }
  return methodId;
}

export function workItems(ir: IR): WorkItem[] {
  const items: WorkItem[] = [];
  for (const entity of ir.entities) {
    const statics = new Set(
      entity.methods.filter((m) => m.static).map((m) => m.id),
    );
    const ownedByEntity = entity.invariants
      .filter((i) => i.on === null || statics.has(i.on))
      .map((i) => i.id);
    items.push({
      id: entity.id,
      layer: 'domain',
      module: entity.module,
      source: entity.source,
      dependsOn: [],
      obligations: [...ownedByEntity, ...statics].sort(),
    });
    for (const method of entity.methods.filter((m) => !m.static)) {
      items.push({
        id: method.id,
        layer: 'domain',
        module: entity.module,
        source: method.source,
        dependsOn: [entity.id],
        obligations: [
          method.id,
          ...entity.invariants
            .filter((i) => i.on === method.id)
            .map((i) => i.id),
        ].sort(),
      });
    }
  }
  for (const useCase of ir.useCases) {
    items.push({
      id: useCase.id,
      layer: 'application',
      module: useCase.module,
      source: useCase.source,
      dependsOn: [
        ...new Set(useCase.uses.map((m) => itemOfMethod(ir, m))),
      ].sort(),
      obligations: [useCase.id],
    });
  }
  for (const operator of ir.operators) {
    items.push({
      id: operator.id,
      layer: 'operators',
      module: operator.module,
      source: operator.source,
      dependsOn: [...operator.useCases],
      obligations: [operator.id],
    });
  }
  return items.sort(byId);
}
