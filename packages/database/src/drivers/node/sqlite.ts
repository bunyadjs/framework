import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Database as BetterSqliteDatabase } from "better-sqlite3";
import { dialectFor, wrapSqlName } from "../../dialect.ts";
import { afterCommit } from "../../after-commit.ts";
import { createTransactionApi } from "../../nested-transaction.ts";
import { dateTimeForStorage } from "../../dates.ts";
import {
  attachConnectionContract,
  type Connection,
  type SqliteOptions,
} from "../../connection-contract.ts";

const require = createRequire(import.meta.url);

type BetterSqlite3Ctor = typeof import("better-sqlite3");
type SqliteDatabase = BetterSqliteDatabase;
type SqliteRunResult = { changes: number; lastInsertRowid: number | bigint };
type SqliteBindValue = null | number | string | bigint | boolean | Buffer | Uint8Array;
/** The slice of a better-sqlite3 statement this driver uses (its own typings are generic over bind shape). */
type SqliteStatement = {
  run(...params: unknown[]): SqliteRunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  iterate(...params: unknown[]): IterableIterator<unknown>;
};

/** Fail-fast when the optional `better-sqlite3` peer is not installed. */
export function loadBetterSqlite3(): BetterSqlite3Ctor {
  try {
    return require("better-sqlite3") as BetterSqlite3Ctor;
  } catch (error) {
    const detail =
      error instanceof Error && error.message ? ` (${error.message})` : "";
    throw new Error(
      'Missing optional peer dependency "better-sqlite3". Install it to use the Node SQLite driver: npm install better-sqlite3 / bun add better-sqlite3' +
        detail,
    );
  }
}

/** better-sqlite3 rejects `undefined` and `Date`; store dates as SQL text. */
function sqliteBind(value: unknown): SqliteBindValue {
  if (value === undefined) return null;
  if (value instanceof Date) {
    return dateTimeForStorage(value, "sqlite") as string;
  }
  return value as SqliteBindValue;
}

function sqliteParams(params: unknown[]): SqliteBindValue[] {
  let coerce = false;
  for (let i = 0; i < params.length; i++) {
    const value = params[i];
    if (value === undefined || value instanceof Date) {
      coerce = true;
      break;
    }
  }
  if (!coerce) return params as SqliteBindValue[];
  return params.map(sqliteBind);
}

function sqliteRun(
  stmt: SqliteStatement,
  params: unknown[],
): SqliteRunResult {
  if (params.length === 0) return stmt.run();
  if (params.length === 1) return sqliteRun1(stmt, params[0]);
  return stmt.run(...sqliteParams(params));
}

function sqliteGet(stmt: SqliteStatement, params: unknown[]): unknown {
  if (params.length === 0) return stmt.get();
  if (params.length === 1) return sqliteGet1(stmt, params[0]);
  return stmt.get(...sqliteParams(params));
}

/** Bind a single value without allocating a params array. */
function sqliteGet1(stmt: SqliteStatement, value: unknown): unknown {
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
  stmt: SqliteStatement,
  value: unknown,
): SqliteRunResult {
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

function sqliteAll(stmt: SqliteStatement, params: unknown[]): unknown {
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
 * Open a SQLite connection via `better-sqlite3` (Node), with sync helpers
 * matching the Bun `bun:sqlite` ORM hot path.
 */
export function connectSqlite(options: SqliteOptions = {}): Connection {
  const Database = loadBetterSqlite3();
  const path = options.path ?? ":memory:";
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const raw: SqliteDatabase = new Database(path);
  raw.pragma("foreign_keys = ON");
  const dialect = dialectFor("sqlite");
  const statements = new Map<string, SqliteStatement>();
  const insertSqlCache = new Map<string, string>();

  const stmt = (sqlText: string): SqliteStatement => {
    let cached = statements.get(sqlText);
    if (!cached) {
      cached = raw.prepare(sqlText) as unknown as SqliteStatement;
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
    begin: () => {
      stmt("BEGIN").run();
    },
    commit: () => {
      stmt("COMMIT").run();
    },
    rollback: () => {
      stmt("ROLLBACK").run();
    },
    savepoint: (name) => {
      stmt(`SAVEPOINT ${name}`).run();
    },
    releaseSavepoint: (name) => {
      stmt(`RELEASE SAVEPOINT ${name}`).run();
    },
    rollbackToSavepoint: (name) => {
      stmt(`ROLLBACK TO SAVEPOINT ${name}`).run();
    },
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
      /**
       * Row-at-a-time on an uncached statement. better-sqlite3 rejects writes on
       * the same connection while an iterator is open, so buffer first if the loop body writes.
       */
      async *stream<T extends Record<string, unknown> = Record<string, unknown>>(
        sqlText: string,
        params: unknown[] = [],
      ): AsyncGenerator<T, void, unknown> {
        const statement = raw.prepare(sqlText) as unknown as SqliteStatement;
        yield* statement.iterate(...sqliteParams(params)) as Iterable<T>;
      },
      async exec(sqlText: string) {
        raw.exec(sqlText);
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
