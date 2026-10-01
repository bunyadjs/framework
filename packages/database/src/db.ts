import type { Connection } from "./connection.ts";
import { DatabaseManager, QueryBuilder } from "./query-builder.ts";
import {
  connections,
  withTable,
  type ConnectionWithQuery,
} from "./database-manager.ts";
import { listen as listenQueries, type QueryExecutedListener } from "./query-listen.ts";

/**
 * Register the default connection (also used by the ORM).
 */
export function setDefaultConnection(
  connection: Connection,
  name = "default",
): void {
  connections.addConnection(name, connection);
  connections.setDefaultConnection(name);
}

export function getDefaultConnection(): Connection {
  return connections.connection();
}

/**
 * `DB` facade — query builder and connection helpers.
 */
export const DB = {
  /**
   * `DB.connection()` / `DB.connection('analytics')`.
   * Return value supports `.table()` like a query connection.
   */
  connection(name?: string): ConnectionWithQuery {
    return withTable(connections.connection(name));
  },

  /** Register a named connection. */
  addConnection(name: string, connection: Connection): void {
    connections.addConnection(name, connection);
  },

  /** Register a lazy named connection (opened on first use). */
  addConnectionResolver(name: string, factory: () => Connection): void {
    connections.addConnectionResolver(name, factory);
  },

  /** Set which named connection is the default. */
  setDefaultConnection(name: string): void {
    connections.setDefaultConnection(name);
  },

  /** `DB.table()`. */
  table(name: string): QueryBuilder {
    return new DatabaseManager(getDefaultConnection()).table(name);
  },

  /** `DB.getDriverName()`. */
  getDriverName(): string {
    return getDefaultConnection().getDriverName();
  },

  /** `DB.getName()`. */
  getName(): string {
    return getDefaultConnection().getName();
  },

  /** `DB.getDatabaseName()`. */
  getDatabaseName(): string {
    return getDefaultConnection().getDatabaseName();
  },

  /** `DB.getConfig()` / `DB.getConfig('driver')`. */
  getConfig(option?: string): unknown {
    const connection = getDefaultConnection();
    if (option == null || option === "") {
      return connection.getConfig();
    }
    return connection.getConfig(option);
  },

  /** `DB.getPdo()` — native driver handle. */
  getPdo(): unknown {
    return getDefaultConnection().getPdo();
  },

  /** `DB.select($query, $bindings)`. */
  async select<T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    bindings: unknown[] = [],
  ): Promise<T[]> {
    return getDefaultConnection().all<T>(query, bindings);
  },

  /** `DB.selectOne($query, $bindings)`. */
  async selectOne<T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    bindings: unknown[] = [],
  ): Promise<T | null> {
    return getDefaultConnection().get<T>(query, bindings);
  },

  /**
   * `DB.scalar($query, $bindings)` — first column of the first row.
   */
  async scalar(query: string, bindings: unknown[] = []): Promise<unknown> {
    const row = await getDefaultConnection().get<Record<string, unknown>>(
      query,
      bindings,
    );
    if (!row) return null;
    const values = Object.values(row);
    return values.length > 0 ? values[0] : null;
  },

  /** `DB.insert` via a raw statement. Returns affected rows. */
  async insert(query: string, bindings: unknown[] = []): Promise<number> {
    return getDefaultConnection().run(query, bindings);
  },

  /** `DB.update($query, $bindings)`. Returns affected rows. */
  async update(query: string, bindings: unknown[] = []): Promise<number> {
    return getDefaultConnection().run(query, bindings);
  },

  /** `DB.delete($query, $bindings)`. Returns affected rows. */
  async delete(query: string, bindings: unknown[] = []): Promise<number> {
    return getDefaultConnection().run(query, bindings);
  },

  /** `DB.statement($query, $bindings)`. */
  async statement(query: string, bindings: unknown[] = []): Promise<void> {
    if (bindings.length === 0) {
      await getDefaultConnection().exec(query);
      return;
    }
    await getDefaultConnection().run(query, bindings);
  },

  /** `DB.unprepared($query)`. */
  async unprepared(query: string): Promise<void> {
    await getDefaultConnection().exec(query);
  },

  /**
   * `DB.transaction()`.
   * Pass `attempts` to retry the whole transaction on deadlock-like errors.
   */
  async transaction<T>(
    callback: () => T | Promise<T>,
    attempts = 1,
  ): Promise<T> {
    return getDefaultConnection().transaction(callback, attempts);
  },

  /** `DB.afterCommit()` — run after the active transaction commits (or immediately). */
  afterCommit(callback: () => void | Promise<void>): void {
    getDefaultConnection().afterCommit(callback);
  },

  /** `DB.beginTransaction()` — nests with savepoints (same as connection). */
  async beginTransaction(): Promise<void> {
    await getDefaultConnection().beginTransaction();
  },

  /** `DB.commit()`. */
  async commit(): Promise<void> {
    await getDefaultConnection().commit();
  },

  /** `DB.rollBack()`. */
  async rollBack(): Promise<void> {
    await getDefaultConnection().rollBack();
  },

  /** Close and forget named connection(s). */
  async disconnect(name?: string): Promise<void> {
    await connections.disconnect(name);
  },

  /** Drop cached connection(s) without closing. */
  purge(name?: string): void {
    connections.purge(name);
  },

  /**
   * Thin query timing hook (not full enableQueryLog).
   * Fires for connection run/get/all/exec (and sync variants).
   * Returns unsubscribe.
   */
  listen(callback: QueryExecutedListener): () => void {
    return listenQueries(callback);
  },
};
