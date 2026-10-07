import { expect, test } from "bun:test";
import { hotQueries, routeStats } from "../src/analysis.ts";
import { peakInFlight } from "../src/queries.ts";
import type { QueryRecord, Snapshot } from "../src/types.ts";

const q = (at: number, timeMs: number): QueryRecord => ({
  sql: "select 1", bindings: [], timeMs, at, duplicate: false, slow: false, nPlusOne: false, repeats: 0, origin: null,
});

test("peakInFlight counts only queries that overlap in time", () => {
  expect(peakInFlight([])).toBe(0);
  expect(peakInFlight([q(0, 5)])).toBe(1);
  expect(peakInFlight([q(0, 2), q(3, 2), q(6, 2)])).toBe(1); // one after another
  expect(peakInFlight([q(0, 5), q(1, 5), q(2, 5)])).toBe(3);
  expect(peakInFlight([q(0, 5), q(5, 5)])).toBe(1); // one ends exactly as the next starts
  expect(peakInFlight([q(0, 10), q(2, 2), q(3, 2), q(8, 1)])).toBe(3); // 0-10 holds one slot throughout
  expect(peakInFlight([q(9, 1), q(0, 10), q(1, 1)])).toBe(2); // unsorted input
});

test("peakInFlight handles a large burst quickly", () => {
  const burst = Array.from({ length: 20_000 }, (_, i) => q(i % 50, 3));
  const start = performance.now();
  const peak = peakInFlight(burst);
  expect(performance.now() - start).toBeLessThan(150);
  expect(peak).toBeGreaterThan(1000);
});

const snap = (id: string, sqls: Array<[string, number]>, path = "/p"): Snapshot =>
  ({
    id, kind: "http", collectedAt: `2026-10-07T00:00:0${id}.000Z`,
    request: { method: "GET", path, status: 200, durationMs: 10, route: { name: null, params: {} } },
    queries: { count: sqls.length, totalMs: 0, duplicates: 0, nPlusOne: 0, slow: 0, groups: [], items: sqls.map(([sql, timeMs], i) => ({ ...q(i, timeMs), sql })) },
  }) as unknown as Snapshot;

test("hotQueries merges statements that differ only by values and ranks by total time", () => {
  const out = hotQueries([
    snap("1", [["select * from t where id = 1", 2], ["select * from big", 50]]),
    snap("2", [["select * from t where id = 2", 4]]),
    snap("3", [["SELECT * FROM t WHERE id = 3", 6]]),
  ]);
  expect(out.window).toMatchObject({ requests: 3, queries: 4, summedMs: 62 });
  expect(out.shapes[0]).toMatchObject({ sql: "select * from big", runs: 1, totalMs: 50 });
  expect(out.shapes[1]).toMatchObject({ runs: 3, requests: 3, requestShare: 1, totalMs: 12, avgMs: 4, maxMs: 6 });
});

test("hotQueries can rank by runs or by how many requests share it, and filter small ones out", () => {
  const snaps = [
    snap("1", [["select a", 1], ["select a", 1], ["select a", 1], ["select b", 1]]),
    snap("2", [["select b", 1]]),
  ];
  expect(hotQueries(snaps, { sortBy: "runs" }).shapes[0]).toMatchObject({ sql: "select a", runs: 3, requests: 1 });
  expect(hotQueries(snaps, { sortBy: "requests" }).shapes[0]).toMatchObject({ sql: "select b", requests: 2 });
  expect(hotQueries(snaps, { minRequests: 2 }).shapes.map((s) => s.sql)).toEqual(["select b"]);
  expect(hotQueries(snaps, { limit: 1 }).shapes).toHaveLength(1);
});

test("hotQueries copes with an empty window", () => {
  expect(hotQueries([])).toEqual({ window: { requests: 0, queries: 0, summedMs: 0, from: undefined, to: undefined }, shapes: [] });
});

test("routeStats averages, takes maxima, and tolerates missing newer fields", () => {
  const a = snap("1", [["select 1", 1]], "/a");
  const b = snap("2", [["select 1", 1], ["select 2", 1], ["select 3", 1]], "/a");
  b.request.durationMs = 30;
  b.request.status = 503;
  const stats = routeStats([a, b]);
  expect(stats).toHaveLength(1);
  expect(stats[0]).toMatchObject({ route: "GET /a", hits: 2, avgMs: 20, maxMs: 30, avgQueries: 2, maxQueries: 3, errors: 1, peakInFlight: 0 });
});
