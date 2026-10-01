/**
 * Database query failure with SQL context and a recoverable JS call stack.
 *
 * Bun's Postgres/MySQL drivers replace `Error.stack` with native
 * `internal:sql/*` frames only. Capture a sync stack before `await` and
 * rethrow as this type so debug exception pages can blame application code.
 */

export type QueryExceptionOptions = {
  sql?: string;
  bindings?: unknown[];
  /** SQLSTATE / driver code when available. */
  sqlState?: string | null;
  cause?: unknown;
  /**
   * Stack string captured before the failing `await` (includes app frames).
   * When set, replaces this error's stack while keeping the native error as `cause`.
   */
  callerStack?: string | null;
};

function sqlStateOf(error: unknown): string | null {
  if (error == null || typeof error !== "object") return null;
  const row = error as Record<string, unknown>;
  // Bun PostgresError: errno holds SQLSTATE (e.g. 22P02); code is ERR_POSTGRES_*
  if (typeof row.errno === "string" && /^[0-9A-Z]{5}$/i.test(row.errno)) {
    return row.errno;
  }
  if (typeof row.code === "string" && /^[0-9A-Z]{5}$/i.test(row.code)) {
    return row.code;
  }
  if (typeof row.sqlState === "string") return row.sqlState;
  return null;
}

function formatMessage(
  message: string,
  sqlState: string | null,
  sql: string | undefined,
): string {
  const parts: string[] = [];
  if (sqlState) parts.push(`SQLSTATE[${sqlState}]`);
  parts.push(message);
  if (sql) parts.push(`(SQL: ${sql})`);
  return parts.join(" ");
}

function applyCallerStack(
  error: QueryException,
  callerStack: string | null | undefined,
): void {
  if (!callerStack) return;
  const body = callerStack.includes("\n")
    ? callerStack.slice(callerStack.indexOf("\n") + 1)
    : callerStack;
  error.stack = `${error.name}: ${error.message}\n${body}`;
}

export class QueryException extends Error {
  readonly sql: string;
  readonly bindings: unknown[];
  readonly sqlState: string | null;

  constructor(message: string, options: QueryExceptionOptions = {}) {
    const sqlState = options.sqlState ?? sqlStateOf(options.cause);
    const sql = options.sql ?? "";
    super(formatMessage(message, sqlState, sql || undefined), {
      cause: options.cause,
    });
    this.name = "QueryException";
    this.sql = sql;
    this.bindings = options.bindings ?? [];
    this.sqlState = sqlState;
    applyCallerStack(this, options.callerStack);
  }

  /** Wrap a driver error, preserving native details as `cause`. */
  static wrap(
    error: unknown,
    options: Omit<QueryExceptionOptions, "cause"> & { cause?: unknown } = {},
  ): QueryException {
    if (error instanceof QueryException) return error;
    const native = error instanceof Error ? error : new Error(String(error));
    return new QueryException(native.message || "Database query failed", {
      ...options,
      cause: options.cause ?? error,
      sqlState: options.sqlState ?? sqlStateOf(error),
    });
  }
}

/** Whether debug builds should capture a pre-await caller stack for SQL errors. */
export function shouldCaptureQueryCallerStack(): boolean {
  return (
    process.env.APP_DEBUG === "true" ||
    process.env.APP_DEBUG === "1" ||
    (process.env.NODE_ENV !== "production" &&
      process.env.APP_DEBUG !== "false")
  );
}
