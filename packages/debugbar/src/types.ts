export type MessageLevel =
  | "debug"
  | "info"
  | "notice"
  | "warning"
  | "error"
  | "critical"
  | "alert"
  | "emergency";

export type QueryOrigin = {
  /** Path relative to the working directory when possible. */
  file: string;
  line: number;
  function: string | null;
};

export type QueryGroup = {
  sql: string;
  count: number;
  totalMs: number;
  origin: QueryOrigin | null;
};

export type QueryRecord = {
  sql: string;
  bindings: unknown[];
  timeMs: number;
  /** Milliseconds from request start to query start. */
  at: number;
  duplicate: boolean;
  slow: boolean;
  /** Same read shape repeated with different bindings (see `nPlusOneThreshold`). */
  nPlusOne: boolean;
  /** How many times this query's shape ran in the request, when flagged as N+1. */
  repeats: number;
  /** Application code that issued the query; null when it cannot be determined. */
  origin: QueryOrigin | null;
};

export type TimelineRecord = {
  label: string;
  /** Milliseconds from request start. */
  start: number;
  duration: number;
};

export type MessageRecord = {
  level: MessageLevel;
  message: string;
  at: number;
};

export type LogRecord = MessageRecord & {
  context?: Record<string, unknown>;
};

export type CacheRecord = {
  type: "hit" | "miss" | "write" | "forget" | "flush";
  key: string;
  store: string | null;
  at: number;
};

export type ExceptionRecord = {
  name: string;
  message: string;
  stack: string;
  at: number;
};

export type Snapshot = {
  id: string;
  collectedAt: string;
  request: {
    method: string;
    url: string;
    path: string;
    status: number;
    durationMs: number;
    memoryBytes: number;
    ip: string | null;
    route: { name: string | null; params: Record<string, string> };
    query: Record<string, unknown>;
    body: Record<string, unknown>;
    headers: Record<string, string>;
    cookies: Record<string, string>;
    responseHeaders: Record<string, string>;
  };
  queries: {
    count: number;
    totalMs: number;
    duplicates: number;
    slow: number;
    /** Queries flagged as part of an N+1 pattern. */
    nPlusOne: number;
    groups: QueryGroup[];
    items: QueryRecord[];
  };
  timeline: TimelineRecord[];
  messages: MessageRecord[];
  logs: LogRecord[];
  cache: { hits: number; misses: number; writes: number; items: CacheRecord[] };
  exceptions: ExceptionRecord[];
};

export type DebugbarOptions = {
  /** Force on/off. Default: app debug mode, never production, never in tests/console. */
  enabled?: boolean;
  /** URL prefix for the history + JSON endpoints. Default `/_debugbar`. */
  path?: string;
  /** How many requests to retain. Default 50. */
  history?: number;
  /** Queries at or above this duration are flagged slow. Default 100ms. */
  slowQueryMs?: number;
  /** Flag a read as N+1 when its shape repeats this many times with different bindings. Default 5. */
  nPlusOneThreshold?: number;
  /** Record which application code issued each query. Default true. */
  queryOrigin?: boolean;
  /** Max records kept per collector per request. Default 500. */
  maxRecords?: number;
  /** Request paths (prefix match) the bar ignores, e.g. health checks. */
  except?: string[];
  /** Extra key patterns to mask, on top of the built-in secret list. */
  redact?: RegExp[];
  /** Replace the default in-memory store. */
  store?: DebugbarStore;
  /** Inject the bar into HTML responses. Default true; false keeps history/headers only. */
  inject?: boolean;
};

export type ResolvedDebugbarOptions = Required<
  Omit<DebugbarOptions, "enabled" | "store">
> & { enabled: boolean | undefined; store: DebugbarStore };

export interface DebugbarStore {
  put(snapshot: Snapshot): void;
  get(id: string): Snapshot | undefined;
  /** Newest first. */
  list(limit?: number): Snapshot[];
  clear(): void;
}
