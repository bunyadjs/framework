import type { MetricsEntryRecord, MetricsValueRecord } from "./types.ts";
import type { RedisMetricsClient } from "./redis-store.ts";

export type MetricsIngestBatch = {
  entries: MetricsEntryRecord[];
  values: MetricsValueRecord[];
};

/** Optional ingest buffer (Laravel Redis ingest). */
export type MetricsIngest = {
  push(batch: MetricsIngestBatch): void | Promise<void>;
  /** Pop one batch, or `null` when empty. */
  pull(): MetricsIngestBatch | null | Promise<MetricsIngestBatch | null>;
  size(): number | Promise<number>;
  flush(): void | Promise<void>;
};

export type RedisMetricsIngestOptions = {
  prefix?: string;
  client: RedisMetricsClient;
  /** Redis list key suffix (default `ingest`). */
  key?: string;
};

/**
 * Redis list ingest buffer — `ingest()` pushes here; `Metrics.work()` drains to the store.
 */
export class RedisMetricsIngest implements MetricsIngest {
  readonly #client: RedisMetricsClient;
  readonly #key: string;

  constructor(options: RedisMetricsIngestOptions) {
    this.#client = options.client;
    const prefix = options.prefix ?? "bunyad:pulse:";
    this.#key = `${prefix}${options.key ?? "ingest"}`;
  }

  async push(batch: MetricsIngestBatch): Promise<void> {
    const payload = JSON.stringify(batch);
    if (typeof this.#client.lpush === "function") {
      await this.#client.lpush(this.#key, payload);
      return;
    }
    const raw = await this.#client.get(this.#key);
    const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    list.push(payload);
    await this.#client.set(this.#key, JSON.stringify(list));
  }

  async pull(): Promise<MetricsIngestBatch | null> {
    if (typeof this.#client.rpop === "function") {
      const raw = await this.#client.rpop(this.#key);
      if (!raw) return null;
      return JSON.parse(raw) as MetricsIngestBatch;
    }
    const raw = await this.#client.get(this.#key);
    if (!raw) return null;
    const list = JSON.parse(raw) as string[];
    if (!Array.isArray(list) || list.length === 0) return null;
    const next = list.shift()!;
    await this.#client.set(this.#key, JSON.stringify(list));
    return JSON.parse(next) as MetricsIngestBatch;
  }

  async size(): Promise<number> {
    if (typeof this.#client.llen === "function") {
      return this.#client.llen(this.#key);
    }
    const raw = await this.#client.get(this.#key);
    if (!raw) return 0;
    const list = JSON.parse(raw) as unknown[];
    return Array.isArray(list) ? list.length : 0;
  }

  async flush(): Promise<void> {
    await this.#client.del(this.#key);
  }
}
