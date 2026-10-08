export interface Repository<T, Id> {
  findById(id: Id): Promise<T | null>;
  save(aggregate: T): Promise<void>;
}
