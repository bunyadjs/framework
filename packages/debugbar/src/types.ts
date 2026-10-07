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
  /**
   * Internal: fingerprint of the original bindings, so duplicate and N+1 detection still tell values
   * apart after masking. Never stored or sent anywhere.
   */
  fingerprint?: string;
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

export type EventRecord = {
  name: string;
  /** Listeners registered when it fired (0 means nothing handled it). */
  listeners: number;
  timeMs: number;
  /** Milliseconds from request start to when the event finished. */
  at: number;
  failed: boolean;
  /** Redacted, length-capped JSON of the event payload. */
  payload: string;
};

export type ExceptionRecord = {
  name: string;
  message: string;
  stack: string;
  at: number;
};

/** What produced a snapshot. Snapshots stored before this field existed are HTTP requests. */
export type SnapshotKind = "http" | "job" | "schedule" | "command";

export type Snapshot = {
  id: string;
  kind: SnapshotKind;
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
    /** Sum of every query's duration. Exceeds the request time when queries ran in parallel. */
    totalMs: number;
    /** Time actually spent in queries: overlapping queries counted once. Absent in older stored snapshots. */
    wallMs: number;
    /** Most queries in flight at once. Absent in older stored snapshots. */
    peakInFlight: number;
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
  events: { count: number; unhandled: number; items: EventRecord[] };
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
  /** Event names the Events tab skips; a trailing `*` matches a prefix. Default: cache events (see the Cache tab). */
  eventsIgnore?: string[];
  /** Record which application code issued each query. Default true. */
  queryOrigin?: boolean;
  /** Max records kept per collector per request. Default 500. */
  maxRecords?: number;
  /** Request paths (prefix match) the bar ignores, e.g. health checks. */
  except?: string[];
  /** Extra key patterns to mask, on top of the built-in secret list. */
  redact?: RegExp[];
  /** Also mask personal data (email, phone, address, ids, bank details) by column or field name. Default true. */
  redactPii?: boolean;
  /** Record query bindings. `false` hides every value (the SQL, timing and N+1 detection still work). Default true. */
  captureBindings?: boolean;
  /** `memory` (default) or `file`: keep snapshots on disk so restarts and other processes see them. */
  driver?: "memory" | "file";
  /** Directory for the file driver, relative to the app base path. Default `storage/debugbar`. */
  storagePath?: string;
  /** File driver: delete snapshots older than this many hours. Default 24. */
  maxAgeHours?: number;
  /** Replace the store entirely (wins over `driver`). */
  store?: DebugbarStore;
  /** Inject the bar into HTML responses. Default true; false keeps history/headers only. */
  inject?: boolean;
};

export type ResolvedDebugbarOptions = Required<
  Omit<DebugbarOptions, "enabled" | "store" | "driver" | "storagePath" | "maxAgeHours" | "redactPii">
> & { enabled: boolean | undefined; store: DebugbarStore };

/** Methods may be sync or async; callers always `await`. `put` must not throw. */
export interface DebugbarStore {
  put(snapshot: Snapshot): void | Promise<void>;
  get(id: string): Snapshot | undefined | Promise<Snapshot | undefined>;
  /** Newest first. */
  list(limit?: number): Snapshot[] | Promise<Snapshot[]>;
  clear(): void | Promise<void>;
}
