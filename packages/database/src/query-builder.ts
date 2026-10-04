import { Collection, collect } from "@bunyad/common";
import type { Connection } from "./connection.ts";
import type { DriverName } from "./dialect.ts";
import { isMysqlFamily, wrapSqlName } from "./dialect.ts";
import {
  whereDateExpression,
  whereDayExpression,
  whereMonthExpression,
  whereYearExpression,
  dateForStorage,
  toDate,
  type DateInput,
} from "./dates.ts";
import {
  fullTextSql,
  jsonContainsKeySql,
  jsonContainsSql,
  jsonLengthExpression,
  lockClause,
} from "./json.ts";
import {
  CursorPaginator,
  LengthAwarePaginator,
  Paginator,
  decodeCursor,
  encodeCursor,
  resolvePaginatorPage,
} from "./paginator.ts";
import { fireQueryInsertHook, fireQueryWriteHook, shouldPreviewQueryWrite } from "./query-hooks.ts";

type Where = {
  boolean: "and" | "or";
  type: "basic" | "null" | "in" | "raw" | "between" | "column" | "exists";
  column?: string;
  op?: string;
  value?: unknown;
  values?: unknown[];
  sql?: string;
  params?: unknown[];
  not?: boolean;
};

type JoinCondition = {
  boolean: "and" | "or";
  first: string;
  op: string;
  second: unknown;
  where: boolean;
};

type Join = {
  type: "inner" | "left" | "right" | "cross";
  table: string;
  clauses?: JoinCondition[];
  bindings?: unknown[];
};

/** Chainable join callback builder (`on` / `orOn` / `where` / `orWhere`). */
export class JoinClause {
  constructor(readonly clauses: JoinCondition[] = []) {}

  on(first: string, op: string, second: string): this {
    this.clauses.push({ boolean: "and", first, op, second, where: false });
    return this;
  }

  orOn(first: string, op: string, second: string): this {
    this.clauses.push({ boolean: "or", first, op, second, where: false });
    return this;
  }

  where(first: string, op: string, value: unknown): this {
    this.clauses.push({ boolean: "and", first, op, second: value, where: true });
    return this;
  }

  orWhere(first: string, op: string, value: unknown): this {
    this.clauses.push({ boolean: "or", first, op, second: value, where: true });
    return this;
  }
}

type Order = {
  column?: string;
  direction?: "asc" | "desc";
  raw?: string;
};

type Having =
  | {
      type: "basic";
      boolean: "and" | "or";
      column: string;
      op: string;
      value: unknown;
    }
  | { type: "raw"; boolean: "and" | "or"; sql: string; params: unknown[] }
  | {
      type: "between";
      boolean: "and" | "or";
      column: string;
      values: [unknown, unknown];
      not?: boolean;
    }
  | {
      type: "null";
      boolean: "and" | "or";
      column: string;
      not?: boolean;
    };

type Union = { query: QueryBuilder; all: boolean };

/** Cast types for query-time `withCasts`. */
export type QueryCastType =
  | "boolean"
  | "number"
  | "string"
  | "json"
  | "date"
  | "datetime"
  | "array";

/** Thrown when `firstOrFail` / `sole` find no matching row. */
export class RecordNotFoundException extends Error {
  constructor(message = "No query results for model.") {
    super(message);
    this.name = "RecordNotFoundException";
  }
}

/**
 * Fluent SQL query builder (method names match the common query API).
 */
export class QueryBuilder {
  #connection: Connection;
  #table: string;
  #columns: string[] | null = null;
  #selectBindings: unknown[] = [];
  #fromBindings: unknown[] = [];
  #distinct = false;
  #wheres: Where[] = [];
  #joins: Join[] = [];
  #orders: Order[] = [];
  #groups: string[] = [];
  #havings: Having[] = [];
  #limitValue?: number;
  #offsetValue?: number;
  #unions: Union[] = [];
  #lock: false | "update" | "shared" | string = false;
  #casts: Record<string, QueryCastType> = {};

  constructor(connection: Connection, table: string) {
    this.#connection = connection;
    this.#table = table;
  }

  /** Set the from table. */
  from(table: string): this {
    this.#table = table;
    this.#fromBindings = [];
    return this;
  }

  /** Use a subquery as the from table. */
  fromSub(
    query: QueryBuilder | ((q: QueryBuilder) => void),
    as: string,
  ): this {
    const sub = this.#resolveSub(query);
    const compiled = sub.#compileSelect();
    this.#table = `(${compiled.sql}) as ${as}`;
    this.#fromBindings = compiled.params;
    return this;
  }

  /** Select from a subquery expression. */
  selectSub(
    query: QueryBuilder | ((q: QueryBuilder) => void),
    as: string,
  ): this {
    const sub = this.#resolveSub(query);
    const compiled = sub.#compileSelect();
    this.#columns = [...(this.#columns ?? []), `(${compiled.sql}) as ${as}`];
    this.#selectBindings.push(...compiled.params);
    return this;
  }

  #resolveSub(query: QueryBuilder | ((q: QueryBuilder) => void)): QueryBuilder {
    if (typeof query === "function") {
      const sub = new QueryBuilder(this.#connection, this.#table);
      query(sub);
      return sub;
    }
    return query;
  }

  /** `select(...$columns)`. */
  select(...columns: string[]): this {
    this.#columns = columns.length > 0 ? columns : ["*"];
    return this;
  }

  /** `addSelect(...$columns)`. */
  addSelect(...columns: string[]): this {
    this.#columns =
      this.#columns === null ? [...columns] : [...this.#columns, ...columns];
    return this;
  }

  /** `distinct()`. */
  distinct(value = true): this {
    this.#distinct = value;
    return this;
  }

  /** `selectRaw($expression, $bindings)`. */
  selectRaw(expression: string, bindings: unknown[] = []): this {
    this.#columns = this.#columns ?? [];
    this.#columns.push(expression);
    this.#selectBindings.push(...bindings);
    return this;
  }

