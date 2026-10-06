import type { RequestContext } from "./context.ts";
import { analyzeQueries } from "./queries.ts";
import { sanitizeRecord, sanitizeStrings } from "./redact.ts";
import type { ResolvedDebugbarOptions, Snapshot } from "./types.ts";

function headersOf(source: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  source.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export async function buildSnapshot(
  context: RequestContext,
  options: ResolvedDebugbarOptions,
): Promise<Snapshot> {
  const { request, response } = context;
  const url = new URL(request.url);
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
      url: `${url.origin}${url.pathname}${url.search}`,
      path: url.pathname,
      status: response?.status ?? (context.failed ? 500 : 0),
      durationMs,
      memoryBytes: process.memoryUsage().heapUsed,
      ip,
      route: { name: request.routeName ?? null, params },
      query: sanitizeRecord(Object.fromEntries(url.searchParams), extra),
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
      duplicates: analysis.duplicates,
      nPlusOne: analysis.nPlusOne,
      groups: analysis.groups,
      slow: context.queries.filter((query) => query.slow).length,
      items: context.queries,
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
