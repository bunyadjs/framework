import { normalizeSql } from "./queries.ts";
import type { QueryOrigin, Snapshot } from "./types.ts";

const round = (value: number, places = 1) => Math.round(value * 10 ** places) / 10 ** places;

export type SnapshotFilter = {
  kind?: string;
  pathContains?: string;
};

export function select(snapshots: Snapshot[], filter: SnapshotFilter = {}): Snapshot[] {
  return snapshots.filter(
    (s) =>
      (s.kind ?? "http") === (filter.kind ?? "http") &&
      (!filter.pathContains || s.request.path.includes(filter.pathContains)),
  );
}

export type HotQuery = {
  sql: string;
  runs: number;
  /** In how many different requests it ran. */
  requests: number;
  /** requests / all requests in the window: near 1 means "runs in every request". */
  requestShare: number;
  /** Sum of durations. Includes any wait for a database connection; parallel queries overlap. */
  totalMs: number;
  avgMs: number;
  maxMs: number;
  /** Where one of them was issued, when known. */
  at?: string;
};

export type HotQuerySort = "totalMs" | "runs" | "requests";

/**
 * The query shapes (values stripped) that cost the most across many requests. This is where a
 * query that is cheap alone but runs in every request (permission checks, tenant lookups) shows up,
 * which looking at one request at a time never reveals.
 */
export function hotQueries(
  snapshots: Snapshot[],
  options: { sortBy?: HotQuerySort; limit?: number; minRequests?: number } = {},
): { window: { requests: number; queries: number; summedMs: number; from?: string; to?: string }; shapes: HotQuery[] } {
  const groups = new Map<string, { sql: string; runs: number; ids: Set<string>; totalMs: number; maxMs: number; origin?: QueryOrigin | null }>();
  let queries = 0;
  let summedMs = 0;

  for (const snapshot of snapshots) {
    for (const query of snapshot.queries.items) {
      queries++;
      summedMs += query.timeMs;
      const shape = normalizeSql(query.sql);
      const group = groups.get(shape) ?? { sql: query.sql, runs: 0, ids: new Set(), totalMs: 0, maxMs: 0 };
      group.runs++;
      group.ids.add(snapshot.id);
      group.totalMs += query.timeMs;
      group.maxMs = Math.max(group.maxMs, query.timeMs);
      group.origin ??= query.origin;
      groups.set(shape, group);
    }
  }

  const minRequests = options.minRequests ?? 1;
  const sortBy = options.sortBy ?? "totalMs";
  const shapes = [...groups.values()]
    .filter((g) => g.ids.size >= minRequests)
    .map<HotQuery>((g) => ({
      sql: g.sql,
      runs: g.runs,
      requests: g.ids.size,
      requestShare: round(g.ids.size / Math.max(snapshots.length, 1), 2),
      totalMs: round(g.totalMs),
      avgMs: round(g.totalMs / g.runs, 2),
      maxMs: round(g.maxMs),
      ...(g.origin ? { at: `${g.origin.file}:${g.origin.line}` } : {}),
    }))
    .sort((a, b) => (sortBy === "runs" ? b.runs - a.runs : sortBy === "requests" ? b.requests - a.requests : b.totalMs - a.totalMs))
    .slice(0, options.limit ?? 10);

  const times = snapshots.map((s) => s.collectedAt).sort();
  return {
    window: { requests: snapshots.length, queries, summedMs: round(summedMs), from: times[0], to: times[times.length - 1] },
    shapes,
  };
}

export type RouteStat = {
  route: string;
  example: string;
  hits: number;
  avgMs: number;
  maxMs: number;
  avgQueries: number;
  maxQueries: number;
  /** Average elapsed time in queries (parallel queries counted once). */
  avgQueryMs: number;
  duplicates: number;
  nPlusOne: number;
  errors: number;
  /** Highest number of queries in flight at once in any hit. */
  peakInFlight: number;
};

export type RouteSort = "avgMs" | "maxMs" | "avgQueries" | "hits" | "errors" | "nPlusOne" | "duplicates";

/** Per-route totals, so slow, chatty or failing endpoints stand out. Grouped by route name, else path. */
export function routeStats(snapshots: Snapshot[], options: { sortBy?: RouteSort; limit?: number } = {}): RouteStat[] {
  const groups = new Map<string, Snapshot[]>();
  for (const snapshot of snapshots) {
    const key = `${snapshot.request.method} ${snapshot.request.route.name ?? snapshot.request.path}`;
    const list = groups.get(key);
    if (list) list.push(snapshot);
    else groups.set(key, [snapshot]);
  }

  const sum = (list: Snapshot[], pick: (s: Snapshot) => number) => list.reduce((total, s) => total + pick(s), 0);
  const stats = [...groups].map<RouteStat>(([route, list]) => ({
    route,
    example: list[0]!.request.path,
    hits: list.length,
    avgMs: round(sum(list, (s) => s.request.durationMs) / list.length),
    maxMs: round(Math.max(...list.map((s) => s.request.durationMs))),
    avgQueries: round(sum(list, (s) => s.queries.count) / list.length),
    maxQueries: Math.max(...list.map((s) => s.queries.count)),
    avgQueryMs: round(sum(list, (s) => s.queries.wallMs ?? s.queries.totalMs) / list.length),
    duplicates: sum(list, (s) => s.queries.duplicates),
    nPlusOne: sum(list, (s) => s.queries.nPlusOne),
    errors: list.filter((s) => s.request.status >= 500).length,
    peakInFlight: Math.max(...list.map((s) => s.queries.peakInFlight ?? 0)),
  }));

  const sortBy = options.sortBy ?? "avgMs";
  return stats.sort((a, b) => b[sortBy] - a[sortBy]).slice(0, options.limit ?? 10);
}
