import type { QueryGroup, QueryRecord } from "./types.ts";

/** Strip literals so statements that differ only by values share one shape. */
export function normalizeSql(sql: string): string {
  return sql
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "?")
    .replace(/\b\d+(?:\.\d+)?\b/g, "?")
    .replace(/\$\d+/g, "?")
    .replace(/\(\s*\?(?:\s*,\s*\?)+\s*\)/g, "(?)")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isRead(sql: string): boolean {
  return /^\s*(select|with)\b/i.test(sql);
}

const key = (query: QueryRecord) => `${query.sql}\u0000${JSON.stringify(query.bindings)}`;

export type QueryAnalysis = {
  duplicates: number;
  nPlusOne: number;
  groups: QueryGroup[];
};

/**
 * Flag queries in place and report what was found.
 * - duplicate: identical SQL and bindings ran more than once.
 * - nPlusOne: a read whose shape ran `threshold`+ times with differing bindings.
 */
export function analyzeQueries(queries: QueryRecord[], threshold: number): QueryAnalysis {
  const identical = new Map<string, number>();
  for (const query of queries) identical.set(key(query), (identical.get(key(query)) ?? 0) + 1);

  let duplicates = 0;
  for (const query of queries) {
    if ((identical.get(key(query)) ?? 0) > 1) {
      query.duplicate = true;
      duplicates++;
    }
  }

  const shapes = new Map<string, QueryRecord[]>();
  for (const query of queries) {
    if (!isRead(query.sql)) continue;
    const shape = normalizeSql(query.sql);
    const list = shapes.get(shape);
    if (list) list.push(query);
    else shapes.set(shape, [query]);
  }

  let nPlusOne = 0;
  const groups: QueryGroup[] = [];
  for (const [, list] of shapes) {
    const distinct = new Set(list.map((query) => JSON.stringify(query.bindings))).size;
    if (list.length < threshold || distinct < 2) continue;
    for (const query of list) {
      query.nPlusOne = true;
      query.repeats = list.length;
    }
    nPlusOne += list.length;
    groups.push({
      sql: list[0]!.sql,
      count: list.length,
      totalMs: list.reduce((sum, query) => sum + query.timeMs, 0),
      origin: list.find((query) => query.origin)?.origin ?? null,
    });
  }
  groups.sort((a, b) => b.totalMs - a.totalMs);

  return { duplicates, nPlusOne, groups };
}

/**
 * Time actually spent waiting on queries: the union of their [start, end] spans.
 * Queries that overlap (loaded in parallel) count once, so this can never exceed the
 * request time, unlike the sum of their durations.
 */
export function wallTimeMs(queries: QueryRecord[]): number {
  const spans = queries.map((query) => [query.at, query.at + query.timeMs] as const).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let end = -Infinity;
  let start = 0;
  for (const [from, to] of spans) {
    if (from > end) {
      if (end > -Infinity) total += end - start;
      start = from;
      end = to;
    } else if (to > end) {
      end = to;
    }
  }
  return end > -Infinity ? total + (end - start) : 0;
}
