import type { RequestContext } from "./context.ts";
import { analyzeQueries, peakInFlight, wallTimeMs } from "./queries.ts";
import { MASK, isSecretKey, sanitizeRecord, sanitizeStrings } from "./redact.ts";
import type { ResolvedDebugbarOptions, Snapshot } from "./types.ts";

function headersOf(source: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  source.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/** URL and path with secret query values and secret route parameters (reset tokens) masked. */
function maskedLocation(rawUrl: string, params: Record<string, string>, extra: RegExp[]) {
  const url = new URL(rawUrl, "http://localhost");
  for (const key of [...new Set(url.searchParams.keys())]) {
    if (isSecretKey(key, extra)) url.searchParams.set(key, MASK);
  }
  const secrets = new Set(Object.entries(params).filter(([key, value]) => value && isSecretKey(key, extra)).map(([, value]) => value));
  const path = secrets.size
    ? url.pathname.split("/").map((segment) => (secrets.has(safeDecode(segment)) ? MASK : segment)).join("/")
    : url.pathname;
  return { path, url: `${url.origin}${path}${url.search}`, params: sanitizeStrings(params, extra) };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function buildSnapshot(
  context: RequestContext,
  options: ResolvedDebugbarOptions,
): Promise<Snapshot> {
  const { request, response } = context;
  if (!request) throw new Error("buildSnapshot needs an HTTP request; use buildProfileSnapshot for jobs and tasks.");
  const extra = options.redact;

  let body: Record<string, unknown> = {};
  try {
    // The body is parsed lazily; read it here if the app never did (and it is still unread).
    if (!request.raw.bodyUsed) await request.loadJson();
    body = sanitizeRecord(request.all(), extra);
  } catch {
    // Body already consumed or unparsable — the bar must not break the request.
  }

  let params: Record<string, string> = {};
  try {
    params = request.route();
  } catch {
    // No matched route (404).
  }

  const location = maskedLocation(request.url, params, extra);
  const search = new URL(request.url, "http://localhost").searchParams;

  let ip: string | null = null;
  try {
    ip = request.ip() || null;
  } catch {
    // Not behind a server that exposes the peer address.
  }

  return {
    id: context.id,
    kind: "http",
    collectedAt: new Date(context.startedWall).toISOString(),
    request: {
      method: request.method,
      url: location.url,
      path: location.path,
      status: response?.status ?? (context.failed ? 500 : 0),
      durationMs: context.now(),
      memoryBytes: process.memoryUsage().heapUsed,
      ip,
      route: { name: request.routeName ?? null, params: location.params },
      query: sanitizeRecord(Object.fromEntries(search), extra),
      body,
      headers: sanitizeStrings(headersOf(request.raw.headers), extra),
      cookies: sanitizeStrings(request.cookies(), extra),
      responseHeaders: response
        ? sanitizeStrings(headersOf(response.headers), extra)
        : {},
    },
    ...sections(context, options),
  };
}

/**
 * Snapshot for work that is not an HTTP request: a queued job, a scheduled task, a command.
 * It reuses the request section so every consumer (history page, MCP tools) can list it:
 * `method` is the kind in capitals and `path` is the label.
 */
export function buildProfileSnapshot(context: RequestContext, options: ResolvedDebugbarOptions): Snapshot {
  return {
    id: context.id,
    kind: context.kind,
    collectedAt: new Date(context.startedWall).toISOString(),
    request: {
      method: context.kind.toUpperCase(),
      url: context.label,
      path: context.label,
      status: context.failed ? 500 : 200,
      durationMs: context.now(),
      memoryBytes: process.memoryUsage().heapUsed,
      ip: null,
      route: { name: null, params: {} },
      query: {},
      body: {},
      headers: {},
      cookies: {},
      responseHeaders: {},
    },
    ...sections(context, options),
  };
}

/** Everything collected while the work ran: queries (analysed), timeline, logs, cache, events, errors. */
function sections(context: RequestContext, options: ResolvedDebugbarOptions) {
  const analysis = analyzeQueries(context.queries, options.nPlusOneThreshold);
  const hits = context.cache.filter((item) => item.type === "hit").length;
  const misses = context.cache.filter((item) => item.type === "miss").length;
  const writes = context.cache.filter((item) => item.type === "write").length;

  return {
    queries: {
      count: context.queries.length,
      totalMs: context.queries.reduce((sum, query) => sum + query.timeMs, 0),
      wallMs: wallTimeMs(context.queries),
      peakInFlight: peakInFlight(context.queries),
      duplicates: analysis.duplicates,
      nPlusOne: analysis.nPlusOne,
      groups: analysis.groups,
      slow: context.queries.filter((query) => query.slow).length,
      // The fingerprint only exists to compare queries in memory; it is never stored.
      items: context.queries.map(({ fingerprint: _fingerprint, ...query }) => query),
    },
    timeline: context.timeline,
    messages: context.messages,
    logs: context.logs,
    cache: { hits, misses, writes, items: context.cache },
    events: {
      count: context.events.length,
      unhandled: context.events.filter((item) => item.listeners === 0).length,
      items: context.events,
    },
    exceptions: context.exceptions,
  };
}
