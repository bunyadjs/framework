import { AsyncLocalStorage } from "node:async_hooks";
import type { Request } from "@bunyad/http";
import type {
  CacheRecord,
  EventRecord,
  ExceptionRecord,
  LogRecord,
  MessageLevel,
  MessageRecord,
  QueryRecord,
  SnapshotKind,
  TimelineRecord,
} from "./types.ts";

/** Everything collected while one request is in flight. */
export class RequestContext {
  readonly id = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  readonly startedAt = performance.now();
  readonly startedWall = Date.now();
  readonly startMemory = process.memoryUsage().heapUsed;

  readonly queries: QueryRecord[] = [];
  readonly timeline: TimelineRecord[] = [];
  readonly messages: MessageRecord[] = [];
  readonly logs: LogRecord[] = [];
  readonly cache: CacheRecord[] = [];
  readonly events: EventRecord[] = [];
  readonly exceptions: ExceptionRecord[] = [];

  response?: Response;
  /** Set when the app code threw; the app's handler still renders the response. */
  failed = false;

  readonly #open = new Map<string, number>();

  /**
   * `request` is absent for profiled work (jobs, scheduled tasks, commands); `label` names it.
   */
  constructor(
    readonly request: Request | undefined,
    private readonly maxRecords: number,
    readonly kind: SnapshotKind = "http",
    readonly label: string = "",
  ) {}

  /** Milliseconds since the request started. */
  now(): number {
    return performance.now() - this.startedAt;
  }

  /** Append, dropping records past the per-request cap. */
  push<T>(list: T[], item: T): void {
    if (list.length < this.maxRecords) list.push(item);
  }

  message(message: string, level: MessageLevel = "info"): void {
    this.push(this.messages, { level, message, at: this.now() });
  }

  start(label: string): void {
    this.#open.set(label, this.now());
  }

  stop(label: string): void {
    const start = this.#open.get(label);
    if (start === undefined) return;
    this.#open.delete(label);
    this.push(this.timeline, { label, start, duration: this.now() - start });
  }
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The active request context, or undefined outside a debugged request. */
export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}
