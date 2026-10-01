import { dialectFor } from "./dialect.ts";
import {
  attachConnectionContract,
  affectedRowsFromResult,
  type Connection,
  type SqlsrvOptions,
} from "./connection-contract.ts";
import { afterCommit } from "./after-commit.ts";
import { createTransactionApi } from "./nested-transaction.ts";

type MssqlModule = typeof import("mssql");

type SqlsrvPoolConfig = {
  server: string;
  port?: number;
  database: string;
  user: string;
  password: string;
  options?: {
    encrypt?: boolean;
    trustServerCertificate?: boolean;
  };
  pool?: {
    max?: number;
    min?: number;
  };
};

function sqlsrvConfigFromOptions(options: SqlsrvOptions): SqlsrvPoolConfig {
  if (options.url) {
    const parsed = new URL(options.url);
    return {
      server: parsed.hostname || "127.0.0.1",
      port: parsed.port ? Number(parsed.port) : 1433,
      database: parsed.pathname.replace(/^\//, "") || "bunyad",
      user: decodeURIComponent(parsed.username || "sa"),
      password: decodeURIComponent(parsed.password || ""),
      options: {
        encrypt: parsed.searchParams.get("encrypt") !== "false",
        trustServerCertificate:
          parsed.searchParams.get("trustServerCertificate") !== "false",
      },
      pool: {
        max: options.max ?? 10,
        min: 0,
      },
    };
  }

  return {
    server: options.hostname ?? "127.0.0.1",
    port: options.port ?? 1433,
    database: options.database ?? "bunyad",
    user: options.username ?? "sa",
    password: options.password ?? "",
    options: {
      encrypt: options.encrypt ?? true,
      trustServerCertificate: options.trustServerCertificate ?? true,
    },
    pool: {
      max: options.max ?? 10,
      min: 0,
    },
  };
}

let mssqlModule: MssqlModule | undefined;

async function loadMssql(): Promise<MssqlModule> {
  if (!mssqlModule) {
    mssqlModule = await import("mssql");
  }
  return mssqlModule;
}

/**
 * Open a SQL Server connection via the `mssql` (Tedious) driver.
 * The driver loads on first query so SQLite/Postgres apps do not pay bundle cost.
 */
export function connectSqlsrv(options: SqlsrvOptions = {}): Connection {
  const dialect = dialectFor("sqlsrv");
  const config = sqlsrvConfigFromOptions(options);
  type Pool = InstanceType<MssqlModule["ConnectionPool"]>;
  type Transaction = InstanceType<MssqlModule["Transaction"]>;
  let pool: Pool | null = null;
  let ready: Promise<void> | null = null;
  let activeTx: Transaction | null = null;

  const ensurePool = async (): Promise<MssqlModule> => {
    const sql = await loadMssql();
    if (!pool) {
      pool = new sql.ConnectionPool(config as never);
      ready = pool.connect().then(() => undefined);
    }
    await ready;
    return sql;
  };

  const runRequest = async (query: string, params: unknown[] = []) => {
    const sql = await ensurePool();
    const bound = dialect.bindSql(query);
    const request = activeTx ? new sql.Request(activeTx) : pool!.request();
    params.forEach((value, index) => {
      request.input(`p${index}`, value as never);
    });
    return request.query(bound);
  };

  
  const sqlTx = createTransactionApi({
      begin: async () => {
        const sql = await ensurePool();
        const tx = new sql.Transaction(pool!);
        await tx.begin();
        activeTx = tx;
      },
      commit: async () => {
        if (!activeTx) throw new Error("There is no active transaction.");
        await activeTx.commit();
        activeTx = null;
      },
      rollback: async () => {
        if (!activeTx) return;
        try {
          await activeTx.rollback();
        } catch {
          // ignore
        }
        activeTx = null;
      },
      savepoint: async (name) => {
        // SQL Server: SAVE TRANSACTION (no RELEASE)
        await runRequest(`SAVE TRANSACTION ${name}`, []);
      },
      releaseSavepoint: async () => {
        // no-op on SQL Server
      },
      rollbackToSavepoint: async (name) => {
        await runRequest(`ROLLBACK TRANSACTION ${name}`, []);
      },
    });

return attachConnectionContract(
    {
    driver: "sqlsrv",
    dialect,
    raw: pool,
    async run(query: string, params: unknown[] = []) {
      const result = await runRequest(query, params);
      return affectedRowsFromResult(result);
    },
    async get<T extends Record<string, unknown> = Record<string, unknown>>(
      query: string,
      params: unknown[] = [],
    ): Promise<T | null> {
      const result = await runRequest(query, params);
      const row = result.recordset[0] as T | undefined;
      return row ?? null;
    },
    async all<T extends Record<string, unknown> = Record<string, unknown>>(
      query: string,
      params: unknown[] = [],
    ): Promise<T[]> {
      const result = await runRequest(query, params);
      return result.recordset as T[];
    },
    async exec(query: string) {
      await runRequest(query);
    },
    async insertGetId(table, columns, values, idColumn = "id") {
      const placeholders = columns.map(() => "?").join(", ");
      const insertSql = `INSERT INTO ${table} (${columns.join(", ")})
        OUTPUT INSERTED.${idColumn} AS id
        VALUES (${placeholders})`;
      const result = await runRequest(insertSql, values);
      const row = result.recordset[0] as { id?: unknown } | undefined;
      return Number(row?.id);
    },
    async close() {
      await ready?.catch(() => undefined);
      await pool?.close();
      pool = null;
      ready = null;
    },
    afterCommit(callback) {
      afterCommit(callback);
    },
    beginTransaction: sqlTx.beginTransaction,
    commit: sqlTx.commit,
    rollBack: sqlTx.rollBack,
    transaction: sqlTx.transaction,
    },
    {
      database: config.database,
      config: { ...options, driver: "sqlsrv", database: config.database },
    },
  );
}
