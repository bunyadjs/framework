import { Metrics } from "./metrics.ts";

/**
 * Built-in Metrics recorders — call from middleware / workers (Laravel-style).
 */

export type RequestsRecorderOptions = {
  /** Slow request threshold in ms (default 1000). */
  slowThresholdMs?: number;
  /** Paths to ignore (e.g. `/pulse`). */
  ignore?: Array<string | RegExp>;
};

export type RequestSample = {
  method: string;
  path: string;
  durationMs: number;
  userId?: string | number | null;
  status?: number;
};

export class RequestsRecorder {
  readonly #slowThresholdMs: number;
  readonly #ignore: Array<string | RegExp>;

  constructor(options: RequestsRecorderOptions = {}) {
    this.#slowThresholdMs = options.slowThresholdMs ?? 1000;
    this.#ignore = options.ignore ?? [/^\/pulse/];
  }

  record(sample: RequestSample): void {
    const path = sample.path.split("?")[0] ?? sample.path;
    if (this.#ignored(path)) return;

    const key = `${sample.method.toUpperCase()} ${path}`;
    Metrics.record("request", key, 1).count();
    Metrics.record("request_time", key, sample.durationMs).avg().max();

    if (sample.durationMs >= this.#slowThresholdMs) {
      Metrics.record("slow_request", key, sample.durationMs).count().max().avg();
    }

    if (sample.userId != null) {
      Metrics.record("user_request", String(sample.userId), 1).count();
    }

    if (sample.status != null && sample.status >= 500) {
      Metrics.record("server_error", key, 1).count();
    }
  }

  #ignored(path: string): boolean {
    return this.#ignore.some((rule) =>
      typeof rule === "string" ? path === rule || path.startsWith(rule) : rule.test(path),
    );
  }
}

export class ExceptionsRecorder {
  record(error: Error | string, context?: { class?: string }): void {
    Metrics.report(error);
    if (context?.class) {
      Metrics.record("exception_class", context.class, 1).count();
    }
  }
}

export type ServerSample = {
  /** Server / hostname label. */
  name: string;
  /** CPU percent 0–100. */
  cpu?: number;
  /** Memory used percent 0–100. */
  memory?: number;
  /** Disk used percent 0–100. */
  storage?: number;
};

export class ServersRecorder {
  record(sample: ServerSample): void {
    const name = sample.name;
    if (sample.cpu != null) {
      Metrics.record("server_cpu", name, sample.cpu).avg().max();
    }
    if (sample.memory != null) {
      Metrics.record("server_memory", name, sample.memory).avg().max();
    }
    if (sample.storage != null) {
      Metrics.record("server_storage", name, sample.storage).avg().max();
    }
    Metrics.set("server", name, new Date().toISOString());
  }
}
