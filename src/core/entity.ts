export abstract class Entity<Id> {
  protected constructor(readonly id: Id) {}

  /**
   * Mesma classe e mesmo id, comparado com `===`. Vale para ids primitivos.
   * Se o id for um `ValueObject`, duas instâncias iguais por valor mas
   * distintas na memória não são iguais; compare `a.id.equals(b.id)`.
   * Alternativa em avaliação: `docs/adr/ADR-0002.md` (proposto).
   */
  equals(other: Entity<Id> | null | undefined): boolean {
    return (
      other != null &&
      other.constructor === this.constructor &&
      other.id === this.id
    );
  }
}