  where(callback: (query: QueryBuilder) => void): this;
  where(column: string, value: unknown): this;
  where(column: string, op: string, value: unknown): this;
  where(
    columnOrCallback: string | ((query: QueryBuilder) => void),
    opOrValue?: unknown,
    value?: unknown,
  ): this {
    if (typeof columnOrCallback === "function") {
      return this.#addNested(columnOrCallback, "and", false);
    }
    const column = columnOrCallback;
    if (value === undefined) {
      this.#wheres.push({
        boolean: "and",
        type: "basic",
        column,
        op: "=",
        value: opOrValue,
      });
    } else {
      this.#wheres.push({
        boolean: "and",
        type: "basic",
        column,
        op: String(opOrValue),
        value,
      });
    }
    return this;
  }

  /** `orWhere`. */
  orWhere(callback: (query: QueryBuilder) => void): this;
  orWhere(column: string, value: unknown): this;
  orWhere(column: string, op: string, value: unknown): this;
  orWhere(
    columnOrCallback: string | ((query: QueryBuilder) => void),
    opOrValue?: unknown,
    value?: unknown,
  ): this {
    if (typeof columnOrCallback === "function") {
      return this.#addNested(columnOrCallback, "or", false);
    }
    const column = columnOrCallback;
    if (value === undefined) {
      this.#wheres.push({
        boolean: "or",
        type: "basic",
        column,
        op: "=",
        value: opOrValue,
      });
    } else {
      this.#wheres.push({
        boolean: "or",
        type: "basic",
        column,
        op: String(opOrValue),
        value,
      });
    }
    return this;
  }

  whereNull(column: string): this {
    return this.#addNull(column, false, "and");
  }

  orWhereNull(column: string): this {
    return this.#addNull(column, false, "or");
  }

  whereNotNull(column: string): this {
    return this.#addNull(column, true, "and");
  }

  orWhereNotNull(column: string): this {
    return this.#addNull(column, true, "or");
  }

  /**
   * `whereAny($columns, $operator, $value)` —
   * `(col1 = ? OR col2 = ? OR …)`.
   */
  whereAny(columns: string[], opOrValue: unknown, value?: unknown): this {
    return this.#whereColumnGroup(columns, opOrValue, value, "and", "or", false);
  }

  /** `orWhereAny`. */
  orWhereAny(columns: string[], opOrValue: unknown, value?: unknown): this {
    return this.#whereColumnGroup(columns, opOrValue, value, "or", "or", false);
  }

  /**
   * `whereAll($columns, $operator, $value)` —
   * `(col1 = ? AND col2 = ? AND …)`.
   */
  whereAll(columns: string[], opOrValue: unknown, value?: unknown): this {
    return this.#whereColumnGroup(columns, opOrValue, value, "and", "and", false);
  }

  /** `orWhereAll`. */
  orWhereAll(columns: string[], opOrValue: unknown, value?: unknown): this {
    return this.#whereColumnGroup(columns, opOrValue, value, "or", "and", false);
  }

  /**
   * `whereNone($columns, $operator, $value)` —
   * `NOT (col1 = ? OR col2 = ? OR …)`.
   */
  whereNone(columns: string[], opOrValue: unknown, value?: unknown): this {
    return this.#whereColumnGroup(columns, opOrValue, value, "and", "or", true);
  }

  /** `orWhereNone`. */
  orWhereNone(columns: string[], opOrValue: unknown, value?: unknown): this {
    return this.#whereColumnGroup(columns, opOrValue, value, "or", "or", true);
  }

  #whereColumnGroup(
    columns: string[],
    opOrValue: unknown,
    value: unknown | undefined,
    boolean: "and" | "or",
    innerBoolean: "and" | "or",
    negate: boolean,
  ): this {
    if (columns.length === 0) return this;
    const op = value === undefined ? "=" : String(opOrValue);
    const val = value === undefined ? opOrValue : value;
    return this.#addNested(
      (q) => {
        for (let i = 0; i < columns.length; i++) {
          const col = columns[i]!;
          if (i === 0 || innerBoolean === "and") {
            q.where(col, op, val);
          } else {
            q.orWhere(col, op, val);
          }
        }
      },
      boolean,
      negate,
    );
  }

  #addNull(column: string, not: boolean, boolean: "and" | "or"): this {
    this.#wheres.push({
      boolean,
      type: "null",
      column,
      op: not ? "IS NOT" : "IS",
    });
    return this;
  }

  whereIn(column: string, values: unknown[]): this {
    return this.#addIn(column, values, false, "and");
  }

  orWhereIn(column: string, values: unknown[]): this {
    return this.#addIn(column, values, false, "or");
  }

  whereNotIn(column: string, values: unknown[]): this {
    return this.#addIn(column, values, true, "and");
  }

  orWhereNotIn(column: string, values: unknown[]): this {
    return this.#addIn(column, values, true, "or");
  }

  #addIn(
    column: string,
    values: unknown[],
    not: boolean,
    boolean: "and" | "or",
  ): this {
    this.#wheres.push({
      boolean,
      type: "in",
      column,
      op: not ? "NOT IN" : "IN",
      values,
    });
    return this;
  }

  whereIntegerInRaw(column: string, values: Array<string | number>): this {
    return this.#addIntegerInRaw(column, values, false, "and");
  }

  orWhereIntegerInRaw(column: string, values: Array<string | number>): this {
    return this.#addIntegerInRaw(column, values, false, "or");
  }

  whereIntegerNotInRaw(column: string, values: Array<string | number>): this {
    return this.#addIntegerInRaw(column, values, true, "and");
  }

  orWhereIntegerNotInRaw(
    column: string,
    values: Array<string | number>,
  ): this {
    return this.#addIntegerInRaw(column, values, true, "or");
  }

  #addIntegerInRaw(
    column: string,
    values: Array<string | number>,
    not: boolean,
    boolean: "and" | "or",
  ): this {
    const ints = values.map((v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        throw new Error(`whereIntegerInRaw expects integers, got [${v}].`);
      }
      return String(n);
    });
    const list = ints.length > 0 ? ints.join(", ") : "NULL";
    this.#wheres.push({
      boolean,
      type: "raw",
      sql: `${column} ${not ? "NOT IN" : "IN"} (${list})`,
      params: [],
    });
    return this;
  }

  whereBetween(column: string, values: [unknown, unknown]): this {
    return this.#addBetween(column, values, false, "and");
  }

  orWhereBetween(column: string, values: [unknown, unknown]): this {
    return this.#addBetween(column, values, false, "or");
  }

  whereNotBetween(column: string, values: [unknown, unknown]): this {
    return this.#addBetween(column, values, true, "and");
  }

  orWhereNotBetween(column: string, values: [unknown, unknown]): this {
    return this.#addBetween(column, values, true, "or");
  }

  #addBetween(
    column: string,
    values: [unknown, unknown],
    not: boolean,
    boolean: "and" | "or",
  ): this {
    this.#wheres.push({
      boolean,
      type: "between",
      column,
      values,
      not,
    });
    return this;
  }

  whereColumn(first: string, second: string): this;
  whereColumn(first: string, op: string, second: string): this;
  whereColumn(first: string, opOrSecond: string, second?: string): this {
    return this.#addColumn(first, opOrSecond, second, "and");
  }

  orWhereColumn(first: string, second: string): this;
  orWhereColumn(first: string, op: string, second: string): this;
  orWhereColumn(first: string, opOrSecond: string, second?: string): this {
    return this.#addColumn(first, opOrSecond, second, "or");
  }

  #addColumn(
    first: string,
    opOrSecond: string,
    second: string | undefined,
    boolean: "and" | "or",
  ): this {
    if (second === undefined) {
      this.#wheres.push({
        boolean,
        type: "column",
        column: first,
        op: "=",
        value: opOrSecond,
      });
    } else {
      this.#wheres.push({
        boolean,
        type: "column",
        column: first,
        op: opOrSecond,
        value: second,
      });
    }
    return this;
  }

  whereExists(query: QueryBuilder | ((query: QueryBuilder) => void)): this {
    return this.#addExists(query, false, "and");
  }

  orWhereExists(query: QueryBuilder | ((query: QueryBuilder) => void)): this {
    return this.#addExists(query, false, "or");
  }

  whereNotExists(query: QueryBuilder | ((query: QueryBuilder) => void)): this {
    return this.#addExists(query, true, "and");
  }

  orWhereNotExists(query: QueryBuilder | ((query: QueryBuilder) => void)): this {
    return this.#addExists(query, true, "or");
  }

  whereRaw(sql: string, bindings: unknown[] = []): this {
    this.#wheres.push({
      boolean: "and",
      type: "raw",
      sql,
      params: bindings,
    });
    return this;
  }

  orWhereRaw(sql: string, bindings: unknown[] = []): this {
    this.#wheres.push({
      boolean: "or",
      type: "raw",
      sql,
      params: bindings,
    });
    return this;
  }

  /** Nested where group: `where(function (q) { ... })`. */
  whereNested(callback: (query: QueryBuilder) => void): this {
    return this.#addNested(callback, "and", false);
  }

  /** `orWhere(function (q) { ... })`. */
  orWhereNested(callback: (query: QueryBuilder) => void): this {
    return this.#addNested(callback, "or", false);
  }

  whereNot(callback: (query: QueryBuilder) => void): this {
    return this.#addNested(callback, "and", true);
  }

  orWhereNot(callback: (query: QueryBuilder) => void): this {
    return this.#addNested(callback, "or", true);
  }

  #addNested(
    callback: (query: QueryBuilder) => void,
    boolean: "and" | "or",
    not: boolean,
  ): this {
    const sub = new QueryBuilder(this.#connection, this.#table);
    callback(sub);
    const { clause, params } = sub.#whereSql();
    const inner = clause.replace(/^\s*WHERE\s+/i, "");
    if (!inner) return this;
    this.#wheres.push({
      boolean,
      type: "raw",
      sql: `${not ? "not " : ""}(${inner})`,
      params,
    });
    return this;
  }

  whereLike(column: string, value: string, caseSensitive = false): this {
    return this.#addLike(column, value, false, "and", caseSensitive);
  }

  orWhereLike(column: string, value: string, caseSensitive = false): this {
    return this.#addLike(column, value, false, "or", caseSensitive);
  }

  whereNotLike(column: string, value: string, caseSensitive = false): this {
    return this.#addLike(column, value, true, "and", caseSensitive);
  }

  orWhereNotLike(column: string, value: string, caseSensitive = false): this {
    return this.#addLike(column, value, true, "or", caseSensitive);
  }

  #addLike(
    column: string,
    value: string,
    not: boolean,
    boolean: "and" | "or",
    caseSensitive: boolean,
  ): this {
    const driver = this.#connection.driver;
    let sql: string;
    if (caseSensitive) {
      if (isMysqlFamily(driver)) {
        sql = `${column} ${not ? "NOT LIKE" : "LIKE"} ? COLLATE utf8mb4_bin`;
      } else if (driver === "sqlsrv") {
        sql = `${column} ${not ? "NOT LIKE" : "LIKE"} ? COLLATE Latin1_General_BIN`;
      } else {
        sql = `${column} ${not ? "NOT LIKE" : "LIKE"} ?`;
      }
    } else if (driver === "postgres") {
      sql = `${column} ${not ? "NOT ILIKE" : "ILIKE"} ?`;
    } else {
      sql = `${column} ${not ? "NOT LIKE" : "LIKE"} ?`;
    }
    this.#wheres.push({ boolean, type: "raw", sql, params: [value] });
    return this;
  }

  /** `whereUuid($column, $uuid)` — equality filter. */
  whereUuid(column: string, value: string): this {
    return this.where(column, value);
  }

  /** `whereUlid($column, $ulid)` — equality filter. */
  whereUlid(column: string, value: string): this {
    return this.where(column, value);
  }

  /** Compare calendar date only (`Y-m-d`, `Date`, or duck-typed dayjs/luxon). */
  whereDate(column: string, value: DateInput): this;
  whereDate(column: string, op: string, value: DateInput): this;
  whereDate(
    column: string,
    opOrValue: string | DateInput,
    value?: DateInput,
  ): this {
    return this.#addDateWhere(
      whereDateExpression(column, this.#connection.driver),
      opOrValue,
      value,
      "and",
    );
  }

  orWhereDate(column: string, value: DateInput): this;
  orWhereDate(column: string, op: string, value: DateInput): this;
  orWhereDate(
    column: string,
    opOrValue: string | DateInput,
    value?: DateInput,
  ): this {
    return this.#addDateWhere(
      whereDateExpression(column, this.#connection.driver),
      opOrValue,
      value,
      "or",
    );
  }

  whereYear(column: string, value: number): this;
  whereYear(column: string, op: string, value: number): this;
  whereYear(column: string, opOrValue: string | number, value?: number): this {
    return this.#addNumericDateWhere(
      whereYearExpression(column, this.#connection.driver),
      opOrValue,
      value,
      "and",
    );
  }

  orWhereYear(column: string, value: number): this;
  orWhereYear(column: string, op: string, value: number): this;
  orWhereYear(
    column: string,
    opOrValue: string | number,
    value?: number,
  ): this {
    return this.#addNumericDateWhere(
      whereYearExpression(column, this.#connection.driver),
      opOrValue,
      value,
      "or",
    );
  }

  whereMonth(column: string, value: number): this;
  whereMonth(column: string, op: string, value: number): this;
  whereMonth(column: string, opOrValue: string | number, value?: number): this {
    return this.#addNumericDateWhere(
      whereMonthExpression(column, this.#connection.driver),
      opOrValue,
      value,
      "and",
    );
  }

  orWhereMonth(column: string, value: number): this;
  orWhereMonth(column: string, op: string, value: number): this;
  orWhereMonth(
    column: string,
    opOrValue: string | number,
    value?: number,
  ): this {
    return this.#addNumericDateWhere(
      whereMonthExpression(column, this.#connection.driver),
      opOrValue,
      value,
      "or",
    );
  }

  whereDay(column: string, value: number): this;
  whereDay(column: string, op: string, value: number): this;
  whereDay(column: string, opOrValue: string | number, value?: number): this {
    return this.#addNumericDateWhere(
      whereDayExpression(column, this.#connection.driver),
      opOrValue,
      value,
      "and",
    );
  }

  orWhereDay(column: string, value: number): this;
  orWhereDay(column: string, op: string, value: number): this;
  orWhereDay(
    column: string,
    opOrValue: string | number,
    value?: number,
  ): this {
    return this.#addNumericDateWhere(
      whereDayExpression(column, this.#connection.driver),
      opOrValue,
      value,
      "or",
    );
  }

  #addDateWhere(
    expr: string,
    opOrValue: string | DateInput,
    value: DateInput | undefined,
    boolean: "and" | "or",
  ): this {
    const op = value === undefined ? "=" : String(opOrValue);
    const raw = (value === undefined ? opOrValue : value) as DateInput;
    const ymd = dateForStorage(raw);
    this.#wheres.push({
      boolean,
      type: "raw",
      sql: `${expr} ${op} ?`,
      params: [ymd],
    });
    return this;
  }

  #addNumericDateWhere(
    expr: string,
    opOrValue: string | number,
    value: number | undefined,
    boolean: "and" | "or",
  ): this {
    const op = value === undefined ? "=" : String(opOrValue);
    const num = value === undefined ? Number(opOrValue) : value;
    this.#wheres.push({
      boolean,
      type: "raw",
      sql: `${expr} ${op} ?`,
      params: [num],
    });
    return this;
  }

  #addExists(
    query: QueryBuilder | ((query: QueryBuilder) => void),
    not: boolean,
    boolean: "and" | "or",
  ): this {
    const sub = this.#resolveSub(query);
    const compiled = sub.#compileSelect();
    this.#wheres.push({
      boolean,
      type: "exists",
      sql: compiled.sql,
      params: compiled.params,
      not,
    });
    return this;
  }

  join(table: string, callback: (join: JoinClause) => void): this;
  join(table: string, first: string, op: string, second: string): this;
  join(
    table: string,
    firstOrCallback: string | ((join: JoinClause) => void),
    op?: string,
    second?: string,
  ): this {
    return this.#addJoin("inner", table, firstOrCallback, op, second);
  }

  leftJoin(table: string, callback: (join: JoinClause) => void): this;
  leftJoin(table: string, first: string, op: string, second: string): this;
  leftJoin(
    table: string,
    firstOrCallback: string | ((join: JoinClause) => void),
    op?: string,
    second?: string,
  ): this {
    return this.#addJoin("left", table, firstOrCallback, op, second);
  }

  rightJoin(table: string, callback: (join: JoinClause) => void): this;
  rightJoin(table: string, first: string, op: string, second: string): this;
  rightJoin(
    table: string,
    firstOrCallback: string | ((join: JoinClause) => void),
    op?: string,
    second?: string,
  ): this {
    return this.#addJoin("right", table, firstOrCallback, op, second);
  }

  crossJoin(table: string): this {
    this.#joins.push({ type: "cross", table });
    return this;
  }

  joinWhere(table: string, first: string, op: string, second: unknown): this {
    return this.#addJoinWhere("inner", table, first, op, second);
  }

  leftJoinWhere(
    table: string,
    first: string,
    op: string,
    second: unknown,
  ): this {
    return this.#addJoinWhere("left", table, first, op, second);
  }

  rightJoinWhere(
    table: string,
    first: string,
    op: string,
    second: unknown,
  ): this {
    return this.#addJoinWhere("right", table, first, op, second);
  }

  joinSub(
    query: QueryBuilder | ((q: QueryBuilder) => void),
    as: string,
    callback: (join: JoinClause) => void,
  ): this;
  joinSub(
    query: QueryBuilder | ((q: QueryBuilder) => void),
    as: string,
    first: string,
    op: string,
    second: string,
  ): this;
  joinSub(
    query: QueryBuilder | ((q: QueryBuilder) => void),
    as: string,
    firstOrCallback: string | ((join: JoinClause) => void),
    op?: string,
    second?: string,
  ): this {
    return this.#addJoinSub("inner", query, as, firstOrCallback, op, second);
  }

  leftJoinSub(
    query: QueryBuilder | ((q: QueryBuilder) => void),
    as: string,
    callback: (join: JoinClause) => void,
  ): this;
  leftJoinSub(
    query: QueryBuilder | ((q: QueryBuilder) => void),
    as: string,
    first: string,
    op: string,
    second: string,
  ): this;
  leftJoinSub(
    query: QueryBuilder | ((q: QueryBuilder) => void),
    as: string,
    firstOrCallback: string | ((join: JoinClause) => void),
    op?: string,
    second?: string,
  ): this {
    return this.#addJoinSub("left", query, as, firstOrCallback, op, second);
  }

  rightJoinSub(
    query: QueryBuilder | ((q: QueryBuilder) => void),
    as: string,
    callback: (join: JoinClause) => void,
  ): this;
  rightJoinSub(
    query: QueryBuilder | ((q: QueryBuilder) => void),
    as: string,
    first: string,
    op: string,
    second: string,
  ): this;
  rightJoinSub(
    query: QueryBuilder | ((q: QueryBuilder) => void),
    as: string,
    firstOrCallback: string | ((join: JoinClause) => void),
    op?: string,
    second?: string,
  ): this {
    return this.#addJoinSub("right", query, as, firstOrCallback, op, second);
  }

  crossJoinSub(
    query: QueryBuilder | ((q: QueryBuilder) => void),
    as: string,
  ): this {
    const sub = this.#resolveSub(query);
    const compiled = sub.#compileSelect();
    this.#joins.push({
      type: "cross",
      table: `(${compiled.sql}) as ${as}`,
      bindings: compiled.params,
    });
    return this;
  }

  #joinClauses(
    firstOrCallback: string | ((join: JoinClause) => void),
    op?: string,
    second?: string,
  ): JoinCondition[] {
    const join = new JoinClause();
    if (typeof firstOrCallback === "function") {
      firstOrCallback(join);
    } else {
      if (op === undefined || second === undefined) {
        throw new Error("Join column comparisons require first, operator, and second.");
      }
      join.on(firstOrCallback, op, second);
    }
    if (join.clauses.length === 0) {
      throw new Error("Join callback must add at least one clause.");
    }
    return join.clauses;
  }

  #addJoin(
    type: "inner" | "left" | "right",
    table: string,
    firstOrCallback: string | ((join: JoinClause) => void),
    op?: string,
    second?: string,
  ): this {
    this.#joins.push({
      type,
      table,
      clauses: this.#joinClauses(firstOrCallback, op, second),
    });
    return this;
  }

  #addJoinWhere(
    type: "inner" | "left" | "right",
    table: string,
    first: string,
    op: string,
    second: unknown,
  ): this {
    this.#joins.push({
      type,
      table,
      clauses: [{ boolean: "and", first, op, second, where: true }],
    });
    return this;
  }

  #addJoinSub(
    type: "inner" | "left" | "right",
    query: QueryBuilder | ((q: QueryBuilder) => void),
    as: string,
    firstOrCallback: string | ((join: JoinClause) => void),
    op?: string,
    second?: string,
  ): this {
    const sub = this.#resolveSub(query);
    const compiled = sub.#compileSelect();
    this.#joins.push({
      type,
      table: `(${compiled.sql}) as ${as}`,
      clauses: this.#joinClauses(firstOrCallback, op, second),
      bindings: compiled.params,
    });
    return this;
  }

  /** `union`. */
  union(query: QueryBuilder | ((query: QueryBuilder) => void)): this {
    this.#unions.push({ query: this.#resolveSub(query).clone(), all: false });
    return this;
  }

  /** `unionAll`. */
  unionAll(query: QueryBuilder | ((query: QueryBuilder) => void)): this {
    this.#unions.push({ query: this.#resolveSub(query).clone(), all: true });
    return this;
  }

  /** `lockForUpdate`. */
  lockForUpdate(): this {
    this.#lock = "update";
    return this;
  }

  /** `sharedLock`. */
  sharedLock(): this {
    this.#lock = "shared";
    return this;
  }

  /**
   * `lock($value)`.
   * Pass `false` to clear, `true` for for-update, or a raw lock string.
   */
  lock(value: boolean | string = true): this {
    if (value === false) this.#lock = false;
    else if (value === true) this.#lock = "update";
    else this.#lock = value;
    return this;
  }

  whereJsonContains(column: string, value: unknown): this {
    return this.#addJsonContains(column, value, false, "and");
  }

  orWhereJsonContains(column: string, value: unknown): this {
    return this.#addJsonContains(column, value, false, "or");
  }

  whereJsonDoesntContain(column: string, value: unknown): this {
    return this.#addJsonContains(column, value, true, "and");
  }

  orWhereJsonDoesntContain(column: string, value: unknown): this {
    return this.#addJsonContains(column, value, true, "or");
  }

  #addJsonContains(
    column: string,
    value: unknown,
    not: boolean,
    boolean: "and" | "or",
  ): this {
    const { sql, params } = jsonContainsSql(
      column,
      value,
      this.#connection.driver,
      not,
    );
    this.#wheres.push({ boolean, type: "raw", sql, params });
    return this;
  }

  whereJsonContainsKey(column: string): this {
    return this.#addJsonContainsKey(column, false, "and");
  }

  orWhereJsonContainsKey(column: string): this {
    return this.#addJsonContainsKey(column, false, "or");
  }

  whereJsonDoesntContainKey(column: string): this {
    return this.#addJsonContainsKey(column, true, "and");
  }

  orWhereJsonDoesntContainKey(column: string): this {
    return this.#addJsonContainsKey(column, true, "or");
  }

  #addJsonContainsKey(
    column: string,
    not: boolean,
    boolean: "and" | "or",
  ): this {
    this.#wheres.push({
      boolean,
      type: "raw",
      sql: jsonContainsKeySql(column, this.#connection.driver, not),
      params: [],
    });
    return this;
  }

  whereJsonLength(column: string, value: number): this;
  whereJsonLength(column: string, op: string, value: number): this;
  whereJsonLength(
    column: string,
    opOrValue: string | number,
    value?: number,
  ): this {
    return this.#addJsonLength(column, opOrValue, value, "and");
  }

  orWhereJsonLength(column: string, value: number): this;
  orWhereJsonLength(column: string, op: string, value: number): this;
  orWhereJsonLength(
    column: string,
    opOrValue: string | number,
    value?: number,
  ): this {
    return this.#addJsonLength(column, opOrValue, value, "or");
  }

  #addJsonLength(
    column: string,
    opOrValue: string | number,
    value: number | undefined,
    boolean: "and" | "or",
  ): this {
    const op = value === undefined ? "=" : String(opOrValue);
    const length = value === undefined ? Number(opOrValue) : value;
    const expr = jsonLengthExpression(column, this.#connection.driver);
    this.#wheres.push({
      boolean,
      type: "raw",
      sql: `${expr} ${op} ?`,
      params: [length],
    });
    return this;
  }

  whereFullText(columns: string | string[], value: string): this {
    return this.#addFullText(columns, value, "and");
  }

  orWhereFullText(columns: string | string[], value: string): this {
    return this.#addFullText(columns, value, "or");
  }

  #addFullText(
    columns: string | string[],
    value: string,
    boolean: "and" | "or",
  ): this {
    const cols = Array.isArray(columns) ? columns : [columns];
    const { sql, bindingCount } = fullTextSql(cols, this.#connection.driver);
    const params =
      bindingCount === 1
        ? [value]
        : Array.from({ length: bindingCount }, () => `%${value}%`);
    this.#wheres.push({ boolean, type: "raw", sql, params });
    return this;
  }

  /** Apply casts when hydrating rows from `get` / `first`. */
  withCasts(casts: Record<string, QueryCastType>): this {
    Object.assign(this.#casts, casts);
    return this;
  }

  orderBy(column: string, direction: "asc" | "desc" = "asc"): this {
    this.#orders.push({ column, direction });
    return this;
  }

  orderByDesc(column: string): this {
    return this.orderBy(column, "desc");
  }

  orderByRaw(sql: string): this {
    this.#orders.push({ raw: sql });
    return this;
  }

  /** Clear orders, optionally set a new one. */
  reorder(column?: string, direction: "asc" | "desc" = "asc"): this {
    this.#orders = [];
    if (column !== undefined) this.orderBy(column, direction);
    return this;
  }

  reorderDesc(column: string): this {
    return this.reorder(column, "desc");
  }

  /** Order by a random expression (SQLite/Postgres `RANDOM()`, MySQL/MariaDB `RAND()`, SQL Server `NEWID()`). */
  inRandomOrder(): this {
    const driver = this.#connection.driver;
    const expr = isMysqlFamily(driver)
      ? "RAND()"
      : driver === "sqlsrv"
        ? "NEWID()"
        : "RANDOM()";
    return this.orderByRaw(expr);
  }

  /** Default column `created_at` descending. */
  latest(column = "created_at"): this {
    return this.orderBy(column, "desc");
  }

  /** Default column `created_at` ascending. */
  oldest(column = "created_at"): this {
    return this.orderBy(column, "asc");
  }

  groupBy(...columns: string[]): this {
    this.#groups.push(...columns);
    return this;
  }

  groupByRaw(sql: string): this {
    this.#groups.push(sql);
    return this;
  }

  having(column: string, op: string, value: unknown): this {
    return this.#addHavingBasic(column, op, value, "and");
  }

  orHaving(column: string, op: string, value: unknown): this {
    return this.#addHavingBasic(column, op, value, "or");
  }

  #addHavingBasic(
    column: string,
    op: string,
    value: unknown,
    boolean: "and" | "or",
  ): this {
    this.#havings.push({ type: "basic", boolean, column, op, value });
    return this;
  }

  havingRaw(sql: string, bindings: unknown[] = []): this {
    this.#havings.push({ type: "raw", boolean: "and", sql, params: bindings });
    return this;
  }

  orHavingRaw(sql: string, bindings: unknown[] = []): this {
    this.#havings.push({ type: "raw", boolean: "or", sql, params: bindings });
    return this;
  }

  havingBetween(column: string, values: [unknown, unknown]): this {
    return this.#addHavingBetween(column, values, false, "and");
  }

  orHavingBetween(column: string, values: [unknown, unknown]): this {
    return this.#addHavingBetween(column, values, false, "or");
  }

  havingNotBetween(column: string, values: [unknown, unknown]): this {
    return this.#addHavingBetween(column, values, true, "and");
  }

  orHavingNotBetween(column: string, values: [unknown, unknown]): this {
    return this.#addHavingBetween(column, values, true, "or");
  }

  #addHavingBetween(
    column: string,
    values: [unknown, unknown],
    not: boolean,
    boolean: "and" | "or",
  ): this {
    this.#havings.push({ type: "between", boolean, column, values, not });
    return this;
  }

  havingNull(column: string): this {
    return this.#addHavingNull(column, false, "and");
  }

  orHavingNull(column: string): this {
    return this.#addHavingNull(column, false, "or");
  }

  havingNotNull(column: string): this {
    return this.#addHavingNull(column, true, "and");
  }

  orHavingNotNull(column: string): this {
    return this.#addHavingNull(column, true, "or");
  }

  #addHavingNull(
    column: string,
    not: boolean,
    boolean: "and" | "or",
  ): this {
    this.#havings.push({ type: "null", boolean, column, not });
    return this;
  }

  limit(value: number): this {
    this.#limitValue = value;
    return this;
  }

  /** `take` — alias of `limit`. */
  take(value: number): this {
    return this.limit(value);
  }

  offset(value: number): this {
    this.#offsetValue = value;
    return this;
  }

  /** `skip` — alias of `offset`. */
  skip(value: number): this {
    return this.offset(value);
  }

  /** `forPage($page, $perPage)`. */
  forPage(page: number, perPage = 15): this {
    const current = Math.max(1, Math.floor(page) || 1);
    const size = Math.max(1, Math.floor(perPage) || 15);
    return this.offset((current - 1) * size).limit(size);
  }

  /**
   * `when($value, $callback, $default)`.
   * Runs `callback` when value is truthy; otherwise optional `defaultCallback`.
   */
  when(
    value: unknown,
    callback: (query: this, value: unknown) => void,
    defaultCallback?: (query: this, value: unknown) => void,
  ): this {
    if (value) callback(this, value);
    else defaultCallback?.(this, value);
    return this;
  }

  /** `unless($value, $callback, $default)`. */
  unless(
    value: unknown,
    callback: (query: this, value: unknown) => void,
    defaultCallback?: (query: this, value: unknown) => void,
  ): this {
    if (!value) callback(this, value);
    else defaultCallback?.(this, value);
    return this;
  }

  /** `tap($callback)`. */
  tap(callback: (query: this) => void): this {
    callback(this);
    return this;
  }

  /** Clone the builder. */
  clone(): QueryBuilder {
    const copy = new QueryBuilder(this.#connection, this.#table);
    copy.#columns = this.#columns ? [...this.#columns] : null;
    copy.#selectBindings = [...this.#selectBindings];
    copy.#fromBindings = [...this.#fromBindings];
    copy.#distinct = this.#distinct;
    copy.#wheres = this.#wheres.map((w) => ({
      ...w,
      values: w.values ? [...w.values] : undefined,
      params: w.params ? [...w.params] : undefined,
    }));
    copy.#joins = this.#joins.map((j) => ({
      ...j,
      bindings: j.bindings ? [...j.bindings] : undefined,
    }));
    copy.#orders = this.#orders.map((o) => ({ ...o }));
    copy.#groups = [...this.#groups];
    copy.#havings = this.#havings.map((h) => {
      if (h.type === "raw") {
        return {
          type: "raw" as const,
          boolean: h.boolean,
          sql: h.sql,
          params: [...h.params],
        };
      }
      if (h.type === "between") {
        return {
          type: "between" as const,
          boolean: h.boolean,
          column: h.column,
          values: [...h.values] as [unknown, unknown],
          not: h.not,
        };
      }
      return { ...h };
    });
    copy.#limitValue = this.#limitValue;
    copy.#offsetValue = this.#offsetValue;
    copy.#unions = this.#unions.map((u) => ({
      query: u.query.clone(),
      all: u.all,
    }));
    copy.#lock = this.#lock;
    copy.#casts = { ...this.#casts };
    return copy;
  }

  /** Compiled SQL string (bindings via `getBindings()`). */
  toSql(): string {
    return this.#compileSelect().sql;
  }

  /** SQL with bindings interpolated for debugging. */
  toRawSql(): string {
    const { sql, params } = this.#compileSelect();
    let i = 0;
    return sql.replace(/\?/g, () => {
      const v = params[i++];
      if (v === null || v === undefined) return "NULL";
      if (typeof v === "number") return String(v);
      if (typeof v === "boolean") return v ? "1" : "0";
      return `'${String(v).replace(/'/g, "''")}'`;
    });
  }

  getBindings(): unknown[] {
    return this.#compileSelect().params;
  }

  getConnection(): Connection {
    return this.#connection;
  }

  getColumns(): string[] | null {
    return this.#columns ? [...this.#columns] : null;
  }

  getLimit(): number | undefined {
    return this.#limitValue;
  }

  getOffset(): number | undefined {
    return this.#offsetValue;
  }

  first():
    | Record<string, unknown>
    | null
    | Promise<Record<string, unknown> | null> {
    const prevLimit = this.#limitValue;
    this.#limitValue = 1;
    const { sql, params } = this.#compileSelect();
    this.#limitValue = prevLimit;

    if (this.#connection.getSync) {
      const row = this.#connection.getSync(sql, params);
      return row ? this.#applyCasts(row) : null;
    }
    return this.#connection.get(sql, params).then((row) =>
      row ? this.#applyCasts(row) : null,
    );
  }

  async firstOrFail(): Promise<Record<string, unknown>> {
    const row = await this.first();
    if (row == null) throw new RecordNotFoundException();
    return row;
  }

  /** Exactly one matching row, or throw. */
  async sole(): Promise<Record<string, unknown>> {
    const rows = await this.clone().limit(2).get();
    if (rows.isEmpty()) throw new RecordNotFoundException();
    if (rows.length > 1) {
      throw new RecordNotFoundException("Query returned more than one row.");
    }
    return rows.first()!;
  }

  async soleValue(column: string): Promise<unknown> {
    const row = await this.clone().select(column).sole();
    return row[column] ?? null;
  }

  async value(column: string): Promise<unknown> {
    const q = this.clone();
    q.#columns = [column];
    const row = await q.first();
    return row?.[column] ?? null;
  }

  async pluck(column: string): Promise<Collection<unknown>> {
    const q = this.clone();
    q.#columns = [column];
    const rows = await q.get();
    return rows.pluck(column);
  }

  /** Join column values with a separator. */
  async implode(column: string, glue = ""): Promise<string> {
    const values = await this.pluck(column);
    return values.implode(glue);
  }

  /** Find by `id`. */
  async find(id: string | number): Promise<Record<string, unknown> | null> {
    return this.clone().where("id", id).first();
  }

  async findOr(
    id: string | number,
    callback: () => Record<string, unknown> | Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const row = await this.find(id);
    if (row != null) return row;
    return callback();
  }

  async findOrFail(id: string | number): Promise<Record<string, unknown>> {
    const row = await this.find(id);
    if (row == null) throw new RecordNotFoundException();
    return row;
  }

  /** Raw rows without wrapping a Collection (used by the ORM hydrate path). */
  getRows():
    | Record<string, unknown>[]
    | Promise<Record<string, unknown>[]> {
    const { sql, params } = this.#compileSelect();
    let hasCasts = false;
    for (const _ in this.#casts) {
      hasCasts = true;
      break;
    }

    const mapRows = (rows: Record<string, unknown>[]) =>
      hasCasts ? rows.map((row) => this.#applyCasts(row)) : rows;

    if (this.#connection.allSync) {
      return mapRows(this.#connection.allSync(sql, params));
    }
    return this.#connection
      .all(sql, params)
      .then((rows) => mapRows(rows as Record<string, unknown>[]));
  }

  async get(): Promise<Collection<Record<string, unknown>>> {
    const rows = await this.getRows();
    return collect(rows);
  }

  async exists(): Promise<boolean> {
    return (await this.clone().first()) != null;
  }

  async existsOr<T>(callback: () => T | Promise<T>): Promise<true | T> {
    if (await this.exists()) return true;
    return callback();
  }

  async doesntExist(): Promise<boolean> {
    return !(await this.exists());
  }

  async doesntExistOr<T>(callback: () => T | Promise<T>): Promise<true | T> {
    if (await this.doesntExist()) return true;
    return callback();
  }

  /**
   * `count($columns = '*')` with current wheres (ignores limit/offset).
   * With `distinct()` and a non-`*` column → `COUNT(DISTINCT col)`.
   */
  count(column = "*"): number | Promise<number> {
    const value = this.#aggregate("count", column);
    if (value instanceof Promise) {
      return value.then((v) => Number(v));
    }
    return Number(value);
  }

  /** `avg` / `average`. */
  avg(column: string): number | null | Promise<number | null> {
    const value = this.#aggregate("avg", column);
    if (value instanceof Promise) {
      return value.then((v) => (v === null ? null : Number(v)));
    }
    return value === null ? null : Number(value);
  }

  /** Alias of `avg`. */
  average(column: string): number | null | Promise<number | null> {
    return this.avg(column);
  }

  /** `sum`. */
  async sum(column: string): Promise<number> {
    return Number((await this.#aggregate("sum", column)) ?? 0);
  }

  /** `min`. */
  async min(column: string): Promise<unknown> {
    return this.#aggregate("min", column);
  }

  /** `max`. */
  async max(column: string): Promise<unknown> {
    return this.#aggregate("max", column);
  }

  #aggregate(
    functionName: "count" | "avg" | "sum" | "min" | "max",
    column: string,
  ): unknown | Promise<unknown> {
    const q = this.clone();
    q.#orders = [];
    q.#limitValue = undefined;
    q.#offsetValue = undefined;
    q.#groups = [];
    q.#havings = [];
    const distinct = q.#distinct && functionName === "count" && column !== "*";
    q.#distinct = false;
    const wrapped =
      column === "*" ? "*" : this.#wrap(column);
    const expr =
      functionName === "count" && column === "*"
        ? "COUNT(*) as aggregate"
        : functionName === "count" && distinct
          ? `COUNT(DISTINCT ${wrapped}) as aggregate`
          : `${functionName.toUpperCase()}(${column === "*" ? "*" : column}) as aggregate`;
    q.#columns = [expr];
    const { clause, params, joinSql } = q.#whereAndJoins();
    const sql = `SELECT ${expr} FROM ${q.#table}${joinSql}${clause}`;
    if (this.#connection.getSync) {
      const row = this.#connection.getSync<{ aggregate: unknown }>(sql, params);
      return row?.aggregate ?? null;
    }
    return this.#connection
      .get<{ aggregate: unknown }>(sql, params)
      .then((row) => row?.aggregate ?? null);
  }

  /**
   * Chunk rows. Return `false` from the callback to stop.
   */
  async chunk(
    count: number,
    callback: (
      rows: Collection<Record<string, unknown>>,
      page: number,
    ) => void | boolean | Promise<void | boolean>,
  ): Promise<boolean> {
    const size = Math.max(1, Math.floor(count));
    let page = 1;
    for (;;) {
      const rows = await this.clone().forPage(page, size).get();
      if (rows.isEmpty()) return true;
      const result = await callback(rows, page);
      if (result === false) return false;
      if (rows.length < size) return true;
      page += 1;
    }
  }

  /** Map over chunked rows, collecting results. */
  async chunkMap<T>(
    count: number,
    callback: (row: Record<string, unknown>) => T | Promise<T>,
  ): Promise<T[]> {
    const results: T[] = [];
    await this.chunk(count, async (rows) => {
      for (const row of rows) {
        results.push(await callback(row));
      }
    });
    return results;
  }

  /** Iterate each row via chunks. */
  async each(
    callback: (
      row: Record<string, unknown>,
      index: number,
    ) => void | boolean | Promise<void | boolean>,
    count = 1000,
  ): Promise<boolean> {
    let index = 0;
    return this.chunk(count, async (rows) => {
      for (const row of rows) {
        const result = await callback(row, index++);
        if (result === false) return false;
      }
    });
  }

  /** Paginate by ascending id (safe under concurrent inserts). */
  async chunkById(
    count: number,
    callback: (
      rows: Collection<Record<string, unknown>>,
    ) => void | boolean | Promise<void | boolean>,
    column = "id",
  ): Promise<boolean> {
    return this.#chunkById(count, callback, column, "asc");
  }

  async chunkByIdDesc(
    count: number,
    callback: (
      rows: Collection<Record<string, unknown>>,
    ) => void | boolean | Promise<void | boolean>,
    column = "id",
  ): Promise<boolean> {
    return this.#chunkById(count, callback, column, "desc");
  }

  async eachById(
    callback: (
      row: Record<string, unknown>,
      index: number,
    ) => void | boolean | Promise<void | boolean>,
    count = 1000,
    column = "id",
  ): Promise<boolean> {
    let index = 0;
    return this.chunkById(count, async (rows) => {
      for (const row of rows) {
        const result = await callback(row, index++);
        if (result === false) return false;
      }
    }, column);
  }

  async #chunkById(
    count: number,
    callback: (
      rows: Collection<Record<string, unknown>>,
    ) => void | boolean | Promise<void | boolean>,
    column: string,
    direction: "asc" | "desc",
  ): Promise<boolean> {
    const size = Math.max(1, Math.floor(count));
    let lastId: unknown = null;
    for (;;) {
      const q = this.clone().orderBy(column, direction).limit(size);
      if (lastId !== null) {
        q.where(column, direction === "asc" ? ">" : "<", lastId);
      }
      const rows = await q.get();
      if (rows.isEmpty()) return true;
      const result = await callback(rows);
      if (result === false) return false;
      lastId = rows.last()?.[column];
      if (rows.length < size) return true;
    }
  }

  /** Constrain to rows after an id (for keyset paging). */
  forPageAfterId(perPage: number, lastId: unknown, column = "id"): this {
    if (lastId !== null && lastId !== undefined) {
      this.where(column, ">", lastId);
    }
    return this.orderBy(column, "asc").limit(perPage);
  }

  forPageBeforeId(perPage: number, lastId: unknown, column = "id"): this {
    if (lastId !== null && lastId !== undefined) {
      this.where(column, "<", lastId);
    }
    return this.orderBy(column, "desc").limit(perPage);
  }

  /**
   * `cursor()` — stream rows from a single query without buffering the result
   * set. Drivers with a real streaming primitive (SQLite, Postgres, Node MySQL)
   * keep one statement/cursor open; others fall back to `lazy()` chunking.
   * Prefer `lazyById()` when the loop body writes to the same table.
   */
  cursor(
    chunkSize = 1000,
  ): AsyncGenerator<Record<string, unknown>, void, unknown> {
    return this.#cursorRows(chunkSize);
  }

  async *#cursorRows(
    chunkSize: number,
  ): AsyncGenerator<Record<string, unknown>, void, unknown> {
    const connection = this.#connection;
    if (!connection.stream) {
      yield* this.#cursorPages(chunkSize);
      return;
    }
    const { sql, params } = this.#compileSelect();
    let hasCasts = false;
    for (const _ in this.#casts) {
      hasCasts = true;
      break;
    }
    const size = Math.max(1, Math.floor(chunkSize));
    for await (const row of connection.stream(sql, params, { chunkSize: size })) {
      yield hasCasts ? this.#applyCasts(row) : row;
    }
  }

  async *#cursorPages(
    chunkSize: number,
  ): AsyncGenerator<Record<string, unknown>, void, unknown> {
    const size = Math.max(1, Math.floor(chunkSize));
    let page = 1;
    for (;;) {
      const rows = await this.clone().forPage(page, size).get();
      if (rows.isEmpty()) return;
      for (const row of rows) yield row;
      if (rows.length < size) return;
      page += 1;
    }
  }

  /** `lazy()` — chunked `LIMIT/OFFSET` iteration (one query per chunk). */
  lazy(chunkSize = 1000): AsyncGenerator<Record<string, unknown>, void, unknown> {
    return this.#cursorPages(chunkSize);
  }

  lazyById(
    chunkSize = 1000,
    column = "id",
  ): AsyncGenerator<Record<string, unknown>, void, unknown> {
    return this.#lazyById(chunkSize, column, "asc");
  }

  lazyByIdDesc(
    chunkSize = 1000,
    column = "id",
  ): AsyncGenerator<Record<string, unknown>, void, unknown> {
    return this.#lazyById(chunkSize, column, "desc");
  }

  async *#lazyById(
    chunkSize: number,
    column: string,
    direction: "asc" | "desc",
  ): AsyncGenerator<Record<string, unknown>, void, unknown> {
    const size = Math.max(1, Math.floor(chunkSize));
    let lastId: unknown = null;
    for (;;) {
      const q = this.clone().orderBy(column, direction).limit(size);
      if (lastId !== null) {
        q.where(column, direction === "asc" ? ">" : "<", lastId);
      }
      const rows = await q.get();
      if (rows.isEmpty()) return;
      for (const row of rows) {
        yield row;
        lastId = row[column];
      }
      if (rows.length < size) return;
    }
  }

  /** `paginate($perPage, $columns, $pageName, $page)`. */
  async paginate(
    perPage?: number,
    columns?: string[],
    pageName?: string,
    page?: number,
  ): Promise<LengthAwarePaginator<Record<string, unknown>>>;
  /** Backward-compatible Bunyad shape: `paginate(perPage, page, options)`. */
  async paginate(
    perPage?: number,
    page?: number,
    options?: { path?: string; columns?: string[] },
  ): Promise<LengthAwarePaginator<Record<string, unknown>>>;
  async paginate(
    perPage = 15,
    columnsOrPage: string[] | number = ["*"],
    pageNameOrOptions: string | { path?: string; columns?: string[] } = "page",
    page?: number,
  ): Promise<LengthAwarePaginator<Record<string, unknown>>> {
    const legacy = typeof columnsOrPage === "number";
    const columns = legacy
      ? typeof pageNameOrOptions === "object"
        ? pageNameOrOptions.columns
        : undefined
      : columnsOrPage;
    const currentPage = resolvePaginatorPage(
      legacy ? columnsOrPage : page,
      !legacy && typeof pageNameOrOptions === "string"
        ? pageNameOrOptions
        : "page",
    );
    const size = Math.max(1, Math.floor(Number(perPage)) || 15);
    const total = await this.count();
    const q = this.clone().forPage(currentPage, size);
    if (columns) q.select(...columns);
    const items = (await q.get()).all();
    const options =
      legacy && typeof pageNameOrOptions === "object" ? pageNameOrOptions : {};
    return new LengthAwarePaginator(items, total, size, currentPage, {
      path: options.path,
      pageName:
        !legacy && typeof pageNameOrOptions === "string"
          ? pageNameOrOptions
          : "page",
    });
  }

  /** `simplePaginate($perPage, $columns, $pageName, $page)`. */
  async simplePaginate(
    perPage?: number,
    columns?: string[],
    pageName?: string,
    page?: number,
  ): Promise<Paginator<Record<string, unknown>>>;
  /** Backward-compatible Bunyad shape: `simplePaginate(perPage, page, options)`. */
  async simplePaginate(
    perPage?: number,
    page?: number,
    options?: { path?: string },
  ): Promise<Paginator<Record<string, unknown>>>;
  async simplePaginate(
    perPage = 15,
    columnsOrPage: string[] | number = ["*"],
    pageNameOrOptions: string | { path?: string } = "page",
    page?: number,
  ): Promise<Paginator<Record<string, unknown>>> {
    const legacy = typeof columnsOrPage === "number";
    const columns = legacy ? undefined : columnsOrPage;
    const currentPage = resolvePaginatorPage(
      legacy ? columnsOrPage : page,
      !legacy && typeof pageNameOrOptions === "string"
        ? pageNameOrOptions
        : "page",
    );
    const size = Math.max(1, Math.floor(Number(perPage)) || 15);
    const q = this.clone()
      .offset((currentPage - 1) * size)
      .limit(size + 1);
    if (columns) q.select(...columns);
    const items = (await q.get()).all();
    const options =
      legacy && typeof pageNameOrOptions === "object" ? pageNameOrOptions : {};
    return new Paginator(items, size, currentPage, {
      path: options.path,
      pageName:
        !legacy && typeof pageNameOrOptions === "string"
          ? pageNameOrOptions
          : "page",
    });
  }

  /** `cursorPaginate($perPage, $columns, $cursorName, $cursor)`. */
  async cursorPaginate(
    perPage?: number,
    columns?: string[],
    cursorName?: string,
    cursor?: string | null,
  ): Promise<CursorPaginator<Record<string, unknown>>>;
  /** Backward-compatible Bunyad shape: `cursorPaginate(perPage, cursor, options)`. */
  async cursorPaginate(
    perPage?: number,
    cursor?: string | null,
    options?: { path?: string; cursorName?: string },
  ): Promise<CursorPaginator<Record<string, unknown>>>;
  async cursorPaginate(
    perPage = 15,
    columnsOrCursor: string[] | string | null = ["*"],
    cursorNameOrOptions:
      | string
      | { path?: string; cursorName?: string } = "cursor",
    cursor?: string | null,
  ): Promise<CursorPaginator<Record<string, unknown>>> {
    const legacy = !Array.isArray(columnsOrCursor);
    const columns = legacy ? undefined : columnsOrCursor;
    const activeCursor = legacy ? columnsOrCursor : (cursor ?? null);
    const options =
      legacy && typeof cursorNameOrOptions === "object"
        ? cursorNameOrOptions
        : {};
    const cursorName =
      !legacy && typeof cursorNameOrOptions === "string"
        ? cursorNameOrOptions
        : options.cursorName;
    const size = Math.max(1, Math.floor(Number(perPage)) || 15);
    const q = this.clone();
    if (columns) q.select(...columns);
    if (q.#orders.length === 0) {
      q.orderBy("id", "asc");
    }

    const orders = q.#orders.filter((o) => o.column);
    if (orders.length === 0) {
      throw new Error(
        "cursorPaginate requires column orderBy (not only orderByRaw)",
      );
    }

    if (activeCursor) {
      q.#applyCursorConstraint(orders, decodeCursor(activeCursor), true);
    }

    const rows = (await q.limit(size + 1).get()).all();
    let nextCursor: string | null = null;
    let items = rows;
    if (rows.length > size) {
      items = rows.slice(0, size);
      const last = items[items.length - 1]!;
      nextCursor = encodeCursor(
        Object.fromEntries(orders.map((o) => [o.column!, last[o.column!]])),
      );
    }

    let previousCursor: string | null = null;
    if (activeCursor && items.length > 0) {
      const first = items[0]!;
      previousCursor = encodeCursor(
        Object.fromEntries(orders.map((o) => [o.column!, first[o.column!]])),
      );
    }

    return new CursorPaginator(items, size, {
      path: options.path,
      cursorName,
      nextCursor,
      previousCursor,
    });
  }

  async insert(
    values: Record<string, unknown> | Record<string, unknown>[],
  ): Promise<boolean> {
    const rows = Array.isArray(values) ? values : [values];
    if (rows.length === 0) return true;
    const columns = Object.keys(rows[0]!);
    if (columns.length === 0) return true;
    const wrapped = columns.map((c) => this.#wrap(c));
    const rowPlaceholders = `(${columns.map(() => "?").join(", ")})`;
    const sql = `INSERT INTO ${this.#table} (${wrapped.join(", ")}) VALUES ${rows
      .map(() => rowPlaceholders)
      .join(", ")}`;
    const bindings = rows.flatMap((row) => columns.map((column) => row[column]));
    await this.#connection.run(sql, bindings);
    for (const row of rows) {
      await fireQueryInsertHook(this.#table, row, this.#connection);
    }
    return true;
  }

  /** Insert, ignoring unique/primary conflicts; returns affected rows. */
  async insertOrIgnore(
    values: Record<string, unknown> | Record<string, unknown>[],
  ): Promise<number> {
    const rows = Array.isArray(values) ? values : [values];
    if (rows.length === 0) return 0;
    const columns = Object.keys(rows[0]!);
    if (columns.length === 0) return 0;
    const rowPlaceholders = `(${columns.map(() => "?").join(", ")})`;
    const placeholders = rows.map(() => rowPlaceholders).join(", ");
    const cols = columns.map((c) => this.#wrap(c)).join(", ");
    const bindings = rows.flatMap((row) => columns.map((column) => row[column]));
    const driver = this.#connection.driver;
    let sql: string;
    if (isMysqlFamily(driver)) {
      sql = `INSERT IGNORE INTO ${this.#table} (${cols}) VALUES ${placeholders}`;
    } else if (driver === "postgres") {
      sql = `INSERT INTO ${this.#table} (${cols}) VALUES ${placeholders} ON CONFLICT DO NOTHING`;
    } else if (driver === "sqlsrv") {
      // SQL Server has no INSERT IGNORE equivalent; duplicate errors still surface.
      sql = `INSERT INTO ${this.#table} (${cols}) VALUES ${placeholders}`;
    } else {
      sql = `INSERT OR IGNORE INTO ${this.#table} (${cols}) VALUES ${placeholders}`;
    }
    const affected = await this.#connection.run(sql, bindings);
    for (const row of rows) {
      await fireQueryInsertHook(this.#table, row, this.#connection);
    }
    return affected;
  }

  insertGetId(
    values: Record<string, unknown>,
    idColumn = "id",
  ): number | Promise<number> {
    const columns = Object.keys(values);
    const payload = Object.values(values);
    const sync = this.#connection.insertGetIdSync;
    const id = sync
      ? sync.call(this.#connection, this.#table, columns, payload, idColumn)
      : undefined;

    const after = (newId: number): number | Promise<number> => {
      const hooked = fireQueryInsertHook(
        this.#table,
        { ...values, [idColumn]: newId },
        this.#connection,
      );
      if (hooked instanceof Promise) {
        return hooked.then(() => newId);
      }
      return newId;
    };

    if (sync) return after(id as number);
    return this.#connection
      .insertGetId(this.#table, columns, payload, idColumn)
      .then(after);
  }

  async update(values: Record<string, unknown>): Promise<number> {
    const columns = Object.keys(values);
    if (columns.length === 0) return 0;
    const rows = await this.#previewWriteRows();
    const sets = columns.map((c) => `${this.#wrap(c)} = ?`).join(", ");
    const { clause, params } = this.#whereSql();
    const sql = `UPDATE ${this.#table} SET ${sets}${clause}`;
    const affected = await this.#connection.run(sql, [
      ...Object.values(values),
      ...params,
    ]);
    await fireQueryWriteHook({
      table: this.#table,
      op: "update",
      connection: this.#connection,
      values,
      rows: rows.map((row) => ({ ...row, ...values })),
    });
    return affected;
  }

  async delete(): Promise<number> {
    const rows = await this.#previewWriteRows();
    const { clause, params } = this.#whereSql();
    const affected = await this.#connection.run(
      `DELETE FROM ${this.#table}${clause}`,
      params,
    );
    await fireQueryWriteHook({
      table: this.#table,
      op: "delete",
      connection: this.#connection,
      rows,
    });
    return affected;
  }

  async #previewWriteRows(): Promise<Record<string, unknown>[]> {
    if (!shouldPreviewQueryWrite()) return [];
    if (this.#table.includes("(")) return [];
    const preview = this.clone();
    preview.#columns = null;
    preview.#selectBindings = [];
    return await preview.getRows();
  }

  /** `increment`. */
  async increment(column: string, amount = 1): Promise<void> {
    const rows = await this.#previewWriteRows();
    const { clause, params } = this.#whereSql();
    const wrapped = this.#wrap(column);
    await this.#connection.run(
      `UPDATE ${this.#table} SET ${wrapped} = ${wrapped} + ?${clause}`,
      [amount, ...params],
    );
    await fireQueryWriteHook({
      table: this.#table,
      op: "update",
      connection: this.#connection,
      values: { [column]: amount },
      rows: rows.map((row) => ({
        ...row,
        [column]: Number(row[column] ?? 0) + amount,
      })),
    });
  }

  /** `decrement`. */
  async decrement(column: string, amount = 1): Promise<void> {
    await this.increment(column, -amount);
  }

  /** Increment multiple columns in one update. */
  async incrementEach(columns: Record<string, number>): Promise<void> {
    const entries = Object.entries(columns);
    if (entries.length === 0) return;
    const rows = await this.#previewWriteRows();
    const { clause, params } = this.#whereSql();
    const sets = entries
      .map(([col]) => {
        const wrapped = this.#wrap(col);
        return `${wrapped} = ${wrapped} + ?`;
      })
      .join(", ");
    await this.#connection.run(
      `UPDATE ${this.#table} SET ${sets}${clause}`,
      [...entries.map(([, amount]) => amount), ...params],
    );
    await fireQueryWriteHook({
      table: this.#table,
      op: "update",
      connection: this.#connection,
      values: columns,
      rows: rows.map((row) => {
        const next = { ...row };
        for (const [col, amount] of entries) {
          next[col] = Number(row[col] ?? 0) + amount;
        }
        return next;
      }),
    });
  }

  async decrementEach(columns: Record<string, number>): Promise<void> {
    const negated: Record<string, number> = {};
    for (const [col, amount] of Object.entries(columns)) {
      negated[col] = -amount;
    }
    await this.incrementEach(negated);
  }

  /** `updateOrInsert`. */
  async updateOrInsert(
    attributes: Record<string, unknown>,
    values:
      | Record<string, unknown>
      | ((exists: boolean) => Record<string, unknown>) = {},
  ): Promise<boolean> {
    let q: QueryBuilder = new QueryBuilder(this.#connection, this.#table);
    for (const [column, value] of Object.entries(attributes)) {
      q = q.where(column, value);
    }
    const exists = await q.exists();
    const resolved = typeof values === "function" ? values(exists) : values;
    if (exists) {
      await q.update({ ...resolved });
      return true;
    }
    await this.insert({ ...attributes, ...resolved });
    return true;
  }

  /** `upsert` — insert or update on conflict (SQLite/Postgres/MySQL). */
  async upsert(
    values: Record<string, unknown> | Record<string, unknown>[],
    uniqueBy: string | string[],
    update: string[] | null = null,
  ): Promise<number> {
    const rows = Array.isArray(values) ? values : [values];
    if (rows.length === 0) return 0;
    const uniqueCols = Array.isArray(uniqueBy) ? uniqueBy : [uniqueBy];
    const columns = Object.keys(rows[0]!);
    const updateCols =
      update ?? columns.filter((c) => !uniqueCols.includes(c));

    let affected = 0;
    for (const row of rows) {
      const placeholders = columns.map(() => "?").join(", ");
      const insertSql = `INSERT INTO ${this.#table} (${columns.join(", ")}) VALUES (${placeholders})`;
      const vals = columns.map((c) => row[c]);

      if (this.#connection.driver === "sqlite") {
        const conflict = uniqueCols.join(", ");
        const sets = updateCols.map((c) => `${c} = excluded.${c}`).join(", ");
        affected += await this.#connection.run(
          `${insertSql} ON CONFLICT(${conflict}) DO UPDATE SET ${sets}`,
          vals,
        );
      } else if (this.#connection.driver === "postgres") {
        const conflict = uniqueCols.join(", ");
        const sets = updateCols.map((c) => `${c} = EXCLUDED.${c}`).join(", ");
        affected += await this.#connection.run(
          `${insertSql} ON CONFLICT (${conflict}) DO UPDATE SET ${sets}`,
          vals,
        );
      } else if (this.#connection.driver === "sqlsrv") {
        const on = uniqueCols
          .map((c) => `target.${c} = source.${c}`)
          .join(" AND ");
        const updates = updateCols
          .map((c) => `target.${c} = source.${c}`)
          .join(", ");
        const insertCols = columns.join(", ");
        const insertVals = columns.map((c) => `source.${c}`).join(", ");
        const sourceSelect = columns
          .map((c) => `? AS ${c}`)
          .join(", ");
        affected += await this.#connection.run(
          `MERGE ${this.#table} AS target
           USING (SELECT ${sourceSelect}) AS source
           ON (${on})
           WHEN MATCHED THEN UPDATE SET ${updates}
           WHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals});`,
          vals,
        );
      } else {
        const sets = updateCols.map((c) => `${c} = VALUES(${c})`).join(", ");
        affected += await this.#connection.run(
          `${insertSql} ON DUPLICATE KEY UPDATE ${sets}`,
          vals,
        );
      }
    }
    return affected;
  }

  /** `truncate`. */
  async truncate(): Promise<void> {
    if (this.#connection.driver === "sqlite") {
      await this.#connection.exec(`DELETE FROM ${this.#table}`);
      return;
    }
    await this.#connection.exec(`TRUNCATE TABLE ${this.#table}`);
  }

  #compileSelect(): { sql: string; params: unknown[] } {
    if (this.#unions.length > 0) {
      const first = this.#compileSelectBase({
        withOrder: false,
        withLimit: false,
        withLock: false,
      });
      const parts: string[] = [first.sql];
      const params: unknown[] = [...first.params];
      for (const u of this.#unions) {
        const compiled = u.query.#compileSelectBase({
          withOrder: false,
          withLimit: false,
          withLock: false,
        });
        parts.push(`${u.all ? "UNION ALL" : "UNION"} ${compiled.sql}`);
        params.push(...compiled.params);
      }
      let unionSql = parts.join(" ");
      const hasOuter =
        this.#orders.length > 0 ||
        this.#limitValue !== undefined ||
        this.#offsetValue !== undefined;
      if (hasOuter) {
        // Wrap so ORDER BY / LIMIT apply to the combined result (SQLite-safe).
        unionSql = `SELECT * FROM (${unionSql}) as bunyad_union`;
        if (this.#orders.length > 0) {
          unionSql += ` ORDER BY ${this.#orders
            .map((o) =>
              o.raw
                ? o.raw
                : `${this.#wrap(o.column!)} ${(o.direction ?? "asc").toUpperCase()}`,
            )
            .join(", ")}`;
        }
        if (this.#connection.driver === "sqlsrv") {
          if (
            this.#limitValue !== undefined ||
            this.#offsetValue !== undefined
          ) {
            if (this.#orders.length === 0) {
              unionSql += ` ORDER BY (SELECT 0)`;
            }
            unionSql += ` OFFSET ${this.#offsetValue ?? 0} ROWS`;
            if (this.#limitValue !== undefined) {
              unionSql += ` FETCH NEXT ${this.#limitValue} ROWS ONLY`;
            }
          }
        } else {
          if (this.#limitValue !== undefined) {
            unionSql += ` LIMIT ${this.#limitValue}`;
          }
          if (this.#offsetValue !== undefined) {
            unionSql += ` OFFSET ${this.#offsetValue}`;
          }
        }
      }
      unionSql += lockClause(this.#lock, this.#connection.driver);
      return { sql: unionSql, params };
    }

    return this.#compileSelectBase({
      withOrder: true,
      withLimit: true,
      withLock: true,
    });
  }

  #compileSelectBase(options: {
    withOrder: boolean;
    withLimit: boolean;
    withLock: boolean;
  }): { sql: string; params: unknown[] } {
    const cols = this.#compileColumns();
    const { clause, params, joinSql } = this.#whereAndJoins();
    // Avoid empty spreads on the common path (no selectRaw / fromSub).
    const allParams =
      this.#selectBindings.length === 0 && this.#fromBindings.length === 0
        ? params
        : [...this.#selectBindings, ...this.#fromBindings, ...params];
    const distinct = this.#distinct ? "DISTINCT " : "";
    let sql = `SELECT ${distinct}${cols} FROM ${this.#table}${joinSql}${clause}`;
    if (this.#groups.length > 0) {
      sql += ` GROUP BY ${this.#groups.join(", ")}`;
    }
    if (this.#havings.length > 0) {
      const havingParts: string[] = [];
      for (let i = 0; i < this.#havings.length; i++) {
        const h = this.#havings[i]!;
        const bool = i === 0 ? "" : ` ${h.boolean.toUpperCase()} `;
        if (h.type === "raw") {
          havingParts.push(`${bool}${h.sql}`);
          allParams.push(...h.params);
        } else if (h.type === "between") {
          allParams.push(h.values[0], h.values[1]);
          havingParts.push(
            `${bool}${h.column} ${h.not ? "NOT BETWEEN" : "BETWEEN"} ? AND ?`,
          );
        } else if (h.type === "null") {
          havingParts.push(
            `${bool}${h.column} ${h.not ? "IS NOT" : "IS"} NULL`,
          );
        } else {
          havingParts.push(`${bool}${h.column} ${h.op} ?`);
          allParams.push(h.value);
        }
      }
      sql += ` HAVING ${havingParts.join("")}`;
    }
    if (options.withOrder && this.#orders.length > 0) {
      sql += ` ORDER BY ${this.#orders
        .map((o) =>
          o.raw
            ? o.raw
            : `${this.#wrap(o.column!)} ${(o.direction ?? "asc").toUpperCase()}`,
        )
        .join(", ")}`;
    }
    if (options.withLimit) {
      if (this.#connection.driver === "sqlsrv") {
        if (
          this.#limitValue !== undefined ||
          this.#offsetValue !== undefined
        ) {
          if (this.#orders.length === 0) {
            sql += ` ORDER BY (SELECT 0)`;
          }
          sql += ` OFFSET ${this.#offsetValue ?? 0} ROWS`;
          if (this.#limitValue !== undefined) {
            sql += ` FETCH NEXT ${this.#limitValue} ROWS ONLY`;
          }
        }
      } else {
        if (this.#limitValue !== undefined) {
          sql += ` LIMIT ${this.#limitValue}`;
        }
        if (this.#offsetValue !== undefined) {
          sql += ` OFFSET ${this.#offsetValue}`;
        }
      }
    }
    if (options.withLock) {
      sql += lockClause(this.#lock, this.#connection.driver);
    }
    return { sql, params: allParams };
  }

  #whereAndJoins(): { clause: string; params: unknown[]; joinSql: string } {
    const joinParams: unknown[] = [];
    const joinSql = this.#joins
      .map((j) => {
        if (j.bindings?.length) joinParams.push(...j.bindings);
        if (j.type === "cross") return ` CROSS JOIN ${j.table}`;
        const kind =
          j.type === "left"
            ? "LEFT JOIN"
            : j.type === "right"
              ? "RIGHT JOIN"
              : "INNER JOIN";
        const clauses = j.clauses ?? [];
        const on = clauses
          .map((clause, index) => {
            const boolean = index === 0 ? "" : ` ${clause.boolean.toUpperCase()} `;
            if (clause.where) {
              joinParams.push(clause.second);
              return `${boolean}${clause.first} ${clause.op} ?`;
            }
            return `${boolean}${clause.first} ${clause.op} ${String(clause.second)}`;
          })
          .join("");
        return ` ${kind} ${j.table} ON ${on}`;
      })
      .join("");
    const { clause, params } = this.#whereSql();
    return {
      clause,
      params: joinParams.length === 0 ? params : [...joinParams, ...params],
      joinSql,
    };
  }

  /**
   * Keyset "after cursor" constraint for ordered columns.
   * `(a > ?) OR (a = ? AND b > ?) OR ...`
   */
  #applyCursorConstraint(
    orders: Order[],
    cursor: Record<string, unknown>,
    after: boolean,
  ): void {
    const parts: string[] = [];
    const params: unknown[] = [];
    for (let i = 0; i < orders.length; i++) {
      const equalities: string[] = [];
      for (let j = 0; j < i; j++) {
        equalities.push(`${orders[j]!.column} = ?`);
        params.push(cursor[orders[j]!.column!]);
      }
      const order = orders[i]!;
      const dir = order.direction ?? "asc";
      const gt = after
        ? dir === "asc"
          ? ">"
          : "<"
        : dir === "asc"
          ? "<"
          : ">";
      equalities.push(`${order.column} ${gt} ?`);
      params.push(cursor[order.column!]);
      parts.push(`(${equalities.join(" AND ")})`);
    }
    this.whereRaw(`(${parts.join(" OR ")})`, params);
  }

  #applyCasts(row: Record<string, unknown>): Record<string, unknown> {
    const keys = Object.keys(this.#casts);
    if (keys.length === 0) return row;
    const out = { ...row };
    for (const key of keys) {
      if (!(key in out) || out[key] === null || out[key] === undefined) continue;
      out[key] = applyQueryCast(
        out[key],
        this.#casts[key]!,
        this.#connection.driver,
      );
    }
    return out;
  }

  #whereSql(): { clause: string; params: unknown[] } {
    if (this.#wheres.length === 0) return { clause: "", params: [] };
    const params: unknown[] = [];
    const parts = this.#wheres.map((w, index) => {
      const bool = index === 0 ? "" : ` ${w.boolean.toUpperCase()} `;
      if (w.type === "null") {
        return `${bool}${this.#wrap(w.column!)} ${w.op} NULL`;
      }
      if (w.type === "in") {
        const values = w.values ?? [];
        if (values.length === 0) {
          return `${bool}${w.op === "NOT IN" ? "1 = 1" : "0 = 1"}`;
        }
        const placeholders = values.map(() => "?").join(", ");
        params.push(...values);
        return `${bool}${this.#wrap(w.column!)} ${w.op} (${placeholders})`;
      }
      if (w.type === "between") {
        const values = w.values ?? [];
        params.push(values[0], values[1]);
        return `${bool}${this.#wrap(w.column!)} ${w.not ? "NOT BETWEEN" : "BETWEEN"} ? AND ?`;
      }
      if (w.type === "column") {
        return `${bool}${this.#wrap(w.column!)} ${w.op} ${this.#wrap(String(w.value))}`;
      }
      if (w.type === "exists") {
        params.push(...(w.params ?? []));
        return `${bool}${w.not ? "NOT EXISTS" : "EXISTS"} (${w.sql})`;
      }
      if (w.type === "raw") {
        params.push(...(w.params ?? []));
        return `${bool}${w.sql}`;
      }
      params.push(w.value);
      return `${bool}${this.#wrap(w.column!)} ${w.op} ?`;
    });
    return {
      clause: ` WHERE ${parts.join("")}`,
      params,
    };
  }

  #wrap(name: string): string {
    return wrapSqlName(this.#connection.dialect, name);
  }

  /**
   * Quote plain column names (`id`, `categories.order`) so reserved words work;
   * expressions, aliases and `*` from `selectRaw`/`selectSub` pass through.
   */
  #compileColumns(): string {
    if (this.#columns === null) return "*";
    return this.#columns
      .map((column) =>
        PLAIN_COLUMN.test(column.trim()) ? this.#wrap(column) : column,
      )
      .join(", ");
  }
}

const PLAIN_COLUMN = /^[A-Za-z_][A-Za-z0-9_]*(\.([A-Za-z_][A-Za-z0-9_]*|\*))*$/;

function applyQueryCast(
  value: unknown,
  type: QueryCastType,
  _driver: DriverName,
): unknown {
  switch (type) {
    case "boolean":
      return value === true || value === 1 || value === "1" || value === "true";
    case "number":
      return Number(value);
    case "string":
      return String(value);
    case "json":
    case "array":
      if (typeof value === "string") {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return value;
    case "date":
    case "datetime":
      return toDate(value as DateInput);
  }
}

export class DatabaseManager {
  constructor(readonly connection: Connection) {}

  table(name: string): QueryBuilder {
    return new QueryBuilder(this.connection, name);
  }
}
