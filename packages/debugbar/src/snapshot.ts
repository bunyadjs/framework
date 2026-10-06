import type { RequestContext } from "./context.ts";
import { analyzeQueries, wallTimeMs } from "./queries.ts";
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

  const analysis = analyzeQueries(context.queries, options.nPlusOneThreshold);
  const totalMs = context.queries.reduce((sum, query) => sum + query.timeMs, 0);
  const durationMs = context.now();
  const hits = context.cache.filter((item) => item.type === "hit").length;
  const misses = context.cache.filter((item) => item.type === "miss").length;
  const writes = context.cache.filter((item) => item.type === "write").length;

  return {
    id: context.id,
    collectedAt: new Date(context.startedWall).toISOString(),
    request: {
      method: request.method,
      url: location.url,
      path: location.path,
      status: response?.status ?? (context.failed ? 500 : 0),
      durationMs,
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
    queries: {
      count: context.queries.length,
      totalMs,
      wallMs: wallTimeMs(context.queries),
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
