/**
 * Read / write connection proxy with optional sticky reads after a write.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Connection } from "./connection.ts";

export type ReadWriteConnectionOptions = {
  /** After a write, use the write connection for subsequent reads (default true). */
  sticky?: boolean;
};

type StickyStore = {
  sticky: boolean;
};

const stickyStorage = new AsyncLocalStorage<WeakMap<object, StickyStore>>();

function stickyMap(): WeakMap<object, StickyStore> {
  const existing = stickyStorage.getStore();
  if (existing) return existing;
  const map = new WeakMap<object, StickyStore>();
  stickyStorage.enterWith(map);
  return map;
}

function markSticky(key: object): void {
  stickyMap().set(key, { sticky: true });
}

function isSticky(key: object): boolean {
  return stickyMap().get(key)?.sticky === true;
}

/**
 * Proxy that routes reads to `read` and writes to `write`.
 * When `sticky` is enabled (default), any write in the current async context
 * causes later reads to use `write` as well.
 */
export function createReadWriteConnection(
  write: Connection,
  read: Connection,
  options: ReadWriteConnectionOptions = {},
): Connection {
  const stickyEnabled = options.sticky !== false;
  const key = write;

  const useWriteForRead = (): boolean =>
    stickyEnabled && isSticky(key);

  const forRead = (): Connection =>
    useWriteForRead() ? write : read;

  const forWrite = (): Connection => {
    if (stickyEnabled) markSticky(key);
    return write;
  };

  const connection: Connection = {
    get driver() {
      return write.driver;
    },
    get dialect() {
      return write.dialect;
    },
    get raw() {
      return write.raw;
    },
    getDriverName() {
      return write.getDriverName();
    },
    getName() {
      return write.getName();
    },
    setName(name: string) {
      write.setName(name);
      read.setName(name);
      return connection;
    },
    getDatabaseName() {
      return write.getDatabaseName();
    },
    getConfig: ((option?: string) => {
      if (option == null || option === "") {
        return write.getConfig();
      }
      return write.getConfig(option);
    }) as Connection["getConfig"],
    getPdo() {
      return write.getPdo();
    },
    async run(sql, params) {
      return forWrite().run(sql, params);
    },
    async get(sql, params) {
      return forRead().get(sql, params);
    },
    async all(sql, params) {
      return forRead().all(sql, params);
    },
    getSync(sql, params) {
      const target = forRead();
      if (!target.getSync) {
        throw new Error("getSync is not supported on this connection.");
      }
      return target.getSync(sql, params);
    },
    getSync1(sql, value) {
      const target = forRead();
      if (!target.getSync1) {
        throw new Error("getSync1 is not supported on this connection.");
      }
      return target.getSync1(sql, value);
    },
    allSync(sql, params) {
      const target = forRead();
      if (!target.allSync) {
        throw new Error("allSync is not supported on this connection.");
      }
      return target.allSync(sql, params);
    },
    stream:
      read.stream && write.stream
        ? (async function* (sql, params, options) {
            yield* forRead().stream!(sql, params, options);
          } as NonNullable<Connection["stream"]>)
        : undefined,
    async exec(sql) {
      return forWrite().exec(sql);
    },
    async insertGetId(table, columns, values, idColumn) {
      return forWrite().insertGetId(table, columns, values, idColumn);
    },
    insertGetIdSync(table, columns, values, idColumn) {
      const target = forWrite();
      if (!target.insertGetIdSync) {
        throw new Error("insertGetIdSync is not supported on this connection.");
      }
      return target.insertGetIdSync(table, columns, values, idColumn);
    },
    insertGetIdSync1(table, column, value) {
      const target = forWrite();
      if (!target.insertGetIdSync1) {
        throw new Error("insertGetIdSync1 is not supported on this connection.");
      }
      return target.insertGetIdSync1(table, column, value);
    },
    runSync(sql, params) {
      const target = forWrite();
      if (!target.runSync) {
        throw new Error("runSync is not supported on this connection.");
      }
      return target.runSync(sql, params);
    },
    async close() {
      await Promise.all([write.close(), read.close()]);
    },
    async transaction(callback, attempts) {
      return forWrite().transaction(callback, attempts);
    },
    async beginTransaction() {
      return forWrite().beginTransaction();
    },
    async commit() {
      return write.commit();
    },
    async rollBack() {
      return write.rollBack();
    },
    afterCommit(callback) {
      write.afterCommit(callback);
    },
  };

  return connection;
}

/** Whether the current async context is sticky on this write connection. */
export function isReadWriteSticky(writeConnection: object): boolean {
  return isSticky(writeConnection);
}

/** Clear sticky state for tests. */
export function clearReadWriteStickyForTests(): void {
  stickyStorage.enterWith(new WeakMap());
}
