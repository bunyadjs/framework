import type { Dialect, DriverName } from "./dialect.ts";
import {
  captureCallSite,
  fireQueryExecuted,
  hasQueryListeners,
  wantsCallSites,
} from "./query-listen.ts";

/** Normalize driver write results to an affected-row count. */
export function affectedRowsFromResult(result: unknown): number {
  if (result == null || typeof result !== "object") return 0;
  const row = result as Record<string, unknown>;
  // MySQL via Bun reports `count: 0` (rows returned) next to the real `affectedRows`.
  if (typeof row.affectedRows === "number") return row.affectedRows;
  if (typeof row.count === "number") return row.count;
  if (typeof row.changes === "number") return row.changes;
  if (typeof row.rowCount === "number") return row.rowCount;
  const batches = row.rowsAffected;
  if (Array.isArray(batches)) {
    let total = 0;
    for (const n of batches) total += Number(n) || 0;
    return total;
  }
  if (typeof batches === "number") return batches;
  return 0;
}

/** Config/PDO driver name (`pgsql` for Postgres). */
export function driverNameOf(driver: DriverName): string {
  return driver === "postgres" ? "pgsql" : driver;
}

export type ConnectionIdentity = {
  database?: string;
  config?: Record<string, unknown>;
};

type ConnectionCore = Omit<
  Connection,
  | "getDriverName"
  | "getName"
  | "setName"
  | "getDatabaseName"
  | "getConfig"
  | "getPdo"
>;

/** The INSERT a `insertGetId*` call issues (for query listeners; the driver builds its own text). */
function insertSql(table: string, columns: string[]): string {
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
}

