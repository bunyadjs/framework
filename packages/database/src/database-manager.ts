import type { Connection } from "./connection.ts";
import { QueryBuilder } from "./query-builder.ts";

/**
 * Named database connections (`DB.connection('analytics')`).
 * Resolvers open a connection on first use so unused drivers are not contacted.
 */
export class ConnectionManager {
  #default = "default";
  #connections = new Map<string, Connection>();
  #resolvers = new Map<string, () => Connection>();

  /** Active default connection name. */
  getDefaultConnection(): string {
    return this.#default;
  }

  setDefaultConnection(name: string): this {
    this.#default = name;
    return this;
  }

  /** Register a connection under a name. */
  addConnection(name: string, connection: Connection): this {
    connection.setName(name);
    this.#connections.set(name, connection);
    this.#resolvers.delete(name);
    return this;
  }

  /** Register a lazy connection factory (opened on first `connection(name)`). */
  addConnectionResolver(name: string, factory: () => Connection): this {
    this.#resolvers.set(name, factory);
    this.#connections.delete(name);
    return this;
  }

  /** Whether a named connection is registered (open or resolvable). */
  hasConnection(name: string): boolean {
    return this.#connections.has(name) || this.#resolvers.has(name);
  }

  /**
   * Resolve a connection by name (default when omitted).
   */
  connection(name?: string): Connection {
    const key = name ?? this.#default;
    const existing = this.#connections.get(key);
    if (existing) return existing;

    const factory = this.#resolvers.get(key);
    if (factory) {
      const conn = factory();
      conn.setName(key);
      this.#connections.set(key, conn);
      return conn;
    }

    throw new Error(`Database connection [${key}] not configured.`);
  }

  /** Drop a cached connection handle (does not close). Resolvers remain. */
  purge(name?: string): void {
    if (name === undefined) {
      this.#connections.clear();
      return;
    }
    this.#connections.delete(name);
  }

  /** Close and remove connection(s). Resolvers remain for reconnection. */
  async disconnect(name?: string): Promise<void> {
    if (name === undefined) {
      for (const conn of this.#connections.values()) {
        await conn.close();
      }
      this.#connections.clear();
      return;
    }
    const conn = this.#connections.get(name);
    if (conn) {
      await conn.close();
      this.#connections.delete(name);
    }
  }
}

export type ConnectionWithQuery = Connection & {
  table(name: string): QueryBuilder;
};

/** Attach `table()` so `DB.connection('x').table('y')` works. */
export function withTable(connection: Connection): ConnectionWithQuery {
  const wrapped = connection as ConnectionWithQuery;
  if (typeof wrapped.table !== "function") {
    wrapped.table = (name: string) => new QueryBuilder(connection, name);
  }
  return wrapped;
}

export const connections = new ConnectionManager();
