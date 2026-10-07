import { Mcp, type McpTool } from "@bunyad/mcp";
import { levelWeight, type LogLevel } from "@bunyad/log";
import { hotQueries, routeStats, select, type HotQuerySort, type RouteSort } from "./analysis.ts";
import { MemoryDebugbarStore } from "./store.ts";
import type { DebugbarStore, QueryRecord, Snapshot } from "./types.ts";

const SQL_CHARS = 300;
const STACK_LINES = 15;

const cut = (text: string, max = SQL_CHARS) => (text.length > max ? `${text.slice(0, max)}… (+${text.length - max})` : text);

const MEMORY_NOTE =
  "No history is visible to this process. The debugbar keeps history in memory by default, which an MCP server cannot see. " +
  'Set `driver: "file"` in config/debugbar.ts, restart the app, and load a page.';

/** `latest` or an omitted id means the newest request. */
async function find(store: DebugbarStore, id: unknown): Promise<Snapshot | undefined> {
  if (typeof id === "string" && id !== "latest") return store.get(id);
  return (await store.list(1))[0];
}

async function missing(store: DebugbarStore, id: unknown) {
  if (store instanceof MemoryDebugbarStore) return { note: MEMORY_NOTE };
  if (typeof id === "string" && id !== "latest") return { error: `No request with id "${id}". Use debugbar_list_requests to see ids.` };
  return { note: "No requests recorded yet. Load a page in the app, then ask again." };
}

const row = (s: Snapshot) => ({
  id: s.id,
  kind: s.kind ?? "http",
  at: s.collectedAt,
  method: s.request.method,
  path: s.request.path,
  status: s.request.status,
  ms: Math.round(s.request.durationMs * 10) / 10,
  queries: s.queries.count,
  /** Elapsed time in queries (parallel queries counted once). */
  queryMs: Math.round((s.queries.wallMs ?? s.queries.totalMs) * 10) / 10,
  nPlusOne: s.queries.nPlusOne,
  exceptions: s.exceptions.length,
  events: s.events?.count ?? 0,
});

const queryRow = (q: QueryRecord, n: number) => ({
  n,
  ms: Math.round(q.timeMs * 100) / 100,
  sql: cut(q.sql),
  bindings: cut(JSON.stringify(q.bindings), 120),
  ...(q.origin ? { at: `${q.origin.file}:${q.origin.line}${q.origin.function ? ` (${q.origin.function})` : ""}` } : {}),
  ...(q.nPlusOne ? { nPlusOne: q.repeats } : {}),
  ...(q.duplicate ? { duplicate: true } : {}),
  ...(q.slow ? { slow: true } : {}),
});

