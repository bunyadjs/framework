import { expect, test } from "bun:test";
import {
  QueryException,
  shouldCaptureQueryCallerStack,
} from "../src/query-exception.ts";

test("QueryException formats SQLSTATE and SQL into the message", () => {
  const err = new QueryException('invalid input syntax for type bigint: "10000+"', {
    sql: "select * from users where id = $1",
    bindings: ["10000+"],
    sqlState: "22P02",
  });
  expect(err.name).toBe("QueryException");
  expect(err.message).toContain("SQLSTATE[22P02]");
  expect(err.message).toContain("SQL: select * from users where id = $1");
  expect(err.sql).toBe("select * from users where id = $1");
  expect(err.bindings).toEqual(["10000+"]);
  expect(err.sqlState).toBe("22P02");
});

test("QueryException.wrap replaces stack with pre-await caller frames", () => {
  const native = new Error('invalid input syntax for type bigint: "10000+"');
  native.name = "PostgresError";
  native.stack = `PostgresError: invalid input syntax for type bigint: "10000+"
    at wrapPostgresError (internal:sql/postgres:176:27)`;

  const caller = new Error("caller");
  caller.stack = `Error: caller
    at runUnsafe (/tmp/packages/database/src/connection.ts:10:5)
    at findOrFail (/tmp/packages/orm/src/model.ts:20:5)
    at <anonymous> (/tmp/app/routes/web.ts:12:5)`;

  const wrapped = QueryException.wrap(native, {
    sql: "select 1",
    bindings: [],
    callerStack: caller.stack,
  });

  expect(wrapped).toBeInstanceOf(QueryException);
  expect(wrapped.cause).toBe(native);
  expect(wrapped.stack).toContain("/tmp/app/routes/web.ts:12:5");
  expect(wrapped.stack).not.toContain("internal:sql/postgres");
});

test("QueryException.wrap reads SQLSTATE from Bun PostgresError errno", () => {
  const native = Object.assign(new Error("bad"), {
    name: "PostgresError",
    code: "ERR_POSTGRES_SERVER_ERROR",
    errno: "22P02",
  });
  const wrapped = QueryException.wrap(native, { sql: "select 1" });
  expect(wrapped.sqlState).toBe("22P02");
  expect(wrapped.message).toContain("SQLSTATE[22P02]");
});

test("shouldCaptureQueryCallerStack follows APP_DEBUG", () => {
  const prevDebug = process.env.APP_DEBUG;
  const prevNode = process.env.NODE_ENV;
  try {
    process.env.APP_DEBUG = "true";
    expect(shouldCaptureQueryCallerStack()).toBe(true);
    process.env.APP_DEBUG = "false";
    process.env.NODE_ENV = "production";
    expect(shouldCaptureQueryCallerStack()).toBe(false);
  } finally {
    if (prevDebug === undefined) delete process.env.APP_DEBUG;
    else process.env.APP_DEBUG = prevDebug;
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
  }
});
