import { expect, test } from "bun:test";
import { affectedRowsFromResult } from "./connection-contract.ts";

test("affectedRowsFromResult reads each driver's result shape", () => {
  // Bun MySQL: `count` is rows returned (0 for writes), `affectedRows` is the real number.
  expect(affectedRowsFromResult({ count: 0, affectedRows: 3, lastInsertRowid: 0 })).toBe(3);
  // Bun Postgres: `count` is the affected row count.
  expect(affectedRowsFromResult({ count: 2, command: "DELETE" })).toBe(2);
  // SQLite.
  expect(affectedRowsFromResult({ changes: 4 })).toBe(4);
  // node-postgres / mssql shapes.
  expect(affectedRowsFromResult({ rowCount: 5 })).toBe(5);
  expect(affectedRowsFromResult({ rowsAffected: [1, 2] })).toBe(3);
  expect(affectedRowsFromResult(null)).toBe(0);
  expect(affectedRowsFromResult([])).toBe(0);
});