/** Attach `getDriverName` / `getName` / `getDatabaseName` / `getConfig` / `getPdo`. */
export function attachConnectionContract(
  core: ConnectionCore,
  identity: ConnectionIdentity = {},
): Connection {
  const state = {
    name: "default",
    database: identity.database ?? "",
    config: {
      driver: driverNameOf(core.driver),
      database: identity.database ?? "",
      ...identity.config,
    } as Record<string, unknown>,
  };

  const timed =
    <A extends unknown[], R>(
      method: string,
      fn: ((...args: A) => R) | undefined,
      sqlOf: (...args: A) => string,
      bindingsOf: (...args: A) => unknown[],
    ): ((...args: A) => R) | undefined => {
      if (!fn) return undefined;
      return ((...args: A): R => {
        if (!hasQueryListeners()) return fn(...args);
        const sql = sqlOf(...args);
        const bindings = bindingsOf(...args);
        // Captured here, as the query is issued: when it finishes, an async driver's stack is gone.
        const callSite = wantsCallSites() ? captureCallSite() : undefined;
        const start = performance.now();
        const finish = () => {
          fireQueryExecuted({
            sql,
            bindings,
            timeMs: performance.now() - start,
            connection,
            ...(callSite !== undefined ? { callSite } : {}),
          });
        };
        try {
          const result = fn(...args);
          if (result instanceof Promise) {
            return result.then(
              (value) => {
                finish();
                return value;
              },
              (error) => {
                finish();
                throw error;
              },
            ) as R;
          }
          finish();
          return result;
        } catch (error) {
          finish();
          throw error;
        }
      }) as (...args: A) => R;
    };

  const coreStream = core.stream?.bind(core);
  const stream = coreStream
    ? async function* (
        sql: string,
        params: unknown[] = [],
        options?: StreamOptions,
      ): AsyncGenerator<Record<string, unknown>, void, unknown> {
        const listening = hasQueryListeners();
        const callSite = listening && wantsCallSites() ? captureCallSite() : undefined;
        const start = performance.now();
        try {
          yield* coreStream(sql, params, options);
        } finally {
          if (listening) {
            fireQueryExecuted({
              sql,
              bindings: params,
              timeMs: performance.now() - start,
              connection,
              ...(callSite !== undefined ? { callSite } : {}),
            });
          }
        }
      }
    : undefined;

  const connection = {
    ...core,
    stream,
    getDriverName() {
      return driverNameOf(core.driver);
    },
    getName() {
      return state.name;
    },
    setName(name: string) {
      state.name = name;
      return connection;
    },
    getDatabaseName() {
      return state.database;
    },
    getConfig(option?: string) {
      if (option == null || option === "") {
        return { ...state.config };
      }
      return state.config[option];
    },
    getPdo() {
      return core.raw;
    },
    run: timed(
      "run",
      core.run.bind(core),
      (sql: string) => sql,
      (_sql: string, params: unknown[] = []) => params,
    )!,
    get: timed(
      "get",
      core.get.bind(core),
      (sql: string) => sql,
      (_sql: string, params: unknown[] = []) => params,
    )!,
    all: timed(
      "all",
      core.all.bind(core),
      (sql: string) => sql,
      (_sql: string, params: unknown[] = []) => params,
    )!,
    exec: timed(
      "exec",
      core.exec.bind(core),
      (sql: string) => sql,
      () => [],
    )!,
    runSync: timed(
      "runSync",
      core.runSync?.bind(core),
      (sql: string) => sql,
      (_sql: string, params: unknown[] = []) => params,
    ),
    getSync: timed(
      "getSync",
      core.getSync?.bind(core),
      (sql: string) => sql,
      (_sql: string, params: unknown[] = []) => params,
    ),
    allSync: timed(
      "allSync",
      core.allSync?.bind(core),
      (sql: string) => sql,
      (_sql: string, params: unknown[] = []) => params,
    ),
    // These used to bypass the listener, so model finds (SQLite) and model inserts
    // (every driver) never showed up in the debugbar, slow-query logs or query counts.
    getSync1: timed(
      "getSync1",
      core.getSync1?.bind(core),
      (sql: string, _value: unknown) => sql,
      (_sql: string, value: unknown) => [value],
    ),
    insertGetId: timed(
      "insertGetId",
      core.insertGetId.bind(core),
      (table: string, columns: string[], _values: unknown[], _idColumn?: string) => insertSql(table, columns),
      (_table: string, _columns: string[], values: unknown[], _idColumn?: string) => values,
    )!,
    insertGetIdSync: timed(
      "insertGetIdSync",
      core.insertGetIdSync?.bind(core),
      (table: string, columns: string[], _values: unknown[], _idColumn?: string) => insertSql(table, columns),
      (_table: string, _columns: string[], values: unknown[], _idColumn?: string) => values,
    ),
    insertGetIdSync1: timed(
      "insertGetIdSync1",
      core.insertGetIdSync1?.bind(core),
      (table: string, column: string, _value: unknown) => insertSql(table, [column]),
      (_table: string, _column: string, value: unknown) => [value],
    ),
  } as Connection;
  return connection;
}


export type StreamOptions = {
  /** Rows fetched per round trip by cursor-based drivers (default 1000). */
  chunkSize?: number;
};

