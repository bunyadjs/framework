import { SQL, type ReservedSQL } from "bun";
import { dialectFor, wrapSqlName } from "../../dialect.ts";
import { dateTimeForStorage } from "../../dates.ts";
import { afterCommit } from "../../after-commit.ts";
import { createTransactionApi } from "../../nested-transaction.ts";
import { reservedSql, setReservedSql } from "../../transaction-context.ts";
import {
  QueryException,
  shouldCaptureQueryCallerStack,
} from "../../query-exception.ts";
import {
  attachConnectionContract,
  affectedRowsFromResult,
  databaseNameFromOptions,
  type Connection,
  type ConnectionIdentity,
  type MariadbOptions,
  type MysqlOptions,
  type PostgresOptions,
  type StreamOptions,
} from "../../connection-contract.ts";
import {
  sanitizePostgresUrl,
  postgresConnectionUrl,
} from "../../postgres-url.ts";
import { postgresCursorRows, streamChunkSize } from "../../streaming.ts";

/** Bun SQL stringifies `Date` binds (`GMT+0500 …`); send driver-native datetime text instead. */
function coerceParams(
  driver: "postgres" | "mysql" | "mariadb",
  params: unknown[],
): unknown[] {
  if (!params.some((value) => value instanceof Date)) return params;
  return params.map((value) =>
    value instanceof Date ? dateTimeForStorage(value, driver) : value,
  );
}

function createBunSqlConnection(
  driver: "postgres" | "mysql" | "mariadb",
  client: SQL,
  identity: ConnectionIdentity = {},
): Connection {
  const dialect = dialectFor(driver);
  const txKey = {};

  const sqlClient = (): SQL => (reservedSql(txKey) as SQL | undefined) ?? client;

  const runUnsafe = async (query: string, rawParams: unknown[] = []) => {
    const params = coerceParams(driver, rawParams);
    const bound = dialect.bindSql(query);
    // Bun SQL errors only retain native `internal:sql/*` frames; capture the
    // JS caller stack before await so debug pages can show application code.
    const callerStack = shouldCaptureQueryCallerStack()
      ? new Error().stack
      : null;
    try {
      return await sqlClient().unsafe(bound, params);
    } catch (error) {
      throw QueryException.wrap(error, {
        sql: bound,
        bindings: params,
        callerStack,
      });
    }
  };

  const releaseReserved = (): void => {
    const reserved = reservedSql(txKey) as ReservedSQL | undefined;
    setReservedSql(txKey, null);
    reserved?.release();
  };

  const bunTx = createTransactionApi(
    {
      begin: async () => {
        const reserved = await client.reserve();
        setReservedSql(txKey, reserved);
        const callerStack = shouldCaptureQueryCallerStack()
          ? new Error().stack
          : null;
        try {
          await reserved.unsafe("BEGIN");
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
          await runUnsafe("COMMIT");
        } finally {
          releaseReserved();
        }
      },
      rollback: async () => {
        try {
          await runUnsafe("ROLLBACK");
        } finally {
          releaseReserved();
        }
      },
      savepoint: async (name) => {
        await runUnsafe(`SAVEPOINT ${name}`);
      },
      releaseSavepoint: async (name) => {
        await runUnsafe(`RELEASE SAVEPOINT ${name}`);
      },
      rollbackToSavepoint: async (name) => {
        await runUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
      },
    },
    txKey,
  );

return attachConnectionContract(
    {
    driver,
    dialect,
    raw: client,
    async run(query: string, params: unknown[] = []) {
      const result = await runUnsafe(query, params);
      return affectedRowsFromResult(result);
    },
    async get<T extends Record<string, unknown> = Record<string, unknown>>(
      query: string,
      params: unknown[] = [],
    ): Promise<T | null> {
      const rows = await runUnsafe(query, params);
      const first = rows[0] as T | undefined;
      return first ?? null;
    },
    async all<T extends Record<string, unknown> = Record<string, unknown>>(
      query: string,
      params: unknown[] = [],
    ): Promise<T[]> {
      const rows = await runUnsafe(query, params);
      return [...rows] as T[];
    },
    /**
     * Postgres only: Bun SQL has no cursor API, so use a server-side cursor on
     * one reserved session (reusing the open transaction when there is one).
     * MySQL/MariaDB have no equivalent here and fall back to chunked paging.
     */
    ...(driver === "postgres"
      ? {
          async *stream<
            T extends Record<string, unknown> = Record<string, unknown>,
          >(
            query: string,
            rawParams: unknown[] = [],
            options?: StreamOptions,
          ): AsyncGenerator<T, void, unknown> {
            const params = coerceParams(driver, rawParams);
            const bound = dialect.bindSql(query);
            const callerStack = shouldCaptureQueryCallerStack()
              ? new Error().stack
              : null;
            const inTransaction = reservedSql(txKey) as ReservedSQL | undefined;
            const session = inTransaction ?? (await client.reserve());
            const exec = async (text: string, binds: unknown[] = []) => [
              ...((await session.unsafe(text, binds)) as Record<string, unknown>[]),
            ];
            try {
              if (!inTransaction) await exec("BEGIN");
              yield* postgresCursorRows(
                exec,
                bound,
                params,
                streamChunkSize(options),
              ) as AsyncGenerator<T, void, unknown>;
            } catch (error) {
              throw QueryException.wrap(error, {
                sql: bound,
                bindings: params,
                callerStack,
              });
            } finally {
              if (!inTransaction) {
                await exec("ROLLBACK").catch(() => undefined);
                session.release();
              }
            }
          },
        }
      : {}),
    async exec(query: string) {
      await runUnsafe(query);
    },
    async insertGetId(table, columns, values, idColumn = "id") {
      const placeholders = columns.map(() => "?").join(", ");
      const wrapped = columns.map((c) => wrapSqlName(dialect, c));
      const insertSql = `INSERT INTO ${table} (${wrapped.join(", ")}) VALUES (${placeholders})`;

      if (dialect.insertIdStrategy === "returning") {
        const rows = await runUnsafe(
          `${insertSql} RETURNING ${wrapSqlName(dialect, idColumn)}`,
          values,
        );
        const row = rows[0] as Record<string, unknown> | undefined;
        return Number(row?.[idColumn]);
      }

      const result = await runUnsafe(insertSql, values);
      return Number(result.lastInsertRowid);
    },
    async close() {
      await client.close();
    },
    afterCommit(callback) {
      afterCommit(callback);
    },
    beginTransaction: bunTx.beginTransaction,
    commit: bunTx.commit,
    rollBack: bunTx.rollBack,
    transaction: bunTx.transaction,
    },
    identity,
  );
}

