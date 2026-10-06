import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { originFromStack } from "../src/origin.ts";
import { analyzeQueries, normalizeSql, wallTimeMs } from "../src/queries.ts";
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

const span = (at: number, timeMs: number) => ({ ...query("select 1", [], timeMs), at });

test("wallTimeMs counts overlapping queries once", () => {
  expect(wallTimeMs([])).toBe(0);
  expect(wallTimeMs([span(0, 2)])).toBe(2);
  expect(wallTimeMs([span(0, 2), span(5, 3)])).toBe(5); // sequential: same as the sum
  expect(wallTimeMs([span(0, 4), span(2, 4)])).toBe(6); // partial overlap: 0..6
  expect(wallTimeMs([span(0, 10), span(2, 3)])).toBe(10); // one inside another
  expect(wallTimeMs([span(5, 3), span(0, 2)])).toBe(5); // unsorted input
  expect(wallTimeMs([span(0, 2), span(2, 2)])).toBe(4); // touching
});

test("wallTimeMs matches a real parallel-loading request", () => {
  // Recorded from karobar's products list: 12 queries summing to 10.6ms in a 9.6ms request.
  const real = [
    [0.14, 0.91], [0.19, 0.96], [1.22, 0.85], [1.27, 0.85], [2.89, 0.98], [3.98, 0.78],
    [5.02, 0.84], [5.13, 2.14], [7.68, 0.54], [7.57, 0.75], [7.79, 0.62], [8.59, 0.39],
  ].map(([at, ms]) => span(at!, ms!));
  const summed = real.reduce((total, q) => total + q.timeMs, 0);
  expect(summed).toBeCloseTo(10.61, 1);
  expect(wallTimeMs(real)).toBeCloseTo(7.16, 1);
});

test("originFromStack skips runtime frames that are not files", () => {
  const stack = [
    "Error",
    "    at processTicksAndRejections (native:7:39)",
    "    at <anonymous> (<anonymous>:1:1)",
    "    at async load (/app/app/Services/ProductService.ts:31:9)",
  ].join("\n");
  expect(originFromStack(stack, "/app")).toEqual({
    file: "app/Services/ProductService.ts",
    line: 31,
    function: "load",
  });
  expect(originFromStack("Error\n    at processTicksAndRejections (native:7:39)", "/app")).toBeNull();
});