export type Connection = {
  readonly driver: DriverName;
  readonly dialect: Dialect;
  /** Native handle — BunSqlite, Bun SQL, or mssql ConnectionPool. */
  readonly raw: unknown;
  /** Config/PDO driver name (`pgsql`, `sqlite`, `mysql`, `mariadb`, `sqlsrv`). */
  getDriverName(): string;
  /** Named connection key (`default`, `analytics`, …). */
  getName(): string;
  setName(name: string): Connection;
  /** Database name, or SQLite file path. */
  getDatabaseName(): string;
  getConfig(): Record<string, unknown>;
  getConfig(option: string): unknown;
  /** Native driver handle. */
  getPdo(): unknown;
  run(sql: string, params?: unknown[]): Promise<number>;
  get<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T | null>;
  all<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
  /**
   * Sync row fetch when the driver supports it (SQLite). Used to avoid
   * Promise microtasks on the hot ORM path.
   */
  getSync?<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): T | null;
  /** Sync single-bind fetch (SQLite) — avoids a params-array allocation. */
  getSync1?<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    value: unknown,
  ): T | null;
  /** Sync multi-row fetch when the driver supports it (SQLite). */
  allSync?<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): T[];
  /**
   * Stream rows from a single query without buffering the result set
   * (`Query::cursor()`). Optional: only drivers with a real streaming primitive
   * implement it (SQLite, Postgres, Node MySQL); callers fall back to chunked
   * pagination when it is absent. Abandoning the iterator early releases the
   * underlying statement / cursor / connection.
   */
  stream?<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
    options?: StreamOptions,
  ): AsyncGenerator<T, void, unknown>;
  exec(sql: string): Promise<void>;
  /**
   * Run INSERT and return the new primary key.
   * Postgres/SQL Server use RETURNING/OUTPUT; MySQL/MariaDB use lastInsertRowid;
   * SQLite uses the statement `lastInsertRowid`.
   */
  insertGetId(
    table: string,
    columns: string[],
    values: unknown[],
    idColumn?: string,
  ): Promise<number>;
  /** Sync INSERT+id when the driver supports it (SQLite). */
  insertGetIdSync?(
    table: string,
    columns: string[],
    values: unknown[],
    idColumn?: string,
  ): number;
  /** Sync single-column INSERT+id (SQLite) — avoids a values-array allocation. */
  insertGetIdSync1?(table: string, column: string, value: unknown): number;
  /** Sync write when the driver supports it (SQLite). */
  runSync?(sql: string, params?: unknown[]): number;
  close(): Promise<void>;
  /**
   * Run a callback inside a transaction.
   * Optional `attempts` retries on deadlock-like errors (outermost only).
   */
  transaction<T>(
    callback: () => T | Promise<T>,
    attempts?: number,
  ): Promise<T>;
  /** `beginTransaction` — nests with savepoints when already in a transaction. */
  beginTransaction(): Promise<void>;
  /** `commit` — releases savepoint or commits outermost. */
  commit(): Promise<void>;
  /** `rollBack` — rolls back savepoint or outermost transaction. */
  rollBack(): Promise<void>;
  /** Queue work to run after a successful transaction commit. */
  afterCommit(callback: () => void | Promise<void>): void;
};

export type SqliteOptions = {
  path?: string;
};

export type PostgresOptions = {
  url?: string;
  hostname?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  max?: number;
};

export type MysqlOptions = {
  url?: string;
  hostname?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  max?: number;
  /** Enable TLS. MySQL 8+ `caching_sha2_password` needs TLS (or a socket) on first login. */
  tls?: boolean | { rejectUnauthorized?: boolean };
};

export type MariadbOptions = MysqlOptions;

export type SqlsrvOptions = {
  url?: string;
  hostname?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
  max?: number;
};

/** Host overrides for read / write replicas (merged onto the root config). */
export type ReplicaHostConfig = {
  url?: string;
  hostname?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  path?: string;
  max?: number;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
};

export type ReadWriteConfig = {
  /** Read replica host(s). When set, SELECT routes here unless sticky. */
  read?: ReplicaHostConfig | ReplicaHostConfig[];
  /** Write host(s). Defaults to the root config when omitted. */
  write?: ReplicaHostConfig | ReplicaHostConfig[];
  /**
   * After a write in the current async context, force reads onto the write
   * connection (default true when `read` is configured).
   */
  sticky?: boolean;
};

export type DatabaseConfigBase =
  | ({ driver: "sqlite" } & SqliteOptions)
  | ({ driver: "postgres" | "pgsql" } & PostgresOptions)
  | ({ driver: "mysql" } & MysqlOptions)
  | ({ driver: "mariadb" } & MariadbOptions)
  | ({ driver: "sqlsrv" } & SqlsrvOptions);

export type DatabaseConfig = DatabaseConfigBase & ReadWriteConfig;

/** Resolve database name from options or URL path. */
export function databaseNameFromOptions(
  options: { url?: string; database?: string },
  fallback: string,
): string {
  if (options.database) {
    return options.database;
  }
  if (options.url) {
    try {
      return (
        decodeURIComponent(new URL(options.url).pathname.replace(/^\//, "")) ||
        fallback
      );
    } catch {
      return fallback;
    }
  }
  return fallback;
}