/** RFC 6901 JSON Pointer lookup. Returns undefined when the path does not exist. */
export function readPointer(value: unknown, pointer: string): unknown {
  if (pointer === "" || pointer === "/") return value;
  let current: unknown = value;
  for (const raw of pointer.replace(/^\//, "").split("/")) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** What went wrong or looks wrong in one request, in a few lines. */
export function summarize(s: Snapshot) {
  const issues: string[] = [];
  if (s.request.status >= 500) issues.push(`responded ${s.request.status}`);
  for (const e of s.exceptions.slice(0, 3)) issues.push(`exception ${e.name}: ${cut(e.message, 160)}`);
  for (const g of s.queries.groups.slice(0, 3)) {
    issues.push(`possible N+1: ${g.count}× \`${cut(g.sql, 100)}\` (${Math.round(g.totalMs * 10) / 10}ms)${g.origin ? ` at ${g.origin.file}:${g.origin.line}` : ""}`);
  }
  if (s.queries.duplicates) issues.push(`${s.queries.duplicates} duplicate queries`);
  if (s.queries.slow) issues.push(`${s.queries.slow} slow queries`);
  const peak = s.queries.peakInFlight ?? 0;
  if (peak >= 10) {
    issues.push(`up to ${peak} queries in flight at once; with a smaller connection pool the rest wait, and their measured times include that wait`);
  }
  const unhandled = s.events?.unhandled ?? 0;
  if (unhandled) issues.push(`${unhandled} events with no listeners`);

  return {
    ...row(s),
    url: s.request.url,
    route: s.request.route.name,
    queryMsSummed: Math.round(s.queries.totalMs * 10) / 10,
    issues,
    counts: {
      queries: s.queries.count,
      events: s.events?.count ?? 0,
      logs: s.logs.length,
      cache: s.cache.items.length,
      exceptions: s.exceptions.length,
      messages: s.messages.length,
    },
    hint: "Ask for sections (queries, events, logs, cache, exceptions, timeline, messages, request) or a JSON Pointer for detail.",
  };
}

const SECTIONS: Record<string, (s: Snapshot) => unknown> = {
  request: (s) => ({ ...s.request, headers: s.request.headers, cookies: s.request.cookies }),
  queries: (s) => ({ summary: { count: s.queries.count, elapsedMs: s.queries.wallMs ?? s.queries.totalMs, summedMs: s.queries.totalMs, duplicates: s.queries.duplicates, slow: s.queries.slow, nPlusOne: s.queries.nPlusOne }, groups: s.queries.groups, items: s.queries.items.slice(0, 50).map((q, i) => queryRow(q, i + 1)) }),
  events: (s) => s.events?.items.slice(0, 50) ?? [],
  logs: (s) => s.logs.slice(0, 100),
  cache: (s) => ({ hits: s.cache.hits, misses: s.cache.misses, writes: s.cache.writes, items: s.cache.items.slice(0, 100) }),
  exceptions: (s) => s.exceptions.map((e) => ({ ...e, stack: e.stack.split("\n").slice(0, STACK_LINES).join("\n") })),
  timeline: (s) => s.timeline,
  messages: (s) => s.messages,
};

export function debugbarTools(store: () => DebugbarStore): McpTool[] {
  const id = { type: "string" as const, description: 'A request id from debugbar_list_requests, or "latest" (default).' };

  return [
    {
      name: "debugbar_list_requests",
      description:
        "List recent work the debug bar recorded, newest first: HTTP requests, queued jobs and scheduled tasks (see `kind`), with status, time, query count and problem counts. Start here to find an id.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 50, description: "How many to return (default 20)." },
          kind: { type: "string", enum: ["http", "job", "schedule", "command"], description: "Only this kind of work. Jobs and scheduled tasks are listed with method JOB or SCHEDULE and their name as the path." },
          method: { type: "string", description: "Only this HTTP method, e.g. GET." },
          status: { type: "integer", description: "Only this exact status code." },
          pathContains: { type: "string", description: "Only paths containing this text." },
          minDurationMs: { type: "number", minimum: 0, description: "Only requests at least this slow." },
          hasExceptions: { type: "boolean", description: "Only requests that raised a server error." },
          hasNPlusOne: { type: "boolean", description: "Only requests with a possible N+1 query pattern." },
        },
      },
      handler: async (args) => {
        const s = store();
        const limit = typeof args.limit === "number" ? args.limit : 20;
        const all = await s.list(50);
        if (all.length === 0) return missing(s, undefined);
        const rows = all
          .filter((x) => !args.kind || (x.kind ?? "http") === args.kind)
          .filter((x) => !args.method || x.request.method === String(args.method).toUpperCase())
          .filter((x) => args.status === undefined || x.request.status === args.status)
          .filter((x) => !args.pathContains || x.request.path.includes(String(args.pathContains)))
          .filter((x) => args.minDurationMs === undefined || x.request.durationMs >= (args.minDurationMs as number))
          .filter((x) => args.hasExceptions !== true || x.exceptions.length > 0)
          .filter((x) => args.hasNPlusOne !== true || x.queries.nPlusOne > 0)
          .slice(0, limit)
          .map(row);
        return { count: rows.length, requests: rows };
      },
    },
    {
      name: "debugbar_get_request",
      description:
        "Summarize one recorded request: what happened and what looks wrong (exceptions, N+1 queries, slow or duplicate queries). Pass `sections` for detail, or `pointer` (a JSON Pointer such as /queries/items/3/sql) for one exact value.",
      inputSchema: {
        type: "object",
        properties: {
          id,
          sections: {
            type: "array",
            items: { type: "string", enum: Object.keys(SECTIONS) },
            description: "Detail to include. Omit for the summary only.",
          },
          pointer: { type: "string", description: "JSON Pointer into the full stored request. Returns exactly that value." },
        },
      },
      handler: async (args) => {
        const s = store();
        const snapshot = await find(s, args.id);
        if (!snapshot) return missing(s, args.id);
        if (typeof args.pointer === "string") {
          const value = readPointer(snapshot, args.pointer);
          return value === undefined ? { error: `Nothing at ${args.pointer}.` } : { pointer: args.pointer, value };
        }
        const out: Record<string, unknown> = summarize(snapshot);
        for (const name of (args.sections as string[] | undefined) ?? []) {
          out[name] = SECTIONS[name]!(snapshot);
        }
        return out;
      },
    },
    {
      name: "debugbar_queries",
      description:
        "List the SQL a request ran with timing, bindings and the file:line that issued each query. Filter to duplicates, slow queries or possible N+1 patterns. N+1 groups are listed first.",
      inputSchema: {
        type: "object",
        properties: {
          id,
          filter: { type: "string", enum: ["all", "duplicates", "slow", "nplusone"], description: "Default all." },
          limit: { type: "integer", minimum: 1, maximum: 200, description: "Default 30." },
        },
      },
      handler: async (args) => {
        const s = store();
        const snapshot = await find(s, args.id);
        if (!snapshot) return missing(s, args.id);
        const filter = (args.filter as string | undefined) ?? "all";
        const limit = typeof args.limit === "number" ? args.limit : 30;
        const items = snapshot.queries.items
          .map((q, i) => ({ q, n: i + 1 }))
          .filter(({ q }) => filter === "all" || (filter === "duplicates" && q.duplicate) || (filter === "slow" && q.slow) || (filter === "nplusone" && q.nPlusOne));
        return {
          request: `${snapshot.request.method} ${snapshot.request.path} (${snapshot.id})`,
          summary: { count: snapshot.queries.count, peakInFlight: snapshot.queries.peakInFlight ?? null, elapsedMs: Math.round((snapshot.queries.wallMs ?? snapshot.queries.totalMs) * 10) / 10, summedMs: Math.round(snapshot.queries.totalMs * 10) / 10, duplicates: snapshot.queries.duplicates, slow: snapshot.queries.slow, nPlusOne: snapshot.queries.nPlusOne },
          nPlusOneGroups: snapshot.queries.groups.map((g) => ({ count: g.count, totalMs: Math.round(g.totalMs * 10) / 10, sql: cut(g.sql), ...(g.origin ? { at: `${g.origin.file}:${g.origin.line}` } : {}) })),
          matching: items.length,
          queries: items.slice(0, limit).map(({ q, n }) => queryRow(q, n)),
        };
      },
    },
    {
      name: "debugbar_exceptions",
      description:
        "Server errors (status 500 and up) with stack traces. Give a request id, or omit it to scan the most recent requests.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "A request id. Omit to scan recent requests." },
          limit: { type: "integer", minimum: 1, maximum: 50, description: "Default 10." },
        },
      },
      handler: async (args) => {
        const s = store();
        const limit = typeof args.limit === "number" ? args.limit : 10;
        const snapshots = typeof args.id === "string" && args.id !== "latest" ? [await s.get(args.id)] : await s.list(50);
        if (snapshots.every((x) => !x) && !(await s.list(1)).length) return missing(s, args.id);
        const found = snapshots
          .filter((x): x is Snapshot => Boolean(x))
          .flatMap((x) =>
            x.exceptions.map((e) => ({
              request: x.id,
              route: `${x.request.method} ${x.request.path}`,
              at: x.collectedAt,
              name: e.name,
              message: e.message,
              stack: e.stack.split("\n").slice(0, STACK_LINES).join("\n"),
            })),
          );
        return { count: found.length, exceptions: found.slice(0, limit) };
      },
    },
    {
      name: "debugbar_hot_queries",
      description:
        "Find the query shapes (values stripped) that cost the most ACROSS many recorded requests: queries that are cheap alone but run in every request, such as permission or tenant lookups. Use this to spot work worth caching. Times are summed durations: they include any wait for a database connection and overlap when queries run in parallel.",
      inputSchema: {
        type: "object",
        properties: {
          sortBy: { type: "string", enum: ["totalMs", "runs", "requests"], description: "Default totalMs." },
          limit: { type: "integer", minimum: 1, maximum: 50, description: "Default 10." },
          minRequests: { type: "integer", minimum: 1, description: "Only shapes seen in at least this many requests. Use e.g. 5 to see what repeats everywhere." },
          kind: { type: "string", enum: ["http", "job", "schedule", "command"], description: "Default http." },
          pathContains: { type: "string", description: "Only requests whose path contains this text." },
        },
      },
      handler: async (args) => {
        const s = store();
        const all = await s.list(500);
        if (all.length === 0) return missing(s, undefined);
        const picked = select(all, { kind: args.kind as string | undefined, pathContains: args.pathContains as string | undefined });
        if (picked.length === 0) return { note: "No recorded requests match that filter." };
        return {
          ...hotQueries(picked, {
            sortBy: args.sortBy as HotQuerySort | undefined,
            limit: args.limit as number | undefined,
            minRequests: args.minRequests as number | undefined,
          }),
          hint: "requestShare near 1 means the shape runs in nearly every request. The window is capped by the bar's `history` setting.",
        };
      },
    },
    {
      name: "debugbar_routes",
      description:
        "Per-route statistics over the recorded requests: hits, average and worst time, average queries, duplicates, N+1 patterns, server errors and peak queries in flight. Grouped by route name. Use it to find which endpoints are slow, chatty or failing.",
      inputSchema: {
        type: "object",
        properties: {
          sortBy: { type: "string", enum: ["avgMs", "maxMs", "avgQueries", "hits", "errors", "nPlusOne", "duplicates"], description: "Default avgMs." },
          limit: { type: "integer", minimum: 1, maximum: 50, description: "Default 10." },
          kind: { type: "string", enum: ["http", "job", "schedule", "command"], description: "Default http." },
        },
      },
      handler: async (args) => {
        const s = store();
        const all = await s.list(500);
        if (all.length === 0) return missing(s, undefined);
        const picked = select(all, { kind: args.kind as string | undefined });
        if (picked.length === 0) return { note: "No recorded requests match that filter." };
        return {
          requests: picked.length,
          routes: routeStats(picked, { sortBy: args.sortBy as RouteSort | undefined, limit: args.limit as number | undefined }),
        };
      },
    },
    {
      name: "debugbar_logs",
      description: "Log lines written during one request, optionally only from a minimum level up.",
      inputSchema: {
        type: "object",
        properties: {
          id,
          minLevel: { type: "string", enum: ["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"], description: "Default debug (everything)." },
          limit: { type: "integer", minimum: 1, maximum: 200, description: "Default 50." },
        },
      },
      handler: async (args) => {
        const s = store();
        const snapshot = await find(s, args.id);
        if (!snapshot) return missing(s, args.id);
        const min = levelWeight(((args.minLevel as LogLevel | undefined) ?? "debug") as LogLevel);
        const lines = snapshot.logs.filter((l) => levelWeight(l.level as LogLevel) >= min);
        const limit = typeof args.limit === "number" ? args.limit : 50;
        return {
          request: `${snapshot.request.method} ${snapshot.request.path} (${snapshot.id})`,
          count: lines.length,
          logs: lines.slice(0, limit).map((l) => ({ level: l.level, ms: Math.round(l.at * 10) / 10, message: cut(l.message, 500), ...(l.context ? { context: l.context } : {}) })),
        };
      },
    },
  ];
}

/** Idempotent: re-registering replaces the earlier handlers. */
export function registerDebugbarTools(store: () => DebugbarStore): void {
  for (const tool of debugbarTools(store)) {
    Mcp.forget(tool.name);
    Mcp.tool(tool);
  }
}
