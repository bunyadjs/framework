import { createRequire } from "node:module";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { dialectFor, wrapSqlName } from "../../dialect.ts";
import { afterCommit } from "../../after-commit.ts";
import { createTransactionApi } from "../../nested-transaction.ts";
import { reservedSql, setReservedSql } from "../../transaction-context.ts";
import {
  QueryException,
  shouldCaptureQueryCallerStack,
} from "../../query-exception.ts";
import { dateTimeForStorage } from "../../dates.ts";
import {
  attachConnectionContract,
  affectedRowsFromResult,
  databaseNameFromOptions,
  type Connection,
  type ConnectionIdentity,
  type MariadbOptions,
  type MysqlOptions,
} from "../../connection-contract.ts";

const require = createRequire(import.meta.url);

type Mysql2Promise = typeof import("mysql2/promise");

/** Fail-fast when the optional `mysql2` peer is not installed. */
export function loadMysql2(): Mysql2Promise {
  try {
    return require("mysql2/promise") as Mysql2Promise;
  } catch (error) {
    const detail =
      error instanceof Error && error.message ? ` (${error.message})` : "";
    throw new Error(
      'Missing optional peer dependency "mysql2". Install it to use the Node MySQL/MariaDB driver: npm install mysql2 / bun add mysql2' +
        detail,
    );
  }
}

/** mysql2 rejects `undefined`; Dates need SQL datetime text. */
function coerceBind(value: unknown, driver: "mysql" | "mariadb"): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) {
    return dateTimeForStorage(value, driver);
  }
  return value;
}

function coerceParams(
  params: unknown[],
  driver: "mysql" | "mariadb",
): unknown[] {
  let changed = false;
  for (let i = 0; i < params.length; i++) {
    const value = params[i];
    if (value === undefined || value instanceof Date) {
      changed = true;
      break;
    }
  }
  if (!changed) return params;
  return params.map((value) => coerceBind(value, driver));
}

type Queryable = {
  execute: (
    sql: string,
    values?: unknown[],
  ) => Promise<[RowDataPacket[] | ResultSetHeader, unknown]>;
  query: (
    sql: string,
    values?: unknown[],
  ) => Promise<[RowDataPacket[] | ResultSetHeader, unknown]>;
};

