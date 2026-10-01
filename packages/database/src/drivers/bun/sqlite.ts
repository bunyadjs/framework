import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database as BunSqlite, type SQLQueryBindings } from "bun:sqlite";
import { dialectFor, wrapSqlName } from "../../dialect.ts";
import { afterCommit } from "../../after-commit.ts";
import { createTransactionApi } from "../../nested-transaction.ts";
import { dateTimeForStorage } from "../../dates.ts";
import {
  attachConnectionContract,
  type Connection,
  type SqliteOptions,
} from "../../connection-contract.ts";

/** bun:sqlite rejects `undefined` and `Date`; store dates as SQL text. */
function sqliteBind(value: unknown): SQLQueryBindings {
  if (value === undefined) return null;
  if (value instanceof Date) {
    return dateTimeForStorage(value, "sqlite") as string;
  }
  return value as SQLQueryBindings;
}

function sqliteParams(params: unknown[]): SQLQueryBindings[] {
  let coerce = false;
  for (let i = 0; i < params.length; i++) {
    const value = params[i];
    if (value === undefined || value instanceof Date) {
      coerce = true;
      break;
    }
  }
  if (!coerce) return params as SQLQueryBindings[];
  return params.map(sqliteBind);
}

function sqliteRun(
  stmt: ReturnType<BunSqlite["query"]>,
  params: unknown[],
): ReturnType<ReturnType<BunSqlite["query"]>["run"]> {
  if (params.length === 0) return stmt.run();
  if (params.length === 1) return sqliteRun1(stmt, params[0]);
  return stmt.run(...sqliteParams(params));
}

function sqliteGet(
  stmt: ReturnType<BunSqlite["query"]>,
  params: unknown[],
): unknown {
  if (params.length === 0) return stmt.get();
  if (params.length === 1) return sqliteGet1(stmt, params[0]);
  return stmt.get(...sqliteParams(params));
}

/** Bind a single value without allocating a params array. */
function sqliteGet1(
  stmt: ReturnType<BunSqlite["query"]>,
  value: unknown,
): unknown {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  ) {
    return stmt.get(value);
  }
  return stmt.get(sqliteBind(value));
}

function sqliteRun1(
  stmt: ReturnType<BunSqlite["query"]>,
  value: unknown,
): ReturnType<ReturnType<BunSqlite["query"]>["run"]> {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  ) {
    return stmt.run(value);
  }
  return stmt.run(sqliteBind(value));
}

function sqliteAll(
  stmt: ReturnType<BunSqlite["query"]>,
  params: unknown[],
): unknown {
  if (params.length === 0) return stmt.all();
  if (params.length === 1) {
    const value = params[0];
    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "string" ||
      typeof value === "bigint" ||
      typeof value === "boolean"
    ) {
      return stmt.all(value);
    }
    return stmt.all(sqliteBind(value));
  }
  return stmt.all(...sqliteParams(params));
}

/**
 * Open a SQLite connection (Bun native `bun:sqlite`), async wrapper for a unified API.
 */
export function connectSqlite(options: SqliteOptions = {}): Connection {
  const path = options.path ?? ":memory:";
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const raw = new BunSqlite(path, { create: true });
  raw.query("PRAGMA foreign_keys = ON").run();
  const dialect = dialectFor("sqlite");
  const statements = new Map<string, ReturnType<BunSqlite["query"]>>();

  const insertSqlCache = new Map<string, string>();

  const stmt = (sqlText: string) => {
    let cached = statements.get(sqlText);
    if (!cached) {
      cached = raw.query(sqlText);
      statements.set(sqlText, cached);
    }
    return cached;
  };

  const runSync = (sqlText: string, params: unknown[] = []): number => {
    const info = sqliteRun(stmt(sqlText), params);
    return Number(info.changes);
  };

  const insertSql = (table: string, columns: string[]): string => {
    const cacheKey = `${table}\0${columns.join("\0")}`;
    let sql = insertSqlCache.get(cacheKey);
    if (!sql) {
      const placeholders = columns.map(() => "?").join(", ");
      const wrapped = columns.map((c) => wrapSqlName(dialect, c));
      sql = `INSERT INTO ${table} (${wrapped.join(", ")}) VALUES (${placeholders})`;
      insertSqlCache.set(cacheKey, sql);
    }
    return sql;
  };

  const insertGetIdSync = (
    table: string,
    columns: string[],
    values: unknown[],
    idColumn = "id",
  ): number => {
    void idColumn;
    const info = sqliteRun(stmt(insertSql(table, columns)), values);
    return Number(info.lastInsertRowid);
  };

  const insertGetIdSync1 = (
    table: string,
    column: string,
    value: unknown,
  ): number => {
    const info = sqliteRun1(stmt(insertSql(table, [column])), value);
    return Number(info.lastInsertRowid);
  };

    const sqliteTx = createTransactionApi({
      begin: () => { stmt("BEGIN").run(); },
      commit: () => { stmt("COMMIT").run(); },
      rollback: () => { stmt("ROLLBACK").run(); },
      savepoint: (name) => { stmt(`SAVEPOINT ${name}`).run(); },
      releaseSavepoint: (name) => { stmt(`RELEASE SAVEPOINT ${name}`).run(); },
      rollbackToSavepoint: (name) => { stmt(`ROLLBACK TO SAVEPOINT ${name}`).run(); },
    });

return attachConnectionContract(
    {
    driver: "sqlite",
    dialect,
    raw,
    runSync,
    insertGetIdSync,
    insertGetIdSync1,
    async run(sqlText: string, params: unknown[] = []) {
      return runSync(sqlText, params);
    },
    async get<T extends Record<string, unknown> = Record<string, unknown>>(
      sqlText: string,
      params: unknown[] = [],
    ): Promise<T | null> {
      return (sqliteGet(stmt(sqlText), params) as T | null) ?? null;
    },
    getSync<T extends Record<string, unknown> = Record<string, unknown>>(
      sqlText: string,
      params: unknown[] = [],
    ): T | null {
      return (sqliteGet(stmt(sqlText), params) as T | null) ?? null;
    },
    getSync1<T extends Record<string, unknown> = Record<string, unknown>>(
      sqlText: string,
      value: unknown,
    ): T | null {
      return (sqliteGet1(stmt(sqlText), value) as T | null) ?? null;
    },
    async all<T extends Record<string, unknown> = Record<string, unknown>>(
      sqlText: string,
      params: unknown[] = [],
    ): Promise<T[]> {
      return sqliteAll(stmt(sqlText), params) as T[];
    },
    allSync<T extends Record<string, unknown> = Record<string, unknown>>(
      sqlText: string,
      params: unknown[] = [],
    ): T[] {
      return sqliteAll(stmt(sqlText), params) as T[];
    },
    async exec(sqlText: string) {
      stmt(sqlText).run();
    },
    async insertGetId(table, columns, values, idColumn = "id") {
      return insertGetIdSync(table, columns, values, idColumn);
    },
    async close() {
      statements.clear();
      insertSqlCache.clear();
      raw.close();
    },
    afterCommit(callback) {
      afterCommit(callback);
    },
    beginTransaction: sqliteTx.beginTransaction,
    commit: sqliteTx.commit,
    rollBack: sqliteTx.rollBack,
    transaction: sqliteTx.transaction,
    },
    { database: path, config: { database: path, path } },
  );
}
