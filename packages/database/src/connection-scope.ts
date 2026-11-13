import { AsyncLocalStorage } from "node:async_hooks";
import type { Connection } from "./connection.ts";

const storage = new AsyncLocalStorage<Connection>();

/**
 * Connection chosen for this async stack by `usingConnection`, if any.
 * Queries that name no connection use it instead of the process default.
 */
export function scopedConnection(): Connection | undefined {
  return storage.getStore();
}

/**
 * Run `callback` with `connection` as the default for everything started inside it
 * (models, `DB.table()`, transactions). Other requests running at the same time keep
 * the process default. A connection named explicitly (`DB.connection('x')`,
 * `Model.on('x')`) still wins.
 */
export function usingConnection<T>(
  connection: Connection,
  callback: () => T,
): T {
  return storage.run(connection, callback);
}
