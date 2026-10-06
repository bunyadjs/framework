import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { originFromStack } from "../src/origin.ts";
import { analyzeQueries, normalizeSql } from "../src/queries.ts";
import type { QueryRecord } from "../src/types.ts";

const query = (sql: string, bindings: unknown[] = [], timeMs = 1): QueryRecord => ({
  sql,
  bindings,
  timeMs,
  at: 0,
  duplicate: false,
  slow: false,
  nPlusOne: false,
  repeats: 0,
  origin: null,
});

test("normalizeSql strips literals, placeholders and IN lists", () => {
  expect(normalizeSql("SELECT * FROM t WHERE id = 42 AND name = 'bob'")).toBe(
    "select * from t where id = ? and name = ?",
  );
  expect(normalizeSql("select * from t where id in (?, ?, ?)")).toBe("select * from t where id in (?)");
  expect(normalizeSql("select * from t where id = $1")).toBe(normalizeSql("select * from t where id = $2"));
});

test("flags a read repeated with different bindings as N+1", () => {
  const items = [
    query("select * from products where id = ?", [1]),
    ...Array.from({ length: 6 }, (_, i) => query("select * from stock where product_id = ?", [i], 2)),
  ];
  const result = analyzeQueries(items, 5);

  expect(result.nPlusOne).toBe(6);
  expect(result.groups).toHaveLength(1);
  expect(result.groups[0]).toMatchObject({ count: 6, totalMs: 12 });
  expect(items[0]!.nPlusOne).toBe(false);
  expect(items[3]!).toMatchObject({ nPlusOne: true, repeats: 6 });
});

test("below the threshold, or with identical bindings, is not N+1", () => {
  const few = Array.from({ length: 4 }, (_, i) => query("select 1 from t where id = ?", [i]));
  expect(analyzeQueries(few, 5).nPlusOne).toBe(0);

  const same = Array.from({ length: 6 }, () => query("select 1 from t where id = ?", [7]));
  const result = analyzeQueries(same, 5);
  expect(result.nPlusOne).toBe(0);
  expect(result.duplicates).toBe(6);
});

test("writes are never N+1", () => {
  const inserts = Array.from({ length: 8 }, (_, i) => query("insert into t (a) values (?)", [i]));
  expect(analyzeQueries(inserts, 5).nPlusOne).toBe(0);
});

test("originFromStack skips node_modules, runtime and framework frames", () => {
  const stack = [
    "Error",
    `    at captureOrigin (${resolve(import.meta.dir, "../src/origin.ts")}:40:5)`,
    "    at run (/repo/node_modules/@bunyad/database/src/q.ts:10:1)",
    "    at node:internal/process:1:1",
    "    at async ReportService.sales (/app/app/Services/ReportService.ts:88:17)",
    "    at /app/app/Http/Controllers/ReportController.ts:12:3",
  ].join("\n");

  expect(originFromStack(stack, "/app")).toEqual({
    file: "app/Services/ReportService.ts",
    line: 88,
    function: "ReportService.sales",
  });
});

test("originFromStack returns null when every frame is internal", () => {
  expect(originFromStack("Error\n    at x (node:internal/a:1:1)", "/app")).toBeNull();
});

test("originFromStack handles anonymous frames", () => {
  const origin = originFromStack("Error\n    at /app/routes/web.ts:5:9", "/app");
  expect(origin).toEqual({ file: "routes/web.ts", line: 5, function: null });
});