function createNodeMysqlConnection(
  driver: "mysql" | "mariadb",
  pool: Pool,
  identity: ConnectionIdentity = {},
): Connection {
  const dialect = dialectFor(driver);
  const txKey = {};

  const sqlClient = (): Queryable =>
    ((reservedSql(txKey) as PoolConnection | undefined) ?? pool) as unknown as Queryable;

  const runExecute = async (
    query: string,
    params: unknown[] = [],
  ): Promise<RowDataPacket[] | ResultSetHeader> => {
    const bound = dialect.bindSql(query);
    const values = coerceParams(params, driver);
    const callerStack = shouldCaptureQueryCallerStack()
      ? new Error().stack
      : null;
    try {
      const [result] = await sqlClient().execute(bound, values);
      return result;
    } catch (error) {
      throw QueryException.wrap(error, {
        sql: bound,
        bindings: values,
        callerStack,
      });
    }
  };

  const runQueryText = async (query: string): Promise<void> => {
    const callerStack = shouldCaptureQueryCallerStack()
      ? new Error().stack
      : null;
    try {
      await sqlClient().query(query);
    } catch (error) {
      throw QueryException.wrap(error, {
        sql: query,
        bindings: [],
        callerStack,
      });
    }
  };

  const releaseReserved = (): void => {
    const reserved = reservedSql(txKey) as PoolConnection | undefined;
    setReservedSql(txKey, null);
    reserved?.release();
  };

  const nodeTx = createTransactionApi(
    {
      begin: async () => {
        const client = await pool.getConnection();
        setReservedSql(txKey, client);
        const callerStack = shouldCaptureQueryCallerStack()
          ? new Error().stack
          : null;
        try {
          await client.query("BEGIN");
        } catch (error) {
          releaseReserved();
          throw QueryException.wrap(error, {
            sql: "BEGIN",
            bindings: [],
            callerStack,
          });
        }
      },
      commit: async () => {
        try {
          await runQueryText("COMMIT");
        } finally {
          releaseReserved();
        }
      },
      rollback: async () => {
        try {
          await runQueryText("ROLLBACK");
        } finally {
          releaseReserved();
        }
      },
      savepoint: async (name) => {
        await runQueryText(`SAVEPOINT ${name}`);
      },
      releaseSavepoint: async (name) => {
        await runQueryText(`RELEASE SAVEPOINT ${name}`);
      },
      rollbackToSavepoint: async (name) => {
        await runQueryText(`ROLLBACK TO SAVEPOINT ${name}`);
      },
    },
    txKey,
  );

  return attachConnectionContract(
    {
      driver,
      dialect,
      raw: pool,
      async run(query: string, params: unknown[] = []) {
        const result = await runExecute(query, params);
        return affectedRowsFromResult(result);
      },
      async get<T extends Record<string, unknown> = Record<string, unknown>>(
        query: string,
        params: unknown[] = [],
      ): Promise<T | null> {
        const result = await runExecute(query, params);
        if (!Array.isArray(result)) return null;
        const first = result[0] as T | undefined;
        return first ?? null;
      },
      async all<T extends Record<string, unknown> = Record<string, unknown>>(
        query: string,
        params: unknown[] = [],
      ): Promise<T[]> {
        const result = await runExecute(query, params);
        if (!Array.isArray(result)) return [];
        return result as T[];
      },
      async exec(query: string) {
        await runQueryText(query);
      },
      async insertGetId(table, columns, values, idColumn = "id") {
        void idColumn;
        const placeholders = columns.map(() => "?").join(", ");
        const wrapped = columns.map((c) => wrapSqlName(dialect, c));
        const insertSql = `INSERT INTO ${table} (${wrapped.join(", ")}) VALUES (${placeholders})`;

        if (dialect.insertIdStrategy === "lastInsertRowid") {
          const result = await runExecute(insertSql, values);
          const header = result as ResultSetHeader;
          return Number(header.insertId);
        }

        throw new Error(
          `Node MySQL/MariaDB insertGetId requires dialect insertIdStrategy "lastInsertRowid" (got ${JSON.stringify(dialect.insertIdStrategy)})`,
        );
      },
      /**
       * End the pool. Do not call while a transaction still holds a reserved
       * connection — `pool.end()` waits for release and can hang (same class
       * as Bun SQL / Node Postgres mid-txn close).
       */
      async close() {
        await pool.end();
      },
      afterCommit(callback) {
        afterCommit(callback);
      },
      beginTransaction: nodeTx.beginTransaction,
      commit: nodeTx.commit,
      rollBack: nodeTx.rollBack,
      transaction: nodeTx.transaction,
    },
    identity,
  );
}

function createMysqlPool(
  mysql: Mysql2Promise,
  options: MysqlOptions,
): Pool {
  const connectionLimit = options.max ?? 10;
  if (options.url) {
    return mysql.createPool({
      uri: options.url,
      connectionLimit,
      waitForConnections: true,
    });
  }
  return mysql.createPool({
    host: options.hostname ?? "127.0.0.1",
    port: options.port ?? 3306,
    database: options.database ?? "bunyad",
    user: options.username ?? "root",
    password: options.password ?? "",
    connectionLimit,
    waitForConnections: true,
  });
}

/**
 * Open a MySQL connection via `mysql2/promise` Pool (Node).
 * Outside a transaction uses the pool; begin reserves a connection in ALS.
 */
export function connectMysql(options: MysqlOptions = {}): Connection {
  const mysql = loadMysql2();
  const database = databaseNameFromOptions(options, "bunyad");
  const pool = createMysqlPool(mysql, options);
  return createNodeMysqlConnection("mysql", pool, {
    database,
    config: {
      ...options,
      driver: "mysql",
      database,
      max: options.max ?? 10,
    },
  });
}

/**
 * Open a MariaDB connection via `mysql2/promise` Pool (Node).
 * Same adapter as MySQL; dialect / driver name is `mariadb`.
 */
export function connectMariadb(options: MariadbOptions = {}): Connection {
  const mysql = loadMysql2();
  const database = databaseNameFromOptions(options, "bunyad");
  const pool = createMysqlPool(mysql, options);
  return createNodeMysqlConnection("mariadb", pool, {
    database,
    config: {
      ...options,
      driver: "mariadb",
      database,
      max: options.max ?? 10,
    },
  });
}
