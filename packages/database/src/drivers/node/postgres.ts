import { createRequire } from "node:module";
import type { Pool, PoolClient, QueryResult } from "pg";
import { dialectFor, wrapSqlName } from "../../dialect.ts";
import { afterCommit } from "../../after-commit.ts";
import { createTransactionApi } from "../../nested-transaction.ts";
import { reservedSql, setReservedSql } from "../../transaction-context.ts";
import {
  QueryException,
  shouldCaptureQueryCallerStack,
} from "../../query-exception.ts";
import { dateTimeForStorage } from "../../dates.ts";
import { postgresCursorRows, streamChunkSize } from "../../streaming.ts";
import {
  attachConnectionContract,
  affectedRowsFromResult,
  databaseNameFromOptions,
  type Connection,
  type ConnectionIdentity,
  type PostgresOptions,
  type StreamOptions,
} from "../../connection-contract.ts";
import {
  postgresConnectionUrl,
  sanitizePostgresUrl,
} from "../../postgres-url.ts";

export { postgresConnectionUrl, sanitizePostgresUrl };

const require = createRequire(import.meta.url);

type PgModule = typeof import("pg");

/** Fail-fast when the optional `pg` peer is not installed. */
export function loadPg(): PgModule {
  try {
    return require("pg") as PgModule;
  } catch (error) {
    const detail =
      error instanceof Error && error.message ? ` (${error.message})` : "";
    throw new Error(
      'Missing optional peer dependency "pg". Install it to use the Node Postgres driver: npm install pg / bun add pg' +
        detail,
    );
  }
}

/** `pg` rejects `undefined`; Bun SQL / dialect storage also need Date coercion. */
function coerceBind(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) {
    return dateTimeForStorage(value, "postgres");
  }
  return value;
}

function coerceParams(params: unknown[]): unknown[] {
  let changed = false;
  for (let i = 0; i < params.length; i++) {
    const value = params[i];
    if (value === undefined || value instanceof Date) {
      changed = true;
      break;
    }
  }
  if (!changed) return params;
  return params.map(coerceBind);
}

function createNodePostgresConnection(
  pool: Pool,
  identity: ConnectionIdentity = {},
): Connection {
  const dialect = dialectFor("postgres");
  const txKey = {};

  type Queryable = {
    query: (
      text: string,
      values?: unknown[],
    ) => Promise<QueryResult>;
  };

  const sqlClient = (): Queryable =>
    (reservedSql(txKey) as PoolClient | undefined) ?? pool;

  const runQuery = async (
    query: string,
    params: unknown[] = [],
  ): Promise<QueryResult> => {
    const bound = dialect.bindSql(query);
    const values = coerceParams(params);
    const callerStack = shouldCaptureQueryCallerStack()
      ? new Error().stack
      : null;
    try {
      return await sqlClient().query(bound, values);
    } catch (error) {
      throw QueryException.wrap(error, {
        sql: bound,
        bindings: values,
        callerStack,
      });
    }
  };

  const releaseReserved = (): void => {
    const reserved = reservedSql(txKey) as PoolClient | undefined;
    setReservedSql(txKey, null);
    reserved?.release();
  };

  const nodeTx = createTransactionApi(
    {
      begin: async () => {
        const client = await pool.connect();
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
          await runQuery("COMMIT");
        } finally {
          releaseReserved();
        }
      },
      rollback: async () => {
        try {
          await runQuery("ROLLBACK");
        } finally {
          releaseReserved();
        }
      },
      savepoint: async (name) => {
        await runQuery(`SAVEPOINT ${name}`);
      },
      releaseSavepoint: async (name) => {
        await runQuery(`RELEASE SAVEPOINT ${name}`);
      },
      rollbackToSavepoint: async (name) => {
        await runQuery(`ROLLBACK TO SAVEPOINT ${name}`);
      },
    },
    txKey,
  );

  return attachConnectionContract(
    {
      driver: "postgres",
      dialect,
      raw: pool,
      async run(query: string, params: unknown[] = []) {
        const result = await runQuery(query, params);
        return affectedRowsFromResult(result);
      },
      async get<T extends Record<string, unknown> = Record<string, unknown>>(
        query: string,
        params: unknown[] = [],
      ): Promise<T | null> {
        const result = await runQuery(query, params);
        const first = result.rows[0] as T | undefined;
        return first ?? null;
      },
      async all<T extends Record<string, unknown> = Record<string, unknown>>(
        query: string,
        params: unknown[] = [],
      ): Promise<T[]> {
        const result = await runQuery(query, params);
        return result.rows as T[];
      },
      /**
       * Server-side cursor on one session: reuses the open transaction, else
       * borrows a pooled client for a short read transaction.
       */
      async *stream<T extends Record<string, unknown> = Record<string, unknown>>(
        query: string,
        params: unknown[] = [],
        options?: StreamOptions,
      ): AsyncGenerator<T, void, unknown> {
        const bound = dialect.bindSql(query);
        const values = coerceParams(params);
        const callerStack = shouldCaptureQueryCallerStack()
          ? new Error().stack
          : null;
        const reserved = reservedSql(txKey) as PoolClient | undefined;
        const client = reserved ?? (await pool.connect());
        const exec = async (text: string, binds?: unknown[]) =>
          (await client.query(text, binds)).rows as Record<string, unknown>[];
        try {
          if (!reserved) await client.query("BEGIN");
          yield* postgresCursorRows(
            exec,
            bound,
            values,
            streamChunkSize(options),
          ) as AsyncGenerator<T, void, unknown>;
        } catch (error) {
          throw QueryException.wrap(error, { sql: bound, bindings: values, callerStack });
        } finally {
          if (!reserved) {
            await client.query("ROLLBACK").catch(() => undefined);
            client.release();
          }
        }
      },
      async exec(query: string) {
        await runQuery(query);
      },
      async insertGetId(table, columns, values, idColumn = "id") {
        const placeholders = columns.map(() => "?").join(", ");
        const wrapped = columns.map((c) => wrapSqlName(dialect, c));
        const insertSql = `INSERT INTO ${table} (${wrapped.join(", ")}) VALUES (${placeholders})`;

        if (dialect.insertIdStrategy === "returning") {
          const result = await runQuery(
            `${insertSql} RETURNING ${wrapSqlName(dialect, idColumn)}`,
            values,
          );
          const row = result.rows[0] as Record<string, unknown> | undefined;
          return Number(row?.[idColumn]);
        }

        // Postgres dialect is always `returning`; other strategies must not
        // return affected-row counts as insert ids.
        throw new Error(
          `Node Postgres insertGetId requires dialect insertIdStrategy "returning" (got ${JSON.stringify(dialect.insertIdStrategy)})`,
        );
      },
      /**
       * End the pool. Do not call while a transaction still holds a reserved
       * client — `pool.end()` waits for clients to be released and can hang
       * (same class of issue as closing Bun SQL mid-txn / mid-reserve).
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

/**
 * Open a PostgreSQL connection via `pg` Pool (Node).
 * Outside a transaction uses `pool.query`; begin reserves a client in ALS.
 * Do not call `close()` / `pool.end()` while a transaction still holds a
 * reserved client — end can hang until that client is released.
 */
export function connectPostgres(options: PostgresOptions = {}): Connection {
  const pg = loadPg();
  const database = databaseNameFromOptions(options, "bunyad");
  const pool = new pg.Pool({
    connectionString: postgresConnectionUrl(options),
    max: options.max ?? 10,
  });
  return createNodePostgresConnection(pool, {
    database,
    config: { ...options, driver: "pgsql", database, max: options.max ?? 10 },
  });
}
