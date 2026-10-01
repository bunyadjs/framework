import { AsyncLocalStorage } from "node:async_hooks";

export type AfterCommitCallback = () => void | Promise<void>;

/** Driver-reserved client handle (Bun ReservedSQL, Node pg Client, …). */
export type ReservedClient = unknown;

export type TransactionStore = {
  id: string;
  depthByKey: WeakMap<object, number>;
  reservedByKey: WeakMap<object, ReservedClient>;
  afterCommit: AfterCommitCallback[][];
};

const storage = new AsyncLocalStorage<TransactionStore>();

function newStore(): TransactionStore {
  return {
    id: crypto.randomUUID(),
    depthByKey: new WeakMap(),
    reservedByKey: new WeakMap(),
    afterCommit: [],
  };
}

/** Id of the outermost `connection.transaction()` on this async stack. */
export function currentTransactionId(): string | null {
  return storage.getStore()?.id ?? null;
}

export function transactionStore(): TransactionStore | undefined {
  return storage.getStore();
}

/** Create an async-local store when manual begin/commit runs outside `transaction()`. */
export function ensureTransactionStore(): TransactionStore {
  const existing = storage.getStore();
  if (existing) return existing;
  const store = newStore();
  storage.enterWith(store);
  return store;
}

/**
 * Nested calls on the same connection reuse the outer store.
 * Top-level calls get an isolated store so concurrent HTTP work does not share depth.
 */
export async function withTransactionStore<T>(
  connectionKey: object,
  callback: () => T | Promise<T>,
): Promise<T> {
  const existing = storage.getStore();
  if (existing && (existing.depthByKey.get(connectionKey) ?? 0) > 0) {
    return await callback();
  }
  return await storage.run(newStore(), async () => callback());
}

/** Run work under a stable transaction id (nested calls reuse the outer id). */
export async function withTransactionId<T>(
  callback: () => T | Promise<T>,
): Promise<T> {
  if (storage.getStore()) return await callback();
  return await storage.run(newStore(), async () => callback());
}

export function txDepth(key: object): number {
  return storage.getStore()?.depthByKey.get(key) ?? 0;
}

export function setTxDepth(key: object, depth: number): void {
  const store = ensureTransactionStore();
  if (depth <= 0) {
    store.depthByKey.delete(key);
    return;
  }
  store.depthByKey.set(key, depth);
}

export function reservedSql(key: object): ReservedClient | undefined {
  return storage.getStore()?.reservedByKey.get(key);
}

export function setReservedSql(
  key: object,
  client: ReservedClient | null,
): void {
  const store = storage.getStore();
  if (!store) return;
  if (client) store.reservedByKey.set(key, client);
  else store.reservedByKey.delete(key);
}
