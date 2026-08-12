import type {
  CommercialCollection,
  CommercialCollectionTypes,
  CommercialStore,
} from '@spiderbyte/commercial-ports';

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryCommercialStore implements CommercialStore {
  private readonly collections = new Map<CommercialCollection, Map<string, unknown>>();
  private queue: Promise<void> = Promise.resolve();

  async get<K extends CommercialCollection>(
    collection: K,
    id: string,
  ): Promise<CommercialCollectionTypes[K] | undefined> {
    const value = this.collections.get(collection)?.get(id);
    return value === undefined ? undefined : clone(value as CommercialCollectionTypes[K]);
  }

  async list<K extends CommercialCollection>(collection: K): Promise<readonly CommercialCollectionTypes[K][]> {
    return [...(this.collections.get(collection)?.values() ?? [])].map((value) =>
      clone(value as CommercialCollectionTypes[K]),
    );
  }

  async put<K extends CommercialCollection>(
    collection: K,
    id: string,
    value: CommercialCollectionTypes[K],
  ): Promise<void> {
    let values = this.collections.get(collection);
    if (values === undefined) {
      values = new Map();
      this.collections.set(collection, values);
    }
    values.set(id, clone(value));
  }

  async delete(collection: CommercialCollection, id: string): Promise<void> {
    this.collections.get(collection)?.delete(id);
  }

  async transaction<T>(operation: (store: CommercialStore) => Promise<T>): Promise<T> {
    let release: (() => void) | undefined;
    const previous = this.queue;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const snapshot = new Map<CommercialCollection, Map<string, unknown>>(
      [...this.collections.entries()].map(([collection, values]) => [collection, new Map(values)]),
    );
    try {
      return await operation(this);
    } catch (error) {
      this.collections.clear();
      for (const [collection, values] of snapshot) this.collections.set(collection, values);
      throw error;
    } finally {
      release?.();
    }
  }
}
