import type { Connection } from "./connection-contract.ts";

/** Fired after a connection run/get/all/exec (and sync variants) completes. */
export type QueryExecutedEvent = {
  sql: string;
  bindings: unknown[];
  timeMs: number;
  connection: Connection;
  /**
   * Stack captured at the moment the query was issued. Only present when a listener asked for it
   * (`listen(cb, { callSites: true })`): by the time the query finishes, an async driver's stack
   * no longer contains the code that issued it.
   */
  callSite?: string;
};

export type ListenOptions = {
  /** Capture a call-site stack for every query. Costs one stack capture per query; for dev tooling. */
  callSites?: boolean;
};

export type QueryExecutedListener = (event: QueryExecutedEvent) => void;

const listeners = new Set<QueryExecutedListener>();
const callSiteListeners = new Set<QueryExecutedListener>();

/** Register a thin query timing listener. Returns unsubscribe. */
export function listen(callback: QueryExecutedListener, options: ListenOptions = {}): () => void {
  listeners.add(callback);
  if (options.callSites) callSiteListeners.add(callback);
  return () => {
    listeners.delete(callback);
    callSiteListeners.delete(callback);
  };
}

/** True when some listener wants `event.callSite`. */
export function wantsCallSites(): boolean {
  return callSiteListeners.size > 0;
}

/** The current stack, deep enough to reach application code through the ORM's own frames. */
export function captureCallSite(): string {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 50;
  try {
    return new Error().stack ?? "";
  } finally {
    Error.stackTraceLimit = limit;
  }
}

/** Clear all query listeners (tests). */
export function clearQueryListeners(): void {
  listeners.clear();
  callSiteListeners.clear();
}

export function hasQueryListeners(): boolean {
  return listeners.size > 0;
}

export function fireQueryExecuted(event: QueryExecutedEvent): void {
  if (listeners.size === 0) return;
  for (const listener of listeners) {
    listener(event);
  }
}
