export abstract class Entity<Id> {
  protected constructor(readonly id: Id) {}

  equals(other: Entity<Id> | null | undefined): boolean {
    return (
      other != null &&
      other.constructor === this.constructor &&
      other.id === this.id
    );
  }
}
