import { inspect } from "node:util";
import { expect, test } from "bun:test";
import { QueryException } from "./query-exception.ts";

test("bound values stay out of logs and serialised errors, but stay readable for debug pages", () => {
  const error = new QueryException("insert failed", {
    sql: "INSERT INTO users (password) VALUES (?)",
    bindings: ["s3cret-password-hash"],
  });

  expect(inspect(error)).not.toContain("s3cret-password-hash");
  expect(JSON.stringify(error)).not.toContain("s3cret-password-hash");
  expect(JSON.stringify({ ...error })).not.toContain("s3cret-password-hash");
  expect(error.message).not.toContain("s3cret-password-hash");

  expect(error.bindings).toEqual(["s3cret-password-hash"]);
  expect(error.getBindings()).toEqual(["s3cret-password-hash"]);
  expect(error.sql).toBe("INSERT INTO users (password) VALUES (?)");
});

test("wrapping a driver error keeps the bindings readable", () => {
  const wrapped = QueryException.wrap(new Error("boom"), {
    sql: "SELECT 1 WHERE a = ?",
    bindings: ["x"],
  });
  expect(wrapped.bindings).toEqual(["x"]);
});