export { sanitizePostgresUrl, postgresConnectionUrl };

/**
 * Open a PostgreSQL connection via Bun SQL.
 */
export function connectPostgres(options: PostgresOptions = {}): Connection {
  const database = databaseNameFromOptions(options, "bunyad");
  const client = new SQL({
    url: postgresConnectionUrl(options),
    adapter: "postgres",
    max: options.max ?? 10,
  });
  return createBunSqlConnection("postgres", client, {
    database,
    config: { ...options, driver: "pgsql", database },
  });
}

/**
 * Open a MySQL connection via Bun SQL.
 */
export function connectMysql(options: MysqlOptions = {}): Connection {
  const client = options.url
    ? options.tls
      ? new SQL({ url: options.url, adapter: "mysql", tls: options.tls, max: options.max ?? 10 })
      : new SQL(options.url)
    : new SQL({
        adapter: "mysql",
        hostname: options.hostname ?? "127.0.0.1",
        port: options.port ?? 3306,
        database: options.database ?? "bunyad",
        username: options.username ?? "root",
        password: options.password ?? "",
        max: options.max ?? 10,
        ...(options.tls ? { tls: options.tls } : {}),
      });
  return createBunSqlConnection("mysql", client, {
    database: databaseNameFromOptions(options, "bunyad"),
    config: { ...options, driver: "mysql" },
  });
}

/**
 * Open a MariaDB connection via Bun SQL (`adapter: "mariadb"`).
 */
export function connectMariadb(options: MariadbOptions = {}): Connection {
  const client = options.url
    ? new SQL(options.url)
    : new SQL({
        adapter: "mariadb",
        hostname: options.hostname ?? "127.0.0.1",
        port: options.port ?? 3306,
        database: options.database ?? "bunyad",
        username: options.username ?? "root",
        password: options.password ?? "",
        max: options.max ?? 10,
      });
  return createBunSqlConnection("mariadb", client, {
    database: databaseNameFromOptions(options, "bunyad"),
    config: { ...options, driver: "mariadb" },
  });
}
