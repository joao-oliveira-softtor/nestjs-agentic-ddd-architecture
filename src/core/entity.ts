import { ValueObject } from './value-object';

export abstract class Entity<Id> {
  protected constructor(readonly id: Id) {}

  /**
   * Mesma classe e mesmo id. Se os dois ids são `ValueObject`, a comparação é
   * por valor (`ValueObject.equals`); nos demais casos, com `===`.
   * Limites (`docs/adr/ADR-0002.md`): ids que são objetos simples (`{ a, b }`)
   * ou `Date` seguem comparados por referência, e duas cópias do core no mesmo
   * processo fazem o `instanceof` falhar e voltam ao `===` sem erro.
   */
  equals(other: Entity<Id> | null | undefined): boolean {
    if (other == null || other.constructor !== this.constructor) return false;
    return this.id instanceof ValueObject && other.id instanceof ValueObject
      ? this.id.equals(other.id)
      : other.id === this.id;
  }
}
